// ─── Admin control page ──────────────────────────────────────────────────────
// Phone-first live show-driver for the HARMONY sim. Mirrors the sim's true state
// (phase / mode / status / colorMode / stepStatus / qr / votes) and drives the
// story engine, spectator step-modes, voting, QR, color/status, plus guarded
// emergency controls and a collapsed advanced-tuning area.
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

// Status-header refs (live mirror)
const phaseCodeEl   = document.querySelector('#phase-code');
const phaseLabelEl  = document.querySelector('#phase-label');
const phaseCountEl  = document.querySelector('#phase-count');
const chipsEl       = document.querySelector('#status-chips');
const spectatorEl   = document.querySelector('#spectator-count');
const votePanelEl   = document.querySelector('#vote-panel');
const voteALabelEl  = document.querySelector('#vote-a-label');
const voteBLabelEl  = document.querySelector('#vote-b-label');
const voteANumEl    = document.querySelector('#vote-a-num');
const voteBNumEl    = document.querySelector('#vote-b-num');
const voteTimeEl    = document.querySelector('#vote-time');

const socketUrl = import.meta.env.DEV
    ? `http://localhost:${import.meta.env.VITE_SERVER_PORT ?? 3000}`
    : (import.meta.env.VITE_SOCKET_URL || '/');

const _authBase = import.meta.env.DEV
    ? ''
    : (import.meta.env.VITE_SOCKET_URL || '').replace(/\/$/, '');

let socket     = null;
let adminToken = sessionStorage.getItem('admin-token');

// Latest sim-state snapshot — the single source of truth for every highlight.
let _state = null;

