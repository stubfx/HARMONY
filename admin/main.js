// ─── Admin control page (simplified) ──────────────────────────────────────────
// Controls: reset, QR toggle, clear trace, agent color, speed, turn rate, presets.
// URL: /admin/?s=<session-id>

import './style.css';
import { io as ioConnect } from 'socket.io-client';

// ── Session ───────────────────────────────────────────────────────────────────
const room = new URLSearchParams(window.location.search).get('s');

// ── DOM ───────────────────────────────────────────────────────────────────────
const authGate      = document.querySelector('#auth-gate');
const authForm      = document.querySelector('#auth-form');
const authError     = document.querySelector('#auth-error');
const passwordInput = document.querySelector('#password-input');
const adminUI       = document.querySelector('#admin-ui');
const connDot       = document.querySelector('#conn-dot');
const sessionLabel  = document.querySelector('#session-label');
const controlsEl    = document.querySelector('#controls');

const socketUrl = import.meta.env.DEV
    ? `http://localhost:${import.meta.env.VITE_SERVER_PORT ?? 3000}`
    : (import.meta.env.VITE_SOCKET_URL || '/');

let socket     = null;
let adminToken = sessionStorage.getItem('admin-token');

// ── Auth ──────────────────────────────────────────────────────────────────────
authForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const res = await fetch('/admin-auth', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ password: passwordInput.value.trim() }),
        });
        if (!res.ok) { showAuthError(); return; }
        const { token } = await res.json();
        adminToken = token;
        sessionStorage.setItem('admin-token', token);
        authError.style.display = 'none';
        showAdmin();
    } catch {
        showAuthError();
    }
});

function showAuthError() {
    authError.style.display = 'block';
    passwordInput.value = '';
    passwordInput.focus();
}

// Skip gate if token already stored (server rejects if expired → re-auth triggered).
if (adminToken) showAdmin();

// ── Socket ────────────────────────────────────────────────────────────────────
function connectSocket() {
    if (socket) { socket.disconnect(); socket = null; }
    socket = ioConnect(socketUrl, { reconnectionDelay: 2000 });
    socket.on('connect', () => {
        if (adminToken) socket.emit('register-admin', { room, token: adminToken });
    });
    socket.on('admin-registered', () => connDot?.classList.add('connected'));
    socket.on('admin-auth-error', () => {
        sessionStorage.removeItem('admin-token');
        adminToken = null;
        adminUI.classList.add('hidden');
        authGate.classList.remove('hidden');
        connDot?.classList.remove('connected');
    });
    socket.on('disconnect',    () => connDot?.classList.remove('connected'));
    socket.on('connect_error', () => connDot?.classList.remove('connected'));
}

// ── Send ──────────────────────────────────────────────────────────────────────
let debounceTimer = null;
const queued = {};

function queue(key, value) {
    queued[key] = value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, 150);
}

function flush() {
    if (!socket?.connected || !Object.keys(queued).length) return;
    socket.emit('admin-sim-params', { ...queued });
    for (const k in queued) delete queued[k];
}

function send(params) {
    clearTimeout(debounceTimer);
    const payload = { ...queued, ...params };
    for (const k in queued) delete queued[k];
    if (!socket?.connected) return;
    socket.emit('admin-sim-params', payload);
}

// ── Presets (must match PRESETS in sim.js) ────────────────────────────────────
const PRESETS = [
    { label: 'waves',         dir: 'sin(x * 0.006 + t * 0.4) * PI',                                     wind: 'sin(x * 0.004 + t * 0.3) * PI + cos(y * 0.003 + t * 0.2) * 0.8' },
    { label: 'spiral',        dir: 'atan2(y - cy, x - cx) + t * 0.3',                                    wind: 'sin(x * 0.005 + t * 0.4) * PI + cos(y * 0.005 - t * 0.3) * PI * 0.6' },
    { label: 'cells',         dir: 'sin(x * 0.006) * cos(y * 0.006) * TWO_PI',                           wind: 'sin(x * 0.006 + sin(y * 0.005 + t * 0.4)) * TWO_PI' },
    { label: 'vortex',        dir: 'atan2(y - cy, x - cx) + PI * 0.5',                                   wind: 'atan2(y - cy, x - cx) + t + sin(x * 0.003) * 0.8' },
    { label: 'turbulence',    dir: 'sin(x * 0.009 + sin(y * 0.006 + t)) * TWO_PI',                      wind: 'sin(x * 0.005 + cos(y * 0.006 + t * 0.3)) * TWO_PI' },
    { label: 'radial pulse',  dir: 'atan2(y-cy,x-cx) + sin(length(vec2(x-cx,y-cy))*0.012 - t*1.5)*PI', wind: 'sin(x * 0.004 - y * 0.003 + t * 0.4) * TWO_PI' },
];

// ── QR state ──────────────────────────────────────────────────────────────────
// Tracks what we last told the sim — initialised to true since the sim shows
// the QR by default on startup.
let qrVisible = true;

// ── Build UI ──────────────────────────────────────────────────────────────────
function showAdmin() {
    authGate.classList.add('hidden');
    adminUI.classList.remove('hidden');
    if (sessionLabel) sessionLabel.textContent = room ? `${room.slice(0, 8)}…` : '—';
    connectSocket();
    buildUI();
}

