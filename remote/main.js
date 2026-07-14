import './style.css';
import { io as ioConnect } from 'socket.io-client';

// ── HARMONY phone — a five-state machine ──────────────────────────────────────
// BLACK → WHITE_DOT → NOTE_PICKER → COLOR_PALETTE → FULL_COLOR → BLACK.
// Driven by the global story phase (the 'story-step' event) plus a local sub-state
// after the audience confirms a note (phase 3) or a color (phase 4). The audience
// makes exactly two decisions: one note, one color. The UI shows a single
// instruction at a time and disappears as soon as its task is done.

// ── Session ───────────────────────────────────────────────────────────────────
const urlParams   = new URLSearchParams(window.location.search);
const room        = urlParams.get('s');

const spectatorId = sessionStorage.getItem('spectator-id') ?? (() => {
    const id = crypto.randomUUID();
    sessionStorage.setItem('spectator-id', id);
    return id;
})();

// ── Story phases (indices into the host STORY array) ──────────────────────────
const P_ENTER = 0, P_FREE = 1, P_TUNE = 2, P_COLOR = 3, P_HARMONY = 4, P_CLOSE = 5;

// A-minor pentatonic D3–A4 — the same order the host maps note index → frequency.
const KEYS = [146.83, 164.81, 196.00, 220.00, 261.63, 293.66, 329.63, 392.00, 440.00];

// Discrete palette — similar luminosity, saturated, no black/grey, no emotion names.
const PALETTE = ['#E24B4B', '#E28E3C', '#D9C13A', '#6FB53C', '#35B58A', '#3C8FD9', '#7B5BD9', '#D14FA6'];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const fullColorEl   = document.getElementById('full-color');
const dotEl         = document.getElementById('dot');
const pickerEl      = document.getElementById('note-picker');
const confirmBtn    = document.getElementById('note-confirm');
const paletteEl     = document.getElementById('palette');
const instructionEl = document.getElementById('instruction');
const stepDebugEl   = document.getElementById('step-debug');

// ── State ─────────────────────────────────────────────────────────────────────
let _currentStep   = -1;
let _emitSound     = false;   // only true in TUNE, before the note is confirmed
let noteConfirmed  = false;
let colorConfirmed = false;
let confirmedColor = null;
let triedIndex     = -1;      // last note previewed (candidate for confirmation)
let _activeIdx     = -1;      // note currently held down
let _touching      = false;

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const socketUrl = import.meta.env.DEV
    ? `http://localhost:${import.meta.env.VITE_SERVER_PORT ?? 3000}`
    : (import.meta.env.VITE_SOCKET_URL || '/');

const socket = ioConnect(socketUrl, { reconnectionDelay: 2000, transports: ['websocket'] });

socket.on('connect',        () => socket.emit('join-session', { room, spectatorId }));
socket.on('connect_error',  () => console.warn('[remote] connection failed, retrying…'));
socket.on('disconnect',     () => console.warn('[remote] disconnected'));
socket.on('host-reconnected', () => socket.emit('join-session', { room, spectatorId }));

socket.on('note-debounce', ({ ms } = {}) => { _noteDebounceMs = ms ?? 0; });

socket.on('story-step', ({ step } = {}) => {
    const next = typeof step === 'number' ? step : -1;
    if (next === _currentStep) return;
    // A fresh run (back to ENTER) or the director stepping backwards clears the
    // two local decisions so the phone starts clean.
    if (next === P_ENTER || next < _currentStep) resetChoices();
    _currentStep = next;
    _emitSound   = _currentStep === P_TUNE && !noteConfirmed;
    if (stepDebugEl) stepDebugEl.textContent = _currentStep >= 0 ? _currentStep : '';
    render();
});

function resetChoices() {
    noteConfirmed  = false;
    colorConfirmed = false;
    confirmedColor = null;
    triedIndex     = -1;
    _activeIdx     = -1;
}

function sendEvent(type, data) {
    if (!socket.connected) return;
    socket.emit('user-event', { type, data });
}

// ── Audio ─────────────────────────────────────────────────────────────────────
let _audioCtx    = null;
let _reverbNode  = null;
let _reverbSend  = null;

function _ensureAudioCtx() {
    if (!_audioCtx) {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        // iOS 16.4+: route Web Audio through the media channel so it ignores the
        // hardware silent switch and follows media volume.
        if ('audioSession' in navigator) navigator.audioSession.type = 'playback';
    }
    if (_audioCtx.state !== 'running') _audioCtx.resume();
    return _audioCtx;
}

// Restore the AudioContext when returning from background / an interruption.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _audioCtx && _audioCtx.state !== 'running') {
        _audioCtx.resume();
    }
});

function _ensureReverb(ctx) {
    if (_reverbNode) return;
    const sr  = ctx.sampleRate;
    const len = Math.floor(sr * 1.6);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    _reverbNode = ctx.createConvolver();
    _reverbNode.buffer = buf;
    _reverbSend = ctx.createGain();
    _reverbSend.gain.value = 0.35;
    _reverbNode.connect(_reverbSend);
    _reverbSend.connect(ctx.destination);
}

// Older iOS (< 16.4): a short silent looping <audio> on the unlock gesture flips
// the media session category so Web Audio ignores the silent switch too.
let _silentKickEl = null;
function _silentAudioKick() {
    if ('audioSession' in navigator || _silentKickEl) return;
    const sr = 8000, n = Math.floor(sr * 0.05);
    const buf = new ArrayBuffer(44 + n * 2);
    const dv  = new DataView(buf);
    const wr  = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE');
    wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    wr(36, 'data'); dv.setUint32(40, n * 2, true);   // samples stay zero → silence
    _silentKickEl = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
    _silentKickEl.loop = true;
    _silentKickEl.play().catch(() => {});
}

