// ─── Remote spectator page ────────────────────────────────────────────────────
// Three channels feed the swarm:
//   joystick — moves the spectator's spawner location across the canvas
//   tilt     — phone orientation (pitch + roll) → collective wind direction
//   text     — typed word → trace attractor in the simulation
//
// Signal path (outbound): this page → socket → server → [n8n →] socket → simulation
// Signal path (inbound):  n8n → POST /spectator-push → server → socket → this page

import './style.css';
import { io as ioConnect } from 'socket.io-client';
import { startDeviceTilt, requestMotionOrientationPermission } from './gyro';

// ── Session ───────────────────────────────────────────────────────────────────
const urlParams   = new URLSearchParams(window.location.search);
const room        = urlParams.get('s');

const spectatorId = sessionStorage.getItem('spectator-id') ?? (() => {
    const id = crypto.randomUUID();
    sessionStorage.setItem('spectator-id', id);
    return id;
})();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const sessionInfoEl   = document.querySelector('#session-info');
const connDotEl       = document.querySelector('#conn-dot');
const auraEl          = document.querySelector('#aura');
const tiltRingEl      = document.querySelector('#tilt-ring');
const tiltDotEl       = document.querySelector('#tilt-dot');
const joystickBaseEl  = document.querySelector('#joystick-base');
const joystickStickEl = document.querySelector('#joystick-stick');
const starCanvas      = document.querySelector('#star-field');
const starCtx         = starCanvas?.getContext('2d');
const joinOverlayEl   = document.querySelector('#join-overlay');
const joinBtnEl       = document.querySelector('#join-btn');
const formEl          = document.querySelector('#input-form');
const deviceMsgEl     = document.querySelector('#device-message');

if (sessionInfoEl) {
    sessionInfoEl.textContent = room ? `${room.slice(0, 8)}…` : 'no session';
}

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const socketUrl = import.meta.env.DEV
    ? `http://localhost:${import.meta.env.VITE_SERVER_PORT ?? 3000}`
    : (import.meta.env.VITE_SOCKET_URL || '/');

const socket = ioConnect(socketUrl, { reconnectionDelay: 2000 });

socket.on('connect', () => {
    console.log('[remote] connected');
    socket.emit('join-session', { room, spectatorId });
    connDotEl?.classList.add('connected');
});

socket.on('joined', ({ userCount } = {}) => {
    console.log('[remote] joined room:', room, '| peers already here:', Math.max(0, (userCount ?? 1) - 1));
    sendEvent('color-pick', { color: palette[selectedSwatchIdx].hex });
});

socket.on('connect_error', () => {
    console.warn('[remote] connection failed, retrying…');
    connDotEl?.classList.remove('connected');
});

socket.on('disconnect', () => {
    console.warn('[remote] disconnected');
    connDotEl?.classList.remove('connected');
});

// ── Color palette ─────────────────────────────────────────────────────────────
function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

const PALETTE_SIZE = 10;
const _hueStep   = 360 / PALETTE_SIZE;
const _hueOffset = Math.random() * _hueStep;
const palette = Array.from({ length: PALETTE_SIZE }, (_, i) => {
    const h = (_hueOffset + i * _hueStep) % 360 | 0;
    const s = 78 + (Math.random() * 12 | 0);
    return { css: `hsl(${h},${s}%,50%)`, hex: hslToHex(h, s, 50) };
});

let selectedSwatchIdx = Math.random() * PALETTE_SIZE | 0;

function pickColor(idx, send = true) {
    selectedSwatchIdx = idx;
    pushedColor = palette[idx].css;
    updateAura();
    document.querySelectorAll('.color-swatch').forEach((el, i) =>
        el.classList.toggle('selected', i === idx));
    if (send) sendEvent('color-pick', { color: palette[idx].hex });
}

function renderSwatches() {
    const picker = document.querySelector('#color-picker');
    if (!picker) return;
    palette.forEach((c, i) => {
        const el = document.createElement('button');
        el.className = 'color-swatch' + (i === selectedSwatchIdx ? ' selected' : '');
        el.style.background = c.css;
        el.addEventListener('touchstart', e => { e.stopPropagation(); pickColor(i); }, { passive: true });
        picker.appendChild(el);
    });
}
renderSwatches();

let pushedColor = palette[selectedSwatchIdx].css;

// ── Device message (push from n8n) ────────────────────────────────────────────
// Shown large and centered; auto-dismissed after 5 s.
let deviceMsgTimer = null;

