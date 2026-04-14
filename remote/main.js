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
// Signal path:
//   this page → socket → server → [n8n →] socket → simulation

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
const sessionInfoEl = document.querySelector('#session-info');
const connDotEl     = document.querySelector('#conn-dot');
const auraEl        = document.querySelector('#aura');
const tiltRingEl    = document.querySelector('#tilt-ring');
const tiltDotEl     = document.querySelector('#tilt-dot');
const gestureSurface = document.querySelector('#gesture-surface');
const motionBtn     = document.querySelector('#motion-btn');
const formEl        = document.querySelector('#input-form');

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

socket.on('joined', () => console.log('[remote] joined room:', room));

socket.on('connect_error', () => {
    console.warn('[remote] connection failed, retrying…');
    connDotEl?.classList.remove('connected');
});

socket.on('disconnect', () => {
    console.warn('[remote] disconnected');
    connDotEl?.classList.remove('connected');
});

function sendEvent(type, data) {
    if (!socket.connected) return;
    socket.emit('user-event', { type, data });
}

// ── Aura ──────────────────────────────────────────────────────────────────────
// Background glow that reflects the user's current temperature and tilt.
// Cold (touch top) → deep blue  ·  Warm (touch bottom) → deep amber
// Anchor point drifts with tilt so the glow follows the phone's lean.
let currentTemp = 0.5;
let currentRoll = 0.5;
let currentPitch = 0.5;

function updateAura() {
    if (!auraEl) return;
    // Hue: 215 (cold blue) → 32 (warm amber)
    const h = 215 + (32 - 215) * currentTemp;
    const s = 65 + 20 * currentTemp;
    const l = 10 + 8 * currentTemp;
    // Anchor follows tilt so the glow leans with the phone
    const ax = 50 + (currentRoll  - 0.5) * 60;   // 20%–80%
    const ay = 50 + (currentPitch - 0.5) * 60;
    auraEl.style.background =
        `radial-gradient(ellipse 130% 70% at ${ax}% ${ay}%, hsl(${h},${s}%,${l}%) 0%, #000 58%)`;
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
let touchThrottle = null;

function handleTouch(e) {
    const touch = e.touches[0];
    const nx = touch.clientX / window.innerWidth;
    const ny = touch.clientY / window.innerHeight;
    const temp = ny; // top=cold, bottom=warm

    currentTemp = temp;
    updateAura();

    if (touchThrottle) return;
    touchThrottle = setTimeout(() => {
        touchThrottle = null;
        sendEvent('touch', { x: nx, y: ny, temp });
    }, 100);
}

gestureSurface?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    createRipple(e.touches[0].clientX, e.touches[0].clientY);
    handleTouch(e);
}, { passive: false });

gestureSurface?.addEventListener('touchmove', (e) => {
    e.preventDefault();
    handleTouch(e);
}, { passive: false });

gestureSurface?.addEventListener('touchend', (e) => {
    e.preventDefault();
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

// ── Motion permission + tilt ──────────────────────────────────────────────────
let motionEnabled = false;
let tiltThrottle  = null;

motionBtn?.addEventListener('click', async () => {
    await requestMotionOrientationPermission();
    motionEnabled = true;
    motionBtn.style.opacity = '0';
    motionBtn.style.pointerEvents = 'none';
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
