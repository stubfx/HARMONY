// ─── Admin control page ──────────────────────────────────────────────────────
// Safety-net panel for a show operator: mode, step status, QR, audio mute,
// spectator count, heartbeat trigger, formula presets, agent speed.
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
const audioWarning  = document.querySelector('#audio-warning');

const socketUrl = import.meta.env.DEV
    ? `http://localhost:${import.meta.env.VITE_SERVER_PORT ?? 3000}`
    : (import.meta.env.VITE_SOCKET_URL || '/');

const _authBase = import.meta.env.DEV
    ? ''
    : (import.meta.env.VITE_SOCKET_URL || '').replace(/\/$/, '');

let socket     = null;
let adminToken = sessionStorage.getItem('admin-token');

// ── Auth ──────────────────────────────────────────────────────────────────────
authForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const res = await fetch(`${_authBase}/admin-auth`, {
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

// ── Socket ────────────────────────────────────────────────────────────────────
function connectSocket() {
    if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; }
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
    socket.on('spectator-count', ({ count }) => {
        if (_spectatorCountEl) _spectatorCountEl.textContent = count;
    });
    socket.on('audio-state', ({ locked }) => {
        audioWarning?.classList.toggle('hidden', !locked);
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
    { label: 'waves',        dir: 'sin(x * 0.006 + t * 0.4) * PI',                                     wind: 'sin(x * 0.004 + t * 0.3) * PI + cos(y * 0.003 + t * 0.2) * 0.8' },
    { label: 'spiral',       dir: 'atan2(y - cy, x - cx) + t * 0.3',                                    wind: 'sin(x * 0.005 + t * 0.4) * PI + cos(y * 0.005 - t * 0.3) * PI * 0.6' },
    { label: 'cells',        dir: 'sin(x * 0.006) * cos(y * 0.006) * TWO_PI',                           wind: 'sin(x * 0.006 + sin(y * 0.005 + t * 0.4)) * TWO_PI' },
    { label: 'vortex',       dir: 'atan2(y - cy, x - cx) + PI * 0.5',                                   wind: 'atan2(y - cy, x - cx) + t + sin(x * 0.003) * 0.8' },
    { label: 'turbulence',   dir: 'sin(x * 0.009 + sin(y * 0.006 + t)) * TWO_PI',                      wind: 'sin(x * 0.005 + cos(y * 0.006 + t * 0.3)) * TWO_PI' },
    { label: 'radial pulse', dir: 'atan2(y-cy,x-cx) + sin(length(vec2(x-cx,y-cy))*0.012 - t*1.5)*PI', wind: 'sin(x * 0.004 - y * 0.003 + t * 0.4) * TWO_PI' },
];

// ── Spectator count display ref ───────────────────────────────────────────────
let _spectatorCountEl = null;

// ── Build UI ──────────────────────────────────────────────────────────────────
function showAdmin() {
    authGate.classList.add('hidden');
    adminUI.classList.remove('hidden');
    if (sessionLabel) sessionLabel.textContent = room ? `${room.slice(0, 8)}…` : '—';
    connectSocket();
    if (!_uiBuilt) { buildUI(); _uiBuilt = true; }
}

function buildUI() {
    controlsEl.innerHTML = '';

    // ── Spectator count ───────────────────────────────────────────────────────
    const statEl = document.createElement('div');
    statEl.className = 'stat-block';
    const statLabel = document.createElement('span');
    statLabel.className = 'stat-label';
    statLabel.textContent = 'spectators online';
    const statCount = document.createElement('span');
    statCount.className = 'stat-count';
    statCount.textContent = '—';
    statEl.appendChild(statLabel);
    statEl.appendChild(statCount);
    controlsEl.appendChild(statEl);
    _spectatorCountEl = statCount;

    // ── Restart + full reset ──────────────────────────────────────────────────
    const actionRow = document.createElement('div');
    actionRow.className = 'btn-row';

    const restartBtn = document.createElement('button');
    restartBtn.className   = 'btn-big btn-reset';
    restartBtn.textContent = '↺  restart agents';
    restartBtn.addEventListener('click', () => {
        if (window.confirm('Restart all agents?')) send({ restart: true });
    });

    const fullResetBtn = document.createElement('button');
    fullResetBtn.className   = 'btn-big btn-danger';
    fullResetBtn.textContent = '⊘  full reset';
    fullResetBtn.addEventListener('click', () => {
        if (!window.confirm('Full reset: restart agents + clear trace + hide QR?')) return;
        send({ restart: true, clearTrace: true, showQR: false, caption: '' });
    });

    actionRow.appendChild(restartBtn);
    actionRow.appendChild(fullResetBtn);
    controlsEl.appendChild(actionRow);

    // ── Mode ──────────────────────────────────────────────────────────────────
    controlsEl.appendChild(mkLabel('Mode'));
    controlsEl.appendChild(mkBtnGroup([
        { label: 'STORY',    action: () => send({ mode: 'STORY' }) },
        { label: 'SHOWCASE', action: () => send({ mode: 'SHOWCASE' }) },
    ]));

    // ── Step status ───────────────────────────────────────────────────────────
    controlsEl.appendChild(mkLabel('Step status'));
    controlsEl.appendChild(mkBtnGroup([
        { label: 'IDLE', action: () => send({ stepStatus: 'IDLE' }) },
        { label: 'DRAW', action: () => send({ stepStatus: 'DRAW' }) },
        { label: 'VOTE', action: () => send({ stepStatus: 'VOTE' }) },
    ]));

    // ── QR code ───────────────────────────────────────────────────────────────
    controlsEl.appendChild(mkLabel('QR code'));
    const qrRow = document.createElement('div');
    qrRow.className = 'btn-row';

    const showQRBtn = document.createElement('button');
    showQRBtn.className   = 'btn-big btn-qr-on';
    showQRBtn.textContent = '⬜  show qr';
    showQRBtn.addEventListener('click', () => send({ showQR: true }));

    const hideQRBtn = document.createElement('button');
    hideQRBtn.className   = 'btn-big btn-qr-off';
    hideQRBtn.textContent = '⬛  hide qr';
    hideQRBtn.addEventListener('click', () => send({ showQR: false }));

    qrRow.appendChild(showQRBtn);
    qrRow.appendChild(hideQRBtn);
    controlsEl.appendChild(qrRow);

    // ── QR location ───────────────────────────────────────────────────────────
    controlsEl.appendChild(mkLabel('QR location'));
    const qrGrid = document.createElement('div');
    qrGrid.className = 'qr-grid';
    const positions = [
        { x: 'left',   y: 'top'    },
        { x: 'center', y: 'top'    },
        { x: 'right',  y: 'top'    },
        { x: 'left',   y: 'center' },
        { x: 'center', y: 'center' },
        { x: 'right',  y: 'center' },
        { x: 'left',   y: 'bottom' },
        { x: 'center', y: 'bottom' },
        { x: 'right',  y: 'bottom' },
    ];
    let activeQRCell = null;
    positions.forEach(({ x, y }) => {
        const cell = document.createElement('button');
        cell.className = 'qr-cell';
        if (x === 'center' && y === 'center') { cell.classList.add('active'); activeQRCell = cell; }
        cell.addEventListener('click', () => {
            if (activeQRCell) activeQRCell.classList.remove('active');
            cell.classList.add('active');
            activeQRCell = cell;
            send({ qrAlignX: x, qrAlignY: y });
        });
        qrGrid.appendChild(cell);
    });
    controlsEl.appendChild(qrGrid);

    // ── Clear trace ───────────────────────────────────────────────────────────
    const clearBtn = document.createElement('button');
    clearBtn.className   = 'btn-big btn-clear';
    clearBtn.textContent = '✕  clear trace';
    clearBtn.addEventListener('click', () => send({ clearTrace: true, caption: '' }));
    controlsEl.appendChild(clearBtn);

    // ── Heartbeat ─────────────────────────────────────────────────────────────
    controlsEl.appendChild(mkLabel('n8n'));
    const heartbeatBtn = document.createElement('button');
    heartbeatBtn.className   = 'btn-big btn-heartbeat';
    heartbeatBtn.textContent = '↑  trigger heartbeat';
    heartbeatBtn.addEventListener('click', () => {
        if (window.confirm('Trigger n8n heartbeat now?')) send({ triggerHeartbeat: true });
    });
    controlsEl.appendChild(heartbeatBtn);

    // ── Speed ─────────────────────────────────────────────────────────────────
    controlsEl.appendChild(mkLabel('Motion'));
    const motionBlock = document.createElement('div');
    motionBlock.className = 'ctrl-block';
    motionBlock.appendChild(mkSlider('Speed', 'stepLen', 2.0, 0.1, 8, 0.1));
    controlsEl.appendChild(motionBlock);

    // ── Formula presets ───────────────────────────────────────────────────────
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mkLabel(text) {
    const el = document.createElement('p');
    el.className   = 'section-label';
    el.textContent = text;
    return el;
}

function mkBtnGroup(options) {
    const group = document.createElement('div');
    group.className = 'btn-group';
    let activeBtn = null;
    options.forEach(({ label, action }) => {
        const btn = document.createElement('button');
        btn.className   = 'btn-group-btn';
        btn.textContent = label;
        btn.addEventListener('click', () => {
            if (activeBtn) activeBtn.classList.remove('active');
            btn.classList.add('active');
            activeBtn = btn;
            action();
        });
        group.appendChild(btn);
    });
    return group;
}

function mkSlider(label, key, def, min, max, step) {
    const wrap = document.createElement('div');
    const row  = document.createElement('div');
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

// Bootstrap — all let/const declarations above must be initialized before this runs.
let _uiBuilt = false;
if (adminToken) showAdmin();
