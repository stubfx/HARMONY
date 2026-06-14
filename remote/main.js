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
const harmonyPanelEl  = document.querySelector('#harmony-panel');
const votePanelEl    = document.querySelector('#vote-panel');
const voteBtnA       = document.querySelector('#vote-btn-a');
const voteBtnB       = document.querySelector('#vote-btn-b');
const voteTimerEl    = document.querySelector('#vote-timer');
const textPanelEl    = document.querySelector('#text-panel');
const pulsePanelEl   = document.querySelector('#pulse-panel');
const raisePanelEl   = document.querySelector('#raise-panel');
const raiseNoteEl    = document.querySelector('#raise-note');
const wavePanelEl    = document.querySelector('#wave-panel');
const waveNoteEl     = document.querySelector('#wave-note');
const topBarEl       = document.querySelector('#top-bar');
const textInputEl    = document.querySelector('#input-form input');
let _storyOptionA    = null;
let _storyOptionB    = null;
let _currentStepStatus = null;
let _voteTimerInterval = null;

function _startVoteCountdown(seconds) {
    clearInterval(_voteTimerInterval);
    let remaining = Math.max(0, Math.round(seconds));
    if (voteTimerEl) voteTimerEl.textContent = remaining;
    _voteTimerInterval = setInterval(() => {
        remaining--;
        if (voteTimerEl) voteTimerEl.textContent = Math.max(0, remaining);
        if (remaining <= 0) {
            clearInterval(_voteTimerInterval);
            _voteTimerInterval = null;
            setRemoteUI(); // revert to rest state
        }
    }, 1000);
}

function _clearVoteCountdown() {
    clearInterval(_voteTimerInterval);
    _voteTimerInterval = null;
    if (voteTimerEl) voteTimerEl.textContent = '';
}

function setRemoteUI({ stepStatus, optionA, optionB, voteDuration, color1, color2 } = {}) {
    _currentStepStatus = stepStatus ?? null;
    if (color1) _simColor1 = color1;
    if (color2) _simColor2 = color2;
    _storyOptionA = optionA ?? null;
    _storyOptionB = optionB ?? null;
    const isVote    = stepStatus === 'VOTE';
    const isText    = stepStatus === 'TEXT';
    const isPulse   = stepStatus === 'PULSE';
    const isRaise   = stepStatus === 'RAISE';
    const isWave    = stepStatus === 'WAVE';
    const isHarmony = !stepStatus || stepStatus === 'HARMONY';
    const showJoystick = stepStatus === 'DRAW';
    const showColors   = stepStatus === 'IDLE' || stepStatus === 'DRAW';

    // Reset one-shot state on mode enter
    if (isRaise) { _raiseDone = false; _raiseSwipeStartY = null; raisePanelEl?.classList.remove('completed'); }
    if (isWave)  { _waveDone  = false; wavePanelEl?.classList.remove('completed'); }
    if (!isWave) clearTimeout(_sensorCheckTimer);

    if (votePanelEl) {
        if (isVote) {
            voteBtnA?.classList.remove('voted', 'vote-dimmed', 'tapped');
            voteBtnB?.classList.remove('voted', 'vote-dimmed', 'tapped');
            if (voteBtnA) voteBtnA.textContent = _storyOptionA ?? 'A';
            if (voteBtnB) voteBtnB.textContent = _storyOptionB ?? 'B';
            votePanelEl.classList.add('visible');
            if (voteDuration) _startVoteCountdown(voteDuration);
        } else {
            votePanelEl.classList.remove('visible');
            _clearVoteCountdown();
        }
    }

    if (textPanelEl) {
        if (isText) {
            textPanelEl.classList.add('visible');
            setTimeout(() => textInputEl?.focus(), 350);
        } else {
            textPanelEl.classList.remove('visible');
            textInputEl?.blur();
        }
    }

    pulsePanelEl?.classList.toggle('visible', isPulse);
    raisePanelEl?.classList.toggle('visible', isRaise);
    wavePanelEl?.classList.toggle('visible', isWave);

    if (harmonyPanelEl) {
        harmonyPanelEl.classList.toggle('visible', isHarmony);
        if (isHarmony) _initKeyboard();
    }

    if (isWave) checkSensorSupport(waveNoteEl);

    if (topBarEl) {
        topBarEl.style.opacity       = showColors ? '1' : '0';
        topBarEl.style.pointerEvents = showColors ? 'auto' : 'none';
    }
    // In HARMONY the joystick is invisible but still accepts touch (discovered by chance)
    const joystickTouchable = showJoystick || isHarmony;
    if (joystickBaseEl) {
        joystickBaseEl.style.opacity       = showJoystick ? '1' : '0';
        joystickBaseEl.style.pointerEvents = joystickTouchable ? 'auto' : 'none';
    }
    setStarMode(showJoystick);
    if (!joystickTouchable && joystickIsActive) releaseJoystick();
}

