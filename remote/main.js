// ─── Remote spectator page ────────────────────────────────────────────────────
// Opened by spectators via the QR code shown by the simulation.
// Connects to the server via Socket.IO and emits user events.
//
// Signal path:
//   remote (this page) → socket → server → [n8n →] socket → simulation
//
// The server's RELAY_MODE env var controls whether events are relayed through
// n8n or forwarded straight to the simulation. This page is unaware of that.

import './style.css';
import { io as ioConnect } from 'socket.io-client';
import { startDeviceTilt, requestMotionOrientationPermission } from './gyro';

// Session room ID comes from the QR code URL parameter ?s=<uuid>
const urlParams   = new URLSearchParams(window.location.search);
const room        = urlParams.get('s');

// Stable spectator ID — unique per tab, persists across refreshes
const spectatorId = sessionStorage.getItem('spectator-id') ?? (() => {
    const id = crypto.randomUUID();
    sessionStorage.setItem('spectator-id', id);
    return id;
})();

// ── Session info display ──────────────────────────────────────────────────────
const sessionInfoEl = document.querySelector('#session-info');
function setSessionInfo(text) {
    if (sessionInfoEl) sessionInfoEl.textContent = text;
}
setSessionInfo(room ? `session: ${room}` : 'no session — scan the QR code from the simulation');

// ── Socket.IO connection ──────────────────────────────────────────────────────
// In dev, Vite runs on a different port from Express, so connect directly.
// In production both are on the same origin — '/' resolves correctly.
const socketUrl = import.meta.env.DEV
    ? `http://localhost:${import.meta.env.VITE_SERVER_PORT ?? 3000}`
    : '/';
const socket = ioConnect(socketUrl, { reconnectionDelay: 2000 });

socket.on('connect', () => {
    console.log('[remote] connected to server');
    socket.emit('join-session', { room, spectatorId });
});

socket.on('joined', () => {
    console.log('[remote] joined session room:', room);
    setSessionInfo(`session: ${room}`);
});

socket.on('connect_error', () => console.warn('[remote] connection failed, retrying…'));

socket.on('disconnect', () => console.warn('[remote] disconnected'));

// Sends a typed event to the server, which routes it based on RELAY_MODE.
function sendEvent(type, data) {
    if (!socket.connected) { console.warn('[remote] not connected — event dropped'); return; }
    console.log('[remote] →', type, data);
    socket.emit('user-event', { type, data });
}

// ── UI ────────────────────────────────────────────────────────────────────────
let motion;

const buttons = document.querySelectorAll('.quick-color');
const formEl  = document.querySelector('#input-form');

const randomColor = () =>
    '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');

document.getElementById('enable-motion').addEventListener('click', async () => {
    await requestMotionOrientationPermission();
    startDeviceTilt(30, (d) => {
        motion = d.enabled ? d.motion : 0;
    });
});

formEl.onsubmit = (e) => {
    e.preventDefault();
    const form = new FormData(formEl);
    const data = Object.fromEntries(form);
    if (!data.text1) return;
    sendEvent('text', { text: data.text1 });
    formEl.reset();
};

buttons.forEach((el) => {
    const color = randomColor();
    el.style.backgroundColor = color;
    el.onclick = () => sendEvent('color', { color });
});

function heartBeat() {
    if (motion) sendEvent('motion', { motion });
    setTimeout(heartBeat, 1000);
}
heartBeat();