let _adminAvoidHold = null; // { image: string, timer: number, startMs: number } | null

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
        if (spectatorEl) spectatorEl.textContent = count;
    });
    socket.on('audio-state', ({ locked }) => {
        audioWarning?.classList.toggle('hidden', !locked);
    });
    socket.on('sim-state', (state) => {
        _state = state;
        renderMirror(state);
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

// ── Phase catalogue (index → code/label) — filled from the first sim-state ─────
const PHASES = [
    { code: 'P1', label: 'CONNECTION' },
    { code: 'P2', label: 'THE NOTE' },
    { code: 'P3', label: 'HARMONY' },
    { code: 'P4', label: 'HEART' },
    { code: 'P5', label: 'STORM' },
    { code: 'P6', label: 'BIG BANG' },
    { code: 'P7', label: 'TEXT' },
    { code: 'P8', label: 'CLOSING' },
    { code: 'P9', label: 'AMBIENT FINALE' },
    { code: 'SHOWCASE', label: 'SHOWCASE' },
];

// Chip color classes per state field. Value → semantic class.
const CHIP_TONE = {
    mode:      { STORY: 'ok',   SHOWCASE: 'cyan' },
    status:    { NORMAL: 'ok',  FREEROAM: 'amber', DOT: 'cyan' },
    colorMode: { NORMAL: 'ok',  GRAYSCALE: 'muted', GRAYSCALE_INVERTED: 'muted' },
    stepStatus:{ VOTE: 'amber' },
    qrStatus:  { SHOW: 'cyan',  HIDE: 'muted' },
};

// ── Highlight registry ────────────────────────────────────────────────────────
// name → { key: sim-state field, buttons: Map(value → element) }
const groups  = {};

function registerGroup(name, key) {
    const g = { key, buttons: new Map() };
    groups[name] = g;
    return g;
}

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

    buildPhaseNavigator();
    buildEffects();
    buildFormulas();
    buildAvoidPicker();
    buildGlobalVisual();
    buildEmergency();
    buildAdvanced();
}

// ── B. Phase navigator ─────────────────────────────────────────────────────────
function buildPhaseNavigator() {
    controlsEl.appendChild(mkLabel('Phase navigator'));

    // Transport row
    const transport = document.createElement('div');
    transport.className = 'transport-row';
    transport.appendChild(mkTransportBtn('← prev',        () => send({ storyPrev: true })));
    transport.appendChild(mkTransportBtn('next →',        () => send({ storyNext: true })));
    transport.appendChild(mkTransportBtn('↺ restart',     () => send({ mode: 'STORY', storyStart: true }), 'restart'));
    controlsEl.appendChild(transport);

    // 3×3 phase grid
    const grid = document.createElement('div');
    grid.className = 'phase-grid';
    const g = registerGroup('phase', 'phaseIndex');
    PHASES.forEach(({ code, label }, i) => {
        const btn = document.createElement('button');
        btn.className = 'phase-cell';
        btn.innerHTML = `<span class="phase-cell-code">${code}</span><span class="phase-cell-label">${label}</span>`;
        btn.addEventListener('click', () => send({ gotoPhase: i }));
        g.buttons.set(i, btn);
        grid.appendChild(btn);
    });
    controlsEl.appendChild(grid);

    // STORY ⇄ SHOWCASE toggle
    controlsEl.appendChild(mkStateBtnGroup('mode', 'mode', [
        { label: 'STORY',    value: 'STORY',    params: { mode: 'STORY', storyStart: true } },
        { label: 'SHOWCASE', value: 'SHOWCASE', params: { mode: 'SHOWCASE' } },
    ]));
}

// ── C. Effects ───────────────────────────────────────────────────────────────
function buildEffects() {
    controlsEl.appendChild(mkLabel('Effects'));

    const row = document.createElement('div');
    row.className = 'btn-row';

    const blipBtn = document.createElement('button');
    blipBtn.className   = 'btn-big';
    blipBtn.textContent = '◈  blip all';
    blipBtn.addEventListener('click', () => send({ adminBlip: true }));
    row.appendChild(blipBtn);

    const riserBtn = document.createElement('button');
    riserBtn.className   = 'btn-big';
    riserBtn.textContent = '▲  riser';
    riserBtn.addEventListener('click', () => send({ adminRiser: true }));
    row.appendChild(riserBtn);

    const impactBtn = document.createElement('button');
    impactBtn.className   = 'btn-big';
    impactBtn.textContent = '⚡  impact';
    impactBtn.addEventListener('click', () => send({ adminImpact: true }));
    row.appendChild(impactBtn);

    controlsEl.appendChild(row);
}

// ── D. Global visual ─────────────────────────────────────────────────────────
function buildGlobalVisual() {
    controlsEl.appendChild(mkLabel('Color mode'));
    controlsEl.appendChild(mkStateBtnGroup('colorMode', 'colorMode', [
        { label: 'NORMAL',    value: 'NORMAL',             params: { colorMode: 'NORMAL' } },
        { label: 'GRAY',      value: 'GRAYSCALE',          params: { colorMode: 'GRAYSCALE' } },
        { label: 'GRAY INV',  value: 'GRAYSCALE_INVERTED', params: { colorMode: 'GRAYSCALE_INVERTED' } },
    ]));

    controlsEl.appendChild(mkLabel('Status'));
    controlsEl.appendChild(mkStateBtnGroup('status', 'status', [
        { label: 'NORMAL',   value: 'NORMAL',   params: { status: 'NORMAL' } },
        { label: 'FREEROAM', value: 'FREEROAM', params: { status: 'FREEROAM' } },
        { label: 'DOT',      value: 'DOT',      params: { status: 'DOT' } },
    ]));
}

// ── F. Emergency / utility ───────────────────────────────────────────────────
function buildEmergency() {
    controlsEl.appendChild(mkLabel('Emergency / utility'));

    const row = document.createElement('div');
    row.className = 'btn-row';
    row.appendChild(mkGuardBtn('↺  restart', 'btn-reset', 'Restart all agents?', { restart: true }));
    row.appendChild(mkGuardBtn('⊘  full reset', 'btn-danger', 'Full reset: restart agents + clear trace + hide QR?',
        { restart: true, clearTrace: true, showQR: false, caption: '' }));
    controlsEl.appendChild(row);

    const row2 = document.createElement('div');
    row2.className = 'btn-row';
    row2.appendChild(mkGuardBtn('✕  clear trace', 'btn-clear', 'Clear the trace?', { clearTrace: true, caption: '' }));

    const shotBtn = document.createElement('button');
    shotBtn.className   = 'btn-big btn-shot';
    shotBtn.textContent = '⎙  screenshot';
    shotBtn.addEventListener('click', () => send({ capture: true }));
    row2.appendChild(shotBtn);
    controlsEl.appendChild(row2);
}

// ── E2. Formula presets ──────────────────────────────────────────────────────
function buildFormulas() {
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

// ── E3. Avoid-map picker ─────────────────────────────────────────────────────
async function buildAvoidPicker() {
    controlsEl.appendChild(mkLabel('Avoid map'));

    // Append all containers synchronously so DOM order is fixed before the fetch.
    const grid = document.createElement('div');
    grid.className = 'preset-grid';
    controlsEl.appendChild(grid);

    const statusRow = document.createElement('div');
    statusRow.className = 'btn-row';

    const statusEl = document.createElement('span');
    statusEl.id        = 'avoid-hold-status';
    statusEl.className = 'ctrl-label';
    statusRow.appendChild(statusEl);

    const removeBtn = document.createElement('button');
    removeBtn.id        = 'avoid-hold-remove';
    removeBtn.className = 'btn-big btn-clear';
    removeBtn.textContent = '✕ remove';
    removeBtn.style.display = 'none';
    removeBtn.addEventListener('click', _removeAdminAvoidMap);
    statusRow.appendChild(removeBtn);

    controlsEl.appendChild(statusRow);

    // Fetch file list and populate grid after layout is settled.
    let files = [];
    try {
        const res = await fetch(`${_authBase}/simAss-static-list`);
        if (res.ok) ({ files } = await res.json());
    } catch { /* leave files empty */ }

    if (files.length === 0) {
        const note = document.createElement('p');
        note.className   = 'section-label';
        note.textContent = 'no static images found';
        note.style.opacity = '0.5';
        grid.appendChild(note);
    } else {
        files.forEach(filename => {
            const btn = document.createElement('button');
            btn.className   = 'btn-preset';
            btn.textContent = filename.replace(/\.[^.]+$/, '');
            btn.addEventListener('click', () => _loadAdminAvoidMap(filename));
            grid.appendChild(btn);
        });
    }
}

function _loadAdminAvoidMap(filename) {
    if (_adminAvoidHold) { clearTimeout(_adminAvoidHold.timer); _adminAvoidHold = null; }
    send({ avoidMap: `${_authBase}/simAss-static/${filename}` });
    const HOLD_MS = 30_000;
    _adminAvoidHold = {
        image: filename, startMs: Date.now(),
        timer: setTimeout(() => {
            send({ avoidMap: null });
            _adminAvoidHold = null;
            _updateAvoidHoldUI();
        }, HOLD_MS),
    };
    _updateAvoidHoldUI();
}

function _removeAdminAvoidMap() {
    if (!_adminAvoidHold) return;
    clearTimeout(_adminAvoidHold.timer);
    _adminAvoidHold = null;
    send({ avoidMap: null });
    _updateAvoidHoldUI();
}

function _updateAvoidHoldUI() {
    const statusEl  = document.getElementById('avoid-hold-status');
    const removeBtn = document.getElementById('avoid-hold-remove');
    if (!statusEl || !removeBtn) return;
    if (_adminAvoidHold) {
        const remaining = Math.max(0, Math.ceil((30_000 - (Date.now() - _adminAvoidHold.startMs)) / 1000));
        statusEl.textContent    = `${_adminAvoidHold.image} — clears in ${remaining}s`;
        removeBtn.style.display = '';
    } else {
        statusEl.textContent    = '';
        removeBtn.style.display = 'none';
    }
}

// ── G. Advanced (collapsed) ──────────────────────────────────────────────────
function buildAdvanced() {
    const details = document.createElement('details');
    details.className = 'advanced';
    const summary = document.createElement('summary');
    summary.textContent = 'tuning';
    details.appendChild(summary);

    const inner = document.createElement('div');
    inner.className = 'advanced-inner';

    const sliders = document.createElement('div');
    sliders.className = 'ctrl-block';
    sliders.appendChild(mkSlider('Brightness', 'brightness', 0.06, 0.005, 1.5, 0.005));
    sliders.appendChild(mkSlider('Speed',      'stepLen',    2.0,  0.1,   8,   0.1));
    sliders.appendChild(mkSlider('Trail decay','trailDecay', 0.02, 0.001, 0.2, 0.001));
    sliders.appendChild(mkSlider('Point size', 'pointSize',  3.5,  0.5,   12,  0.1));
    sliders.appendChild(mkSlider('Audio duck', 'duckLevel',  0.15, 0,     1,   0.01));
    inner.appendChild(sliders);

    details.appendChild(inner);
    controlsEl.appendChild(details);
}

// ── Live mirror rendering ────────────────────────────────────────────────────
function renderMirror(state) {
    if (!state) return;

    // Phase line
    const i    = state.phaseIndex;
    const meta = PHASES[i];
    if (phaseCodeEl)  phaseCodeEl.textContent  = state.phaseId || meta?.code || '—';
    if (phaseLabelEl) phaseLabelEl.textContent = state.phaseLabel || meta?.label || '';
    if (phaseCountEl) phaseCountEl.textContent = (i >= 0 && state.phaseCount) ? `${i + 1}/${state.phaseCount}` : '';

    // Chips
    renderChips(state);

    // Audio warning
    audioWarning?.classList.toggle('hidden', !state.audioLocked);

    // Vote panel
    renderVote(state);

    // Button highlights
    syncHighlights(state);
}

function renderChips(state) {
    if (!chipsEl) return;
    const fields = [
        ['mode',       state.mode],
        ['status',     state.status],
        ['colorMode',  state.colorMode],
        ['stepStatus', state.stepStatus],
        ['qrStatus',   state.qrStatus],
    ];
    chipsEl.innerHTML = '';
    for (const [key, value] of fields) {
        if (value == null) continue;
        const chip = document.createElement('span');
        const tone = CHIP_TONE[key]?.[value] ?? 'muted';
        chip.className   = `chip chip-${tone}`;
        chip.textContent = value;
        chipsEl.appendChild(chip);
    }
}

function renderVote(state) {
    const isVote = state.stepStatus === 'VOTE';
    votePanelEl?.classList.toggle('hidden', !isVote);
    if (!isVote) return;
    if (voteALabelEl) voteALabelEl.textContent = state.optionA || 'A';
    if (voteBLabelEl) voteBLabelEl.textContent = state.optionB || 'B';
    if (voteANumEl)   voteANumEl.textContent   = state.votesA ?? 0;
    if (voteBNumEl)   voteBNumEl.textContent   = state.votesB ?? 0;
    if (voteTimeEl) {
        const remaining = state.voteEndTime
            ? Math.max(0, Math.ceil((state.voteEndTime - Date.now()) / 1000))
            : null;
        voteTimeEl.textContent = remaining == null ? '—' : remaining;
    }
}

function syncHighlights(state) {
    for (const name in groups) {
        const { key, buttons } = groups[name];
        const active = state[key];
        for (const [value, btn] of buttons) {
            btn.classList.toggle('active', String(value) === String(active));
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mkLabel(text) {
    const el = document.createElement('p');
    el.className   = 'section-label';
    el.textContent = text;
    return el;
}

// Button group whose active highlight is driven by a sim-state field.
function mkStateBtnGroup(groupName, stateKey, options) {
    const g = registerGroup(groupName, stateKey);
    const group = document.createElement('div');
    group.className = 'btn-group';
    options.forEach(({ label, value, params }) => {
        const btn = document.createElement('button');
        btn.className   = 'btn-group-btn';
        btn.textContent = label;
        btn.addEventListener('click', () => send(params));
        g.buttons.set(value, btn);
        group.appendChild(btn);
    });
    return group;
}

function mkTransportBtn(label, action, extra) {
    const btn = document.createElement('button');
    btn.className   = `transport-btn${extra ? ' transport-' + extra : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', action);
    return btn;
}

function mkGuardBtn(label, cls, confirmMsg, params) {
    const btn = document.createElement('button');
    btn.className   = `btn-big ${cls}`;
    btn.textContent = label;
    btn.addEventListener('click', () => { if (window.confirm(confirmMsg)) send(params); });
    return btn;
}

function mkTextInput(placeholder) {
    const wrap = document.createElement('div');
    wrap.className = 'text-input-wrap';
    const input = document.createElement('input');
    input.type        = 'text';
    input.placeholder = placeholder;
    input.className   = 'text-input';
    wrap.appendChild(input);
    return { wrap, input };
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

// Keep the vote countdown and avoid-hold status ticking between sim-state snapshots.
setInterval(() => {
    if (_state?.stepStatus === 'VOTE') renderVote(_state);
    _updateAvoidHoldUI();
}, 1000);

// Bootstrap — all let/const declarations above must be initialized before this runs.
let _uiBuilt = false;
if (adminToken) showAdmin();