socket.on('device-message', (data) => {
    if ('color' in (data ?? {})) {
        pushedColor = data.color || null;
        document.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
        updateAura();
    }

    const text = data?.text ?? '';
    if (!deviceMsgEl || !text) return;

    if (deviceMsgTimer) { clearTimeout(deviceMsgTimer); deviceMsgTimer = null; }

    deviceMsgEl.textContent = text;
    deviceMsgEl.classList.add('visible');

    deviceMsgTimer = setTimeout(() => {
        deviceMsgEl.classList.remove('visible');
        deviceMsgTimer = null;
    }, 5000);
});

// ── Story UI ──────────────────────────────────────────────────────────────────
// IDLE — joystick disabled
// DRAW — joystick active (default when no story step is running)
// VOTE — vote panel shown; joystick hidden
const votePanelEl = document.querySelector('#vote-panel');
const voteBtnA    = document.querySelector('#vote-btn-a');
const voteBtnB    = document.querySelector('#vote-btn-b');
let _storyOptionA = null;
let _storyOptionB = null;
function setRemoteUI({ stepStatus, optionA, optionB } = {}) {
    _storyOptionA = optionA ?? null;
    _storyOptionB = optionB ?? null;
    const isVote = stepStatus === 'VOTE';
    const showJoystick = !stepStatus || stepStatus === 'DRAW';

    if (votePanelEl) {
        if (isVote) {
            voteBtnA?.classList.remove('voted', 'vote-dimmed');
            voteBtnB?.classList.remove('voted', 'vote-dimmed');
            if (voteBtnA) voteBtnA.textContent = _storyOptionA ?? 'A';
            if (voteBtnB) voteBtnB.textContent = _storyOptionB ?? 'B';
            votePanelEl.classList.add('visible');
        } else {
            votePanelEl.classList.remove('visible');
        }
    }

    if (joystickBaseEl) {
        joystickBaseEl.style.opacity       = showJoystick ? '1' : '0';
        joystickBaseEl.style.pointerEvents = showJoystick ? 'auto' : 'none';
    }
    setStarMode(showJoystick);
    if (!showJoystick && joystickIsActive) releaseJoystick();
}

voteBtnA?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (_storyOptionA) socket.emit('story-vote', { choice: _storyOptionA });
    setRemoteUI(); // return to controller immediately
}, { passive: false });

voteBtnB?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (_storyOptionB) socket.emit('story-vote', { choice: _storyOptionB });
    setRemoteUI(); // return to controller immediately
}, { passive: false });

socket.on('remote-ui', (data) => setRemoteUI(data));

// Re-join when the host sim reconnects so it immediately knows about this spectator.
socket.on('host-reconnected', () => {
    socket.emit('join-session', { room, spectatorId });
});

// ── Peer events ───────────────────────────────────────────────────────────────
socket.on('peer-joined', () => {
    if (!auraEl) return;
    auraEl.style.transition = 'background 0s, opacity 0.05s ease';
    auraEl.style.opacity = '0.6';
    setTimeout(() => {
        auraEl.style.transition = 'background 0.6s ease, opacity 0.5s ease';
        auraEl.style.opacity = '1';
    }, 80);
});

function sendEvent(type, data) {
    if (!socket.connected) return;
    socket.emit('user-event', { type, data });
}

// ── Aura ──────────────────────────────────────────────────────────────────────
// Tilt drives the anchor point; selected/pushed color drives the center hue.
let currentRoll  = 0.5;
let currentPitch = 0.5;

function updateAura() {
    if (!auraEl) return;
    const ax = 50 + (currentRoll  - 0.5) * 60;
    const ay = 50 + (currentPitch - 0.5) * 60;
    const centerColor = pushedColor ?? 'hsl(215,45%,9%)';
    auraEl.style.background =
        `radial-gradient(ellipse 120% 60% at ${ax}% ${ay}%, ${centerColor} 0%, #000 60%)`;
}
updateAura();

// ── Tilt indicator ────────────────────────────────────────────────────────────
function updateTiltDot(roll, pitch) {
    if (!tiltDotEl) return;
    const x = (roll  - 0.5) * 18;
    const y = (pitch - 0.5) * 18;
    tiltDotEl.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
}