// Short plucked transient — quick envelope, no sustain (the full sound is the
// host's climax chord). Fires on each note preview for immediate didactic feedback.
function _pluck(freq) {
    const ctx = _ensureAudioCtx();
    _ensureReverb(ctx);
    const t    = ctx.currentTime;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.28, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.connect(_reverbNode);
    osc.start(t);
    osc.stop(t + 0.6);
}

// ── Live note sending (PHASE.TUNE "prova") ────────────────────────────────────
let _noteDebounceMs = 0;
let _noteTimer      = null;

function previewNote(idx) {
    if (!_emitSound || idx === _activeIdx) return;
    _activeIdx = idx;
    triedIndex = idx;
    _pluck(KEYS[idx]);
    highlightCell(idx);
    confirmBtn.classList.add('visible');
    clearTimeout(_noteTimer);
    _noteTimer = setTimeout(() => sendEvent('note', { index: idx, freq: KEYS[idx] }), _noteDebounceMs);
}

function endPreview() {
    _touching = false;
    highlightCell(-1);
    if (_activeIdx === -1) return;
    _activeIdx = -1;
    clearTimeout(_noteTimer);
    if (_emitSound) sendEvent('note-off', {});
}

// ── Note picker ─────────────────────────────────────────────────────────────
const _cells = [];
for (let i = 0; i < KEYS.length; i++) {
    const cell = document.createElement('div');
    cell.className = 'note-cell';
    pickerEl.appendChild(cell);
    _cells.push(cell);
}

function highlightCell(activeIdx) {
    for (let i = 0; i < _cells.length; i++) {
        _cells[i].classList.toggle('active', i === activeIdx);
        if (i === triedIndex) _cells[i].classList.add('tried');
    }
}

function cellIndexFromY(clientY) {
    const r = pickerEl.getBoundingClientRect();
    const f = (clientY - r.top) / r.height;
    return Math.max(0, Math.min(KEYS.length - 1, Math.floor(f * KEYS.length)));
}

pickerEl.addEventListener('pointerdown', (e) => {
    if (!_emitSound) return;
    e.preventDefault();
    pickerEl.setPointerCapture(e.pointerId);
    if (_audioCtx && _audioCtx.state !== 'running') _audioCtx.resume();
    _touching = true;
    previewNote(cellIndexFromY(e.clientY));
});
pickerEl.addEventListener('pointermove', (e) => { if (_touching) previewNote(cellIndexFromY(e.clientY)); });
pickerEl.addEventListener('pointerup',     endPreview);
pickerEl.addEventListener('pointercancel', endPreview);

confirmBtn.addEventListener('click', () => {
    if (_currentStep !== P_TUNE || noteConfirmed || triedIndex < 0) return;
    endPreview();
    sendEvent('note-confirm', { index: triedIndex });
    noteConfirmed = true;
    _emitSound    = false;
    render();
});

// ── Color palette ─────────────────────────────────────────────────────────────
for (const hex of PALETTE) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch';
    sw.style.background = hex;
    sw.addEventListener('click', () => {
        if (_currentStep !== P_COLOR || colorConfirmed) return;
        confirmedColor = hex;
        colorConfirmed = true;
        sendEvent('color-confirm', { color: hex });
        render();
    });
    paletteEl.appendChild(sw);
}

// ── Render — the single source of truth for what the phone shows ──────────────
function setInstruction(text) {
    instructionEl.textContent = text;
    instructionEl.classList.toggle('hidden', text === '');
}

function render() {
    dotEl.classList.add('hidden');
    dotEl.classList.remove('wander');
    pickerEl.classList.add('hidden');
    confirmBtn.classList.add('hidden');
    confirmBtn.classList.remove('visible');
    paletteEl.classList.add('hidden');
    fullColorEl.style.background = '#000';

    let instr = '';
    switch (_currentStep) {
        case P_ENTER:
            dotEl.classList.remove('hidden');
            instr = 'connesso';
            break;
        case P_FREE:
            dotEl.classList.remove('hidden');
            dotEl.classList.add('wander');
            instr = 'ora guarda lo schermo';
            break;
        case P_TUNE:
            if (!noteConfirmed) {
                pickerEl.classList.remove('hidden');
                confirmBtn.classList.remove('hidden');
                if (triedIndex >= 0) confirmBtn.classList.add('visible');
                highlightCell(_activeIdx);
                instr = 'trova una nota';
            } else {
                instr = 'nota scelta';
            }
            break;
        case P_COLOR:
            if (!colorConfirmed) {
                paletteEl.classList.remove('hidden');
                instr = 'scegli un colore';
            } else {
                fullColorEl.style.background = confirmedColor;   // FULL_COLOR
            }
            break;
        case P_HARMONY:
            // Fade whatever is showing (a confirmed color, or black) down to black.
            fullColorEl.style.background = '#000';
            instr = 'ora guarda';
            break;
        case P_CLOSE:
            fullColorEl.style.background = '#000';
            instr = 'puoi chiudere';
            break;
        default:
            instr = '';   // BLACK — before the story starts
    }
    setInstruction(instr);
}

// ── Init ──────────────────────────────────────────────────────────────────────
render();
document.addEventListener('pointerdown', () => {
    _silentAudioKick();
    _ensureAudioCtx();
}, { once: true });