function buildUI() {
    controlsEl.innerHTML = '';

    // ── Reset ─────────────────────────────────────────────────────────────────
    const resetBtn = document.createElement('button');
    resetBtn.className   = 'btn-big btn-reset';
    resetBtn.textContent = '↺  restart agents';
    resetBtn.addEventListener('click', () => {
        if (window.confirm('Restart all agents?')) send({ restart: true });
    });
    controlsEl.appendChild(resetBtn);

    // ── QR toggle ─────────────────────────────────────────────────────────────
    const qrBtn = document.createElement('button');
    function updateQRBtn() {
        qrBtn.className   = `btn-big ${qrVisible ? 'btn-qr-on' : 'btn-qr-off'}`;
        qrBtn.textContent = qrVisible ? '⬛  hide qr code' : '⬜  show qr code';
    }
    updateQRBtn();
    qrBtn.addEventListener('click', () => {
        const next = !qrVisible;
        const msg  = next ? 'Show QR code?' : 'Hide QR code?';
        if (!window.confirm(msg)) return;
        qrVisible = next;
        send({ showQR: qrVisible });
        updateQRBtn();
    });
    controlsEl.appendChild(qrBtn);

    // ── Clear trace ───────────────────────────────────────────────────────────
    const clearBtn = document.createElement('button');
    clearBtn.className   = 'btn-big btn-clear';
    clearBtn.textContent = '✕  clear trace';
    clearBtn.addEventListener('click', () => send({ clearTrace: true }));
    controlsEl.appendChild(clearBtn);

    // ── Agent color ───────────────────────────────────────────────────────────
    controlsEl.appendChild(mkLabel('Agent color'));
    const colorBlock = document.createElement('div');
    colorBlock.className = 'color-block';
    const colorLbl = document.createElement('span');
    colorLbl.className   = 'ctrl-label';
    colorLbl.textContent = 'Base color';
    const colorInput = document.createElement('input');
    colorInput.type  = 'color';
    colorInput.value = '#000000';
    colorInput.addEventListener('input', () => queue('color', colorInput.value));
    colorBlock.appendChild(colorLbl);
    colorBlock.appendChild(colorInput);
    controlsEl.appendChild(colorBlock);

    const speedColorBlock = document.createElement('div');
    speedColorBlock.className = 'color-block';
    const speedColorLbl = document.createElement('span');
    speedColorLbl.className   = 'ctrl-label';
    speedColorLbl.textContent = 'Speed color';
    const speedColorInput = document.createElement('input');
    speedColorInput.type  = 'color';
    speedColorInput.value = '#ffffff';
    speedColorInput.addEventListener('input', () => queue('speedColor', speedColorInput.value));
    speedColorBlock.appendChild(speedColorLbl);
    speedColorBlock.appendChild(speedColorInput);
    controlsEl.appendChild(speedColorBlock);

    // ── Speed + Turn rate ─────────────────────────────────────────────────────
    controlsEl.appendChild(mkLabel('Motion'));
    const motionBlock = document.createElement('div');
    motionBlock.className = 'ctrl-block';
    motionBlock.appendChild(mkSlider('Speed',     'stepLen',  2.0, 0.1, 8,   0.1));
    motionBlock.appendChild(mkSlider('Turn rate', 'turnRate', 0.04, 0.005, 0.3, 0.005));
    controlsEl.appendChild(motionBlock);

    // ── Presets ───────────────────────────────────────────────────────────────
    controlsEl.appendChild(mkLabel('Formula presets'));
    const grid = document.createElement('div');
    grid.className = 'preset-grid';
    let activePresetBtn = null;
    PRESETS.forEach(({ label, dir, wind }) => {
        const btn = document.createElement('button');
        btn.className   = 'btn-preset';
        btn.textContent = label;
        btn.addEventListener('click', () => {
            if (activePresetBtn) activePresetBtn.classList.remove('active');
            btn.classList.add('active');
            activePresetBtn = btn;
            send({ dir, wind });
        });
        grid.appendChild(btn);
    });
    controlsEl.appendChild(grid);

    // ── Trace text ────────────────────────────────────────────────────────────
    controlsEl.appendChild(mkLabel('Trace text'));
    const textBlock = document.createElement('div');
    textBlock.className = 'ctrl-block';

    const textInput = document.createElement('textarea');
    textInput.className   = 'trace-textarea';
    textInput.placeholder = 'type text to send…';
    textInput.rows        = 3;
    textBlock.appendChild(textInput);

    const textBtnRow = document.createElement('div');
    textBtnRow.className = 'text-btn-row';

    const sendTextBtn = document.createElement('button');
    sendTextBtn.className   = 'btn-text-send';
    sendTextBtn.textContent = '→  send';
    sendTextBtn.addEventListener('click', () => {
        const val = textInput.value.trim();
        if (!val) return;
        send({ traceText: val });
    });

    const clearTextBtn = document.createElement('button');
    clearTextBtn.className   = 'btn-text-clear';
    clearTextBtn.textContent = '✕  clear text';
    clearTextBtn.addEventListener('click', () => {
        textInput.value = '';
        send({ clearText: true });
    });

    textBtnRow.appendChild(sendTextBtn);
    textBtnRow.appendChild(clearTextBtn);
    textBlock.appendChild(textBtnRow);
    controlsEl.appendChild(textBlock);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mkLabel(text) {
    const el = document.createElement('p');
    el.className   = 'section-label';
    el.textContent = text;
    return el;
}

function mkSlider(label, key, def, min, max, step) {
    const wrap = document.createElement('div');

    const row = document.createElement('div');
    row.className = 'ctrl-row';

    const lbl = document.createElement('span');
    lbl.className   = 'ctrl-label';
    lbl.textContent = label;

    const val = document.createElement('span');
    val.className   = 'ctrl-value';
    val.textContent = def;

    row.appendChild(lbl);
    row.appendChild(val);

    const input = document.createElement('input');
    input.type  = 'range';
    input.min   = min;
    input.max   = max;
    input.step  = step;
    input.value = def;

    input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        val.textContent = +v.toFixed(3);
        queue(key, v);
    });

    wrap.appendChild(row);
    wrap.appendChild(input);
    return wrap;
}