voteBtnA?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (_storyOptionA) {
        navigator.vibrate?.(45);
        voteBtnA.classList.add('tapped');
        socket.emit('story-vote', { choice: _storyOptionA });
        setTimeout(() => setRemoteUI(), 340);
    }
}, { passive: false });

voteBtnB?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (_storyOptionB) {
        navigator.vibrate?.(45);
        voteBtnB.classList.add('tapped');
        socket.emit('story-vote', { choice: _storyOptionB });
        setTimeout(() => setRemoteUI(), 340);
    }
}, { passive: false });

// ── Raise detection ───────────────────────────────────────────────────────────
// Swipe upward on the screen past threshold — pure touch, no sensors needed.
let _raiseDone        = false;
let _raiseSwipeStartY = null;
const RAISE_SWIPE_THRESHOLD = 60; // px upward drag to trigger

function triggerRaise() {
    if (_raiseDone) return;
    _raiseDone = true;
    navigator.vibrate?.([30, 40, 60]);
    raisePanelEl?.classList.add('completed');
    socket.emit('user-event', { type: 'raise' });
}

raisePanelEl?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (_raiseDone) return;
    _raiseSwipeStartY = e.changedTouches[0].clientY;
}, { passive: false });

raisePanelEl?.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (_raiseDone || _raiseSwipeStartY == null) return;
    const dy = _raiseSwipeStartY - e.changedTouches[0].clientY;
    if (dy > RAISE_SWIPE_THRESHOLD) triggerRaise();
    _raiseSwipeStartY = null;
}, { passive: false });

// ── Wave detection ────────────────────────────────────────────────────────────
// Reuses shake magnitude threshold — same gesture, different step context.
let _waveDone     = false;
let _waveLastEmit = 0;
const WAVE_COOLDOWN = 2000;

function triggerWave() {
    if (_waveDone) return;
    _waveDone = true;
    navigator.vibrate?.([20, 30, 20, 30, 60]);
    wavePanelEl?.classList.add('completed');
    socket.emit('user-event', { type: 'wave' });
}

// ── Sensor unsupported check ──────────────────────────────────────────────────
// Immediate check on state change; delayed fallback for permission-denied cases.
let _motionReceived  = false;
let _sensorCheckTimer = null;

function checkSensorSupport(noteEl) {
    clearTimeout(_sensorCheckTimer);
    if (!noteEl) return;
    noteEl.classList.remove('visible');

    if (typeof DeviceMotionEvent === 'undefined') {
        noteEl.textContent = 'questo dispositivo non supporta il sensore — aspetta il passo successivo';
        noteEl.classList.add('visible');
        return;
    }

    _sensorCheckTimer = setTimeout(() => {
        if (!_motionReceived) {
            noteEl.textContent = 'questo dispositivo non supporta il sensore — aspetta il passo successivo';
            noteEl.classList.add('visible');
        }
    }, 2500);
}

// ── Pulse tap ─────────────────────────────────────────────────────────────────
let _lastPulseEmit = 0;
pulsePanelEl?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now - _lastPulseEmit < 80) return;
    _lastPulseEmit = now;
    navigator.vibrate?.(30);
    socket.emit('user-event', { type: 'pulse-tap' });
    pulsePanelEl.classList.add('tapped');
    setTimeout(() => pulsePanelEl.classList.remove('tapped'), 120);
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
    const ax = 50 + (currentRoll  - 0.5) * 40;
    const ay = 50 + (currentPitch - 0.5) * 40;
    const centerColor = pushedColor ?? '#2495FF';
    auraEl.style.background =
        `radial-gradient(circle at ${ax}% ${ay}%, ${centerColor} 0%, #000 65%)`;
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

// ── Sim palette mirror (received via remote-ui) ───────────────────────────────
let _simColor1 = null; // [r,g,b] 0-1, sim's current color1
let _simColor2 = null; // [r,g,b] 0-1, sim's current color2