// ── Star field ─────────────────────────────────────────────────────────────────
// 65 stars with random depth drift counter to the joystick direction.
// Visible (dimly) at rest; brighter + streaking when the joystick is active.
// Enabled only in DRAW mode; cleared and paused otherwise.
const STAR_COUNT = 65;
const stars = Array.from({ length: STAR_COUNT }, () => ({
    x:    Math.random(),           // normalized 0–1
    y:    Math.random(),
    r:    Math.random() * 1.4 + 0.3, // dot radius in px
    z:    Math.random() * 0.8 + 0.2, // depth: 0.2 (far/slow) → 1.0 (close/fast)
    base: Math.random() * 0.35 + 0.1, // base opacity
}));

let _starMode = true;
let _starRAF  = null;

function _resizeStarCanvas() {
    if (!starCanvas) return;
    starCanvas.width  = window.innerWidth;
    starCanvas.height = window.innerHeight;
}
_resizeStarCanvas();
window.addEventListener('resize', _resizeStarCanvas);

function _drawStarFrame() {
    if (!starCtx || !starCanvas) return;
    const W   = starCanvas.width;
    const H   = starCanvas.height;
    const dx  = joystickDx;
    const dy  = joystickDy;
    const mag = joystickMag;
    const vel = joystickVelocity;

    // Move stars counter to joystick direction; depth (z) makes far stars slower
    const speed = mag * (1 + vel * 1.5) * 0.008;
    if (speed > 0) {
        for (const s of stars) {
            s.x += -dx * speed * s.z;
            s.y += -dy * speed * s.z;
            if (s.x < 0) s.x += 1;
            if (s.x > 1) s.x -= 1;
            if (s.y < 0) s.y += 1;
            if (s.y > 1) s.y -= 1;
        }
    }

    starCtx.clearRect(0, 0, W, H);
    if (!_starMode) return;

    for (const s of stars) {
        const px  = s.x * W;
        const py  = s.y * H;
        const op  = s.base * (0.35 + mag * 0.65);

        // Streak trail — extends in direction of travel (where the star came from)
        const trailLen = mag * s.z * 32 * (1 + vel);
        if (trailLen > 1) {
            starCtx.beginPath();
            starCtx.moveTo(px, py);
            starCtx.lineTo(px + dx * trailLen, py + dy * trailLen);
            starCtx.strokeStyle = `rgba(255,255,255,${(op * 0.5).toFixed(3)})`;
            starCtx.lineWidth   = s.r * 0.65;
            starCtx.stroke();
        }

        // Star dot — grows slightly when moving fast + close
        const r = s.r * (1 + mag * s.z * 0.5);
        starCtx.beginPath();
        starCtx.arc(px, py, r, 0, Math.PI * 2);
        starCtx.fillStyle = `rgba(255,255,255,${op.toFixed(3)})`;
        starCtx.fill();
    }
}

function _starLoop() {
    _drawStarFrame();
    _starRAF = requestAnimationFrame(_starLoop);
}

function setStarMode(enabled) {
    _starMode = enabled;
    if (enabled && !_starRAF) {
        _starRAF = requestAnimationFrame(_starLoop);
    } else if (!enabled && _starRAF) {
        cancelAnimationFrame(_starRAF);
        _starRAF = null;
        starCtx?.clearRect(0, 0, starCanvas?.width ?? 0, starCanvas?.height ?? 0);
    }
}

// Start immediately — stars idle behind the join overlay and come alive on reveal
_starRAF = requestAnimationFrame(_starLoop);

// ── Joystick ──────────────────────────────────────────────────────────────────
// Single-touch virtual joystick. Sends 'spawner' direction events every 300 ms
// while held; sends active:false on release.
const JOYSTICK_RADIUS = 38; // max stick displacement in px (base radius - stick radius)

let joystickTouchId  = null;
let joystickCenterX  = 0;
let joystickCenterY  = 0;
let joystickDx       = 0;
let joystickDy       = 0;
let joystickMag      = 0;
let joystickVelocity = 0; // smoothed normalized finger speed, 0–1
let joystickIsActive = false;
let joystickInterval = null;
let _velLastX = 0, _velLastY = 0, _velLastT = 0;

