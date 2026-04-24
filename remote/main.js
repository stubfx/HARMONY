// ─── Remote spectator page ────────────────────────────────────────────────────
// The phone is the instrument. Three channels feed the swarm:
//
//   tilt        — phone orientation (pitch + roll) → collective wind direction
//   touch       — finger position → spatial presence; Y axis → temperature
//   text        — typed word → trace attractor in the simulation
//
// Tilt events are consumed server-side and aggregated into a collective wind bias.
// Touch and text events are forwarded directly to the simulation.
//
// n8n can push messages back to this device via POST /spectator-push on the server.
// The 'device-message' socket event can carry:
//   text  — shown as a top notification, auto-dismissed after 5 s
//   color — CSS color string that overrides the aura base color (null to reset)
//
// Text input is hidden by default; double-tap the gesture surface to reveal/hide it.
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
const sessionInfoEl  = document.querySelector('#session-info');
const connDotEl      = document.querySelector('#conn-dot');
const auraEl         = document.querySelector('#aura');
const tiltRingEl     = document.querySelector('#tilt-ring');
const tiltDotEl      = document.querySelector('#tilt-dot');
const gestureSurface = document.querySelector('#gesture-surface');
const joinOverlayEl  = document.querySelector('#join-overlay');
const joinBtnEl      = document.querySelector('#join-btn');
const formEl         = document.querySelector('#input-form');
const bottomBarEl    = document.querySelector('#bottom-bar');
const deviceMsgEl    = document.querySelector('#device-message');

// ── Session info ──────────────────────────────────────────────────────────────
if (sessionInfoEl) {
    sessionInfoEl.textContent = room
        ? `${room.slice(0, 8)}…`
        : 'no session';
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
    // Push the locally chosen palette color to the sim so the GPU slot matches the aura.
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
// 10 vivid colors at 50 % lightness, evenly spaced hues, random rotation.
// Selected on page load; user can swap via swatches. n8n can still push an
// arbitrary aura override via device-message (existing behaviour unchanged).
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
    const s = 78 + (Math.random() * 12 | 0); // 78–90 % saturation
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

// Initialise aura with the pre-selected palette color before any socket events.
let pushedColor = palette[selectedSwatchIdx].css;

// ── Device message (push from n8n) ────────────────────────────────────────────
// data.text  — notification text shown at the top, auto-dismissed after 5 s
// data.color — CSS color string for the aura base; persists until overridden.
//              Send null or empty string to reset to temperature-driven color.
//              Overrides the user's chosen swatch (swatch ring is cleared).
let deviceMsgTimer = null;

socket.on('device-message', (data) => {
    if ('color' in (data ?? {})) {
        pushedColor = data.color || null;
        // n8n override — clear swatch selection since the color may not match any swatch
        document.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
        updateAura();
    }

    const text = data?.text ?? '';
    if (!deviceMsgEl || !text) return;

    if (deviceMsgTimer) {
        clearTimeout(deviceMsgTimer);
        deviceMsgTimer = null;
    }

    deviceMsgEl.textContent = text;
    deviceMsgEl.classList.add('visible');

    deviceMsgTimer = setTimeout(() => {
        deviceMsgEl.classList.remove('visible');
        deviceMsgTimer = null;
    }, 5000);
});

// ── Story UI ──────────────────────────────────────────────────────────────────
// stepStatus 'IDLE'  — gesture surface disabled, no vote panel
// stepStatus 'DRAW'  — gesture surface active (normal touch behaviour)
// stepStatus 'VOTE'  — vote panel shown with two labelled buttons; gesture surface hidden
const votePanelEl      = document.querySelector('#vote-panel');
const voteBtnA         = document.querySelector('#vote-btn-a');
const voteBtnB         = document.querySelector('#vote-btn-b');
const gestureSurfaceEl = document.querySelector('#gesture-surface');
let _storyOptionA = null;
let _storyOptionB = null;

function setStoryUI({ stepStatus, optionA, optionB } = {}) {
    _storyOptionA = optionA ?? null;
    _storyOptionB = optionB ?? null;
    const isVote = stepStatus === 'VOTE';
    const isDraw = stepStatus === 'DRAW';
    if (votePanelEl) {
        if (isVote) {
            if (voteBtnA) voteBtnA.textContent = _storyOptionA ?? 'A';
            if (voteBtnB) voteBtnB.textContent = _storyOptionB ?? 'B';
            votePanelEl.classList.add('visible');
        } else {
            votePanelEl.classList.remove('visible');
        }
    }
    if (gestureSurfaceEl) {
        gestureSurfaceEl.style.pointerEvents = isDraw ? 'auto' : 'none';
    }
}

voteBtnA?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (_storyOptionA) socket.emit('story-vote', { choice: _storyOptionA });
}, { passive: false });

voteBtnB?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (_storyOptionB) socket.emit('story-vote', { choice: _storyOptionB });
}, { passive: false });

socket.on('story-ui', (data) => setStoryUI(data));