function _randomSimColor() {
    const c1 = _simColor1 ?? [1, 1, 1];
    const c2 = _simColor2 ?? [0.5, 0.5, 1];
    const t = Math.random();
    const r = Math.max(0, Math.min(255, Math.round((c1[0] + (c2[0] - c1[0]) * t) * 255)));
    const g = Math.max(0, Math.min(255, Math.round((c1[1] + (c2[1] - c1[1]) * t) * 255)));
    const b = Math.max(0, Math.min(255, Math.round((c1[2] + (c2[2] - c1[2]) * t) * 255)));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ── Shake detection ───────────────────────────────────────────────────────────
let _shakeLastTime = 0;
const SHAKE_THRESHOLD = 22; // m/s²
const SHAKE_COOLDOWN  = 1200; // ms between shakes

window.addEventListener('devicemotion', (e) => {
    if (!motionEnabled) return;
    _motionReceived = true;
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const now = Date.now();
    const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);

    const _isDraw    = !_currentStepStatus || _currentStepStatus === 'DRAW';
    const _isHarmony = _currentStepStatus === 'HARMONY';
    if ((_isDraw || _isHarmony) && mag > SHAKE_THRESHOLD && now - _shakeLastTime > SHAKE_COOLDOWN) {
        _shakeLastTime = now;
        navigator.vibrate?.(60);
        // Pick a new random palette color — updates swatch UI on phone and sends color-pick to sim
        const newIdx = Math.random() * PALETTE_SIZE | 0;
        pickColor(newIdx);
        if (!_isHarmony) sendEvent('shake', {}); // burst on sim
    }

    // WAVE — same shake magnitude, different step context
    if (_currentStepStatus === 'WAVE' && !_waveDone) {
        if (mag > SHAKE_THRESHOLD && now - _waveLastEmit > WAVE_COOLDOWN) {
            _waveLastEmit = now;
            triggerWave();
        }
    }
});

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

// Motion-based chaos: rises with movement (d.motion from gyro), decays linearly to 0 at rest.
let _motionChaos  = 0;
let _motionTickT  = null;
const MOTION_DECAY_RATE = 0.5; // chaos units/sec — full chaos → peace in ~2s of stillness

// ── Harmony canvas draw loop ──────────────────────────────────────────────────
// ── Keyboard — 9 coloured keys, C major scale C4–D5 ─────────────────────────
const KEYS = [
    { freq: 261.63, color: '#FF3B3B' },
    { freq: 293.66, color: '#FF8C00' },
    { freq: 329.63, color: '#FFD700' },
    { freq: 349.23, color: '#7ED321' },
    { freq: 392.00, color: '#00CC66' },
    { freq: 440.00, color: '#00CFCF' },
    { freq: 493.88, color: '#4A90E2' },
    { freq: 523.25, color: '#9B59B6' },
    { freq: 587.33, color: '#E91E8C' },
];

let _audioCtx   = null;
let _kbInitted  = false;

function _ensureAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
}

function _playNote(freq) {
    const ctx  = _ensureAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1.4);
}

function _initKeyboard() {
    if (_kbInitted) return;
    _kbInitted = true;
    const grid = document.getElementById('keyboard-grid');
    if (!grid) return;
    KEYS.forEach((k, i) => {
        const el = grid.children[i];
        if (!el) return;
        el.style.background = k.color;
        const trigger = () => {
            el.classList.add('pressed');
            _playNote(k.freq);
            sendEvent('note',       { index: i, freq: k.freq, color: k.color });
            sendEvent('color-pick', { color: k.color });
        };
        const release = () => el.classList.remove('pressed');
        el.addEventListener('touchstart',  (e) => { e.preventDefault(); trigger(); }, { passive: false });
        el.addEventListener('touchend',    release, { passive: true });
        el.addEventListener('touchcancel', release, { passive: true });
        el.addEventListener('mousedown',   trigger);
        el.addEventListener('mouseup',     release);
    });
}

function startTilt() {
    motionEnabled = true;
    tiltRingEl?.classList.add('visible');

    startDeviceTilt(20, (d) => {
        if (!d.enabled) return;
        currentRoll  = d.g;
        currentPitch = d.b;
        updateAura();
        updateTiltDot(currentRoll, currentPitch);

        // Update motion chaos every gyro tick (20 Hz): spike on movement, linear decay at rest
        const now = performance.now() / 1000;
        const dt  = _motionTickT !== null ? now - _motionTickT : 0;
        _motionTickT = now;
        _motionChaos = Math.max(0, _motionChaos - MOTION_DECAY_RATE * dt); // linear decay
        _motionChaos = Math.min(1, Math.max(_motionChaos, d.motion));       // spike to motion

        if (tiltThrottle || !motionEnabled) return;
        tiltThrottle = setTimeout(() => {
            tiltThrottle = null;
            sendEvent('tilt', { pitch: currentPitch, roll: currentRoll, alpha: d.a, chaos: _motionChaos });
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
    navigator.vibrate?.(45);
    setTimeout(() => setRemoteUI(), 340);
});