function computeJoystick(touch) {
    const rawX = touch.clientX - joystickCenterX;
    const rawY = touch.clientY - joystickCenterY;
    const dist = Math.sqrt(rawX * rawX + rawY * rawY);
    joystickMag = Math.min(dist / JOYSTICK_RADIUS, 1);
    joystickDx  = dist > 0.5 ? rawX / dist : 0;
    joystickDy  = dist > 0.5 ? rawY / dist : 0;
    const sx = joystickDx * joystickMag * JOYSTICK_RADIUS;
    const sy = joystickDy * joystickMag * JOYSTICK_RADIUS;
    if (joystickStickEl) {
        joystickStickEl.style.transform = `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px))`;
    }

    // Track finger speed in px/ms; EMA-smooth; normalize so 0.6 px/ms = 1.0
    const now = performance.now();
    if (_velLastT > 0) {
        const elapsed = now - _velLastT;
        if (elapsed > 0) {
            const ddx = touch.clientX - _velLastX;
            const ddy = touch.clientY - _velLastY;
            const rawV = Math.sqrt(ddx * ddx + ddy * ddy) / elapsed;
            joystickVelocity = 0.5 * joystickVelocity + 0.5 * Math.min(rawV / 0.6, 1.0);
        }
    }
    _velLastX = touch.clientX;
    _velLastY = touch.clientY;
    _velLastT = now;

}


function releaseJoystick() {
    joystickIsActive = false;
    joystickTouchId  = null;
    clearInterval(joystickInterval);
    joystickInterval = null;
    joystickDx = joystickDy = joystickMag = joystickVelocity = 0;
    _velLastT = 0;
    if (joystickStickEl) {
        joystickStickEl.style.transition = 'transform 0.15s ease';
        joystickStickEl.style.transform  = 'translate(-50%, -50%)';
        setTimeout(() => { if (joystickStickEl) joystickStickEl.style.transition = ''; }, 150);
    }
    sendEvent('spawner', { dx: 0, dy: 0, magnitude: 0, velocity: 0, active: false });
}

joystickBaseEl?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (joystickIsActive) return;
    const touch = e.changedTouches[0];
    joystickTouchId  = touch.identifier;
    joystickIsActive = true;
    joystickVelocity = 0;
    _velLastT = 0;
    const rect = joystickBaseEl.getBoundingClientRect();
    joystickCenterX = rect.left + rect.width  / 2;
    joystickCenterY = rect.top  + rect.height / 2;
    computeJoystick(touch);
    sendEvent('spawner', { dx: joystickDx, dy: joystickDy, magnitude: joystickMag, velocity: 0, active: true });
    joystickInterval = setInterval(() => {
        if (joystickIsActive) {
            joystickVelocity *= 0.6; // decay when finger is stationary between sends
            sendEvent('spawner', { dx: joystickDx, dy: joystickDy, magnitude: joystickMag, velocity: joystickVelocity, active: true });
        }
    }, 300);
}, { passive: false });

window.addEventListener('touchmove', (e) => {
    if (!joystickIsActive) return;
    for (const touch of e.changedTouches) {
        if (touch.identifier === joystickTouchId) {
            e.preventDefault();
            computeJoystick(touch);
            break;
        }
    }
}, { passive: false });

window.addEventListener('touchend', (e) => {
    if (!joystickIsActive) return;
    for (const touch of e.changedTouches) {
        if (touch.identifier === joystickTouchId) { releaseJoystick(); break; }
    }
});

window.addEventListener('touchcancel', (e) => {
    if (!joystickIsActive) return;
    for (const touch of e.changedTouches) {
        if (touch.identifier === joystickTouchId) { releaseJoystick(); break; }
    }
});

// ── Join overlay + motion permission ─────────────────────────────────────────
let motionEnabled = false;
let tiltThrottle  = null;

function startTilt() {
    motionEnabled = true;
    tiltRingEl?.classList.add('visible');

    startDeviceTilt(20, (d) => {
        if (!d.enabled) return;
        currentRoll  = d.g;
        currentPitch = d.b;
        updateAura();
        updateTiltDot(currentRoll, currentPitch);
        if (tiltThrottle || !motionEnabled) return;
        tiltThrottle = setTimeout(() => {
            tiltThrottle = null;
            sendEvent('tilt', { pitch: currentPitch, roll: currentRoll });
        }, 250);
    });
}

function dismissOverlay() {
    if (!joinOverlayEl) return;
    joinOverlayEl.style.opacity = '0';
    joinOverlayEl.style.pointerEvents = 'none';
    setTimeout(() => joinOverlayEl.remove(), 650);
}

joinBtnEl?.addEventListener('click', async () => {
    try { await requestMotionOrientationPermission(); } catch { /* denied or unsupported */ }
    startTilt();
    dismissOverlay();
});

// ── Text form ─────────────────────────────────────────────────────────────────
formEl?.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(formEl));
    if (!data.text1?.trim()) return;
    sendEvent('text', { text: data.text1.trim() });
    formEl.reset();
    console.log('[remote] → text', data.text1.trim());
});