// ── Peer events ───────────────────────────────────────────────────────────────
// Brief aura pulse when another spectator joins.
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
// Background glow that reflects all three interaction axes simultaneously:
//   Y (temperature) → hue shift: cold blue (top) → warm amber (bottom)
//   tilt            → anchor point: the glow leans with the phone
//   X (coherence)   → gradient tightness: diffuse (left/chaos) → focused (right/order)
// If n8n pushes a color via device-message, it overrides the temperature-driven hue
// and persists until a new push clears it (data.color = null).
let currentTemp      = 0.5;
let currentRoll      = 0.5;
let currentPitch     = 0.5;
let currentCoherence = 0.5;

function updateAura() {
    if (!auraEl) return;
    // Anchor follows tilt
    const ax = 50 + (currentRoll  - 0.5) * 60;
    const ay = 50 + (currentPitch - 0.5) * 60;
    // Coherence: diffuse wide ellipse (chaos) → tight narrow ellipse (order)
    const ew = 190 - currentCoherence * 110;  // 190% → 80%
    const eh = 110 - currentCoherence * 70;   // 110% → 40%
    // Center color: pushed by n8n or computed from temperature
    const centerColor = pushedColor ?? (() => {
        // Hue: 215 (cold blue) → 32 (warm amber)
        const h = 215 + (32 - 215) * currentTemp;
        const s = 60 + 25 * currentTemp;
        const l = 9  + 10 * currentTemp;
        return `hsl(${h},${s}%,${l}%)`;
    })();
    auraEl.style.background =
        `radial-gradient(ellipse ${ew}% ${eh}% at ${ax}% ${ay}%, ${centerColor} 0%, #000 60%)`;
}
updateAura();

// ── Tilt indicator ────────────────────────────────────────────────────────────
function updateTiltDot(roll, pitch) {
    if (!tiltDotEl) return;
    // Map [0,1] to [-24px, +24px] within the ring
    const x = (roll  - 0.5) * 48;
    const y = (pitch - 0.5) * 48;
    tiltDotEl.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
}

// ── Touch ─────────────────────────────────────────────────────────────────────
// The whole screen is the instrument surface.
// X + Y → normalized spatial position.
// Y → temperature: finger near top = cold (0), near bottom = warm (1).
// Double-tap → toggle text input visibility.
let touchThrottle = null;
let lastTapTime   = 0;
let formVisible   = false;
let lastTouchX    = 0.5;
let lastTouchY    = 0.5;

function handleTouch(e) {
    const touch = e.touches[0];
    const nx = touch.clientX / window.innerWidth;
    const ny = touch.clientY / window.innerHeight;
    const temp = ny; // top=cold, bottom=warm

    lastTouchX = nx;
    lastTouchY = ny;

    currentTemp      = temp;
    currentCoherence = nx;   // left=chaos, right=order
    updateAura();

    if (touchThrottle) return;
    touchThrottle = setTimeout(() => {
        touchThrottle = null;
        sendEvent('touch', { x: nx, y: ny, temp, touching: true });
    }, 100);
}

gestureSurface?.addEventListener('touchstart', (e) => {
    e.preventDefault();

    // Double-tap detection: two taps within 280 ms toggle the text input
    const now = Date.now();
    if (now - lastTapTime < 280) {
        formVisible = !formVisible;
        bottomBarEl?.classList.toggle('visible', formVisible);
        if (formVisible) formEl?.querySelector('input')?.focus();
        lastTapTime = 0; // reset so triple-tap doesn't re-trigger
    } else {
        lastTapTime = now;
    }

    createRipple(e.touches[0].clientX, e.touches[0].clientY);
    handleTouch(e);
}, { passive: false });

gestureSurface?.addEventListener('touchmove', (e) => {
    e.preventDefault();
    handleTouch(e);
}, { passive: false });

gestureSurface?.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (touchThrottle) { clearTimeout(touchThrottle); touchThrottle = null; }
    sendEvent('touch', { x: lastTouchX, y: lastTouchY, touching: false });
}, { passive: false });

// ── Ripple ────────────────────────────────────────────────────────────────────
function createRipple(x, y) {
    const el = document.createElement('div');
    el.className = 'ripple';
    el.style.left = `${x}px`;
    el.style.top  = `${y}px`;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
}

// ── Join overlay + motion permission ─────────────────────────────────────────
// "join the swarm" is the first and only gate.
// Tapping it requests device-motion permission (required on iOS 13+).
// Whether permission is granted or denied the overlay is dismissed and the
// full UI (touch surface + text form) becomes active.
let motionEnabled = false;
let tiltThrottle  = null;

function startTilt() {
    motionEnabled = true;
    tiltRingEl?.classList.add('visible');

    startDeviceTilt(20, (d) => {
        if (!d.enabled) return;

        currentRoll  = d.g;   // roll  0-1
        currentPitch = d.b;   // pitch 0-1
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
    // Request permission first — iOS requires a user gesture in the call stack.
    try { await requestMotionOrientationPermission(); } catch { /* denied or unsupported */ }
    startTilt();
    dismissOverlay();
});

// ── Text form ─────────────────────────────────────────────────────────────────
// Hidden by default; revealed by double-tapping the gesture surface.
// Collapses automatically after submission.
formEl?.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(formEl));
    if (!data.text1?.trim()) return;
    sendEvent('text', { text: data.text1.trim() });
    formEl.reset();
    formVisible = false;
    bottomBarEl?.classList.remove('visible');
    console.log('[remote] → text', data.text1.trim());
});
