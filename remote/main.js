import './style.css';
import { io as ioConnect } from 'socket.io-client';

// ── Session ───────────────────────────────────────────────────────────────────
const urlParams   = new URLSearchParams(window.location.search);
const room        = urlParams.get('s');

const spectatorId = sessionStorage.getItem('spectator-id') ?? (() => {
    const id = crypto.randomUUID();
    sessionStorage.setItem('spectator-id', id);
    return id;
})();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const auraEl          = document.querySelector('#aura');
const chaosVignetteEl = document.querySelector('#chaos-vignette');
const noteCanvasEl    = document.getElementById('note-canvas');

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const socketUrl = import.meta.env.DEV
    ? `http://localhost:${import.meta.env.VITE_SERVER_PORT ?? 3000}`
    : (import.meta.env.VITE_SOCKET_URL || '/');

const socket = ioConnect(socketUrl, { reconnectionDelay: 2000, transports: ['websocket'] });

socket.on('connect', () => {
    socket.emit('join-session', { room, spectatorId });
});

socket.on('joined', () => {
    sendEvent('color-pick', { color: pushedColor });
});

socket.on('connect_error', () => console.warn('[remote] connection failed, retrying…'));
socket.on('disconnect',    () => console.warn('[remote] disconnected'));

socket.on('host-reconnected', () => {
    socket.emit('join-session', { room, spectatorId });
});

socket.on('note-debounce', ({ ms } = {}) => {
    _noteDebounceMs = ms ?? 0;
});

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

// ── Story step ────────────────────────────────────────────────────────────────
let _currentStep = -1;

// ── Aura ──────────────────────────────────────────────────────────────────────
let pushedColor = '#2495FF';

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

function updateAura() {
    if (!auraEl) return;
    auraEl.style.background = '#000000';
}
updateAura();

// ── Keyboard — A minor pentatonic D3–A4 ──────────────────────────────────────
const KEYS = [
    { freq: 146.83, color: '#FF3B3B' },  // D3
    { freq: 164.81, color: '#FF8C00' },  // E3
    { freq: 196.00, color: '#FFD700' },  // G3
    { freq: 220.00, color: '#7ED321' },  // A3
    { freq: 261.63, color: '#00CC66' },  // C4
    { freq: 293.66, color: '#00CFCF' },  // D4
    { freq: 329.63, color: '#4A90E2' },  // E4
    { freq: 392.00, color: '#9B59B6' },  // G4
    { freq: 440.00, color: '#E91E8C' },  // A4
];

// ── Audio ─────────────────────────────────────────────────────────────────────
let _audioCtx     = null;
let _reverbNode   = null;
let _reverbSend   = null;
let _contOsc      = null;
let _contGainNode = null;
let _contOscReady = false;
let _activeNoteIdx = -1;

function _ensureAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
}

// Safari iOS sospende l'AudioContext quando la pagina va in background o arriva
// un'interruzione (chiamata, Siri). Ripristiniamo al ritorno senza richiedere un gesto.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _audioCtx?.state === 'suspended') {
        _audioCtx.resume();
    }
});

function _ensureReverb(ctx) {
    if (_reverbNode) return;
    const sr  = ctx.sampleRate;
    const len = Math.floor(sr * 1.8);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++)
            d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    _reverbNode = ctx.createConvolver();
    _reverbNode.buffer = buf;
    _reverbSend = ctx.createGain();
    _reverbSend.gain.value = 0.42;
    _reverbNode.connect(_reverbSend);
    _reverbSend.connect(ctx.destination);
}

function _startContOsc() {
    if (_contOscReady) return;
    const ctx = _ensureAudioCtx();
    _ensureReverb(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2200;
    filter.Q.value = 0.5;
    _contGainNode = ctx.createGain();
    _contGainNode.gain.value = 0;
    _contOsc = ctx.createOscillator();
    _contOsc.type = 'triangle';
    _contOsc.frequency.value = KEYS[4].freq;
    _contOsc.connect(filter);
    filter.connect(_contGainNode);
    _contGainNode.connect(ctx.destination);
    _contGainNode.connect(_reverbNode);
    _contOsc.start();
    _contOscReady = true;
}

let _noteDebounceMs    = 0;
let _noteDebounceTimer = null;

function _setContNote(noteIdx) {
    if (_currentStep <= 0 || !_contOscReady) return;
    const t = _audioCtx.currentTime;
    if (noteIdx !== _activeNoteIdx) {
        _contOsc.frequency.setTargetAtTime(KEYS[noteIdx].freq, t, 0.04);
        _activeNoteIdx = noteIdx;
        _motionChaos = Math.min(1, _motionChaos + 0.05);
        _sinePulse = 1;
        clearTimeout(_noteDebounceTimer);
        _noteDebounceTimer = setTimeout(() => {
            sendEvent('note', { index: noteIdx, freq: KEYS[noteIdx].freq, color: KEYS[noteIdx].color });
        }, _noteDebounceMs);
    }
    _contGainNode.gain.setTargetAtTime(0.25, t, 0.05);
}

function _silenceContNote() {
    if (_currentStep <= 0 || !_contOscReady) return;
    clearTimeout(_noteDebounceTimer);
    _noteDebounceTimer = null;
    _contGainNode.gain.setTargetAtTime(0, _audioCtx.currentTime, 0.12);
    _activeNoteIdx = -1;
    sendEvent('note-off', {});
}

// ── Chaos vignette ────────────────────────────────────────────────────────────
let _motionChaos = 0;
const MOTION_DECAY_RATE = 0.5; // full chaos → zero in ~2 s of stillness

function _applyChaosVisuals() {
    if (!chaosVignetteEl) return;
    const v = _motionChaos.toFixed(3);
    if (chaosVignetteEl.style.opacity === v) return;
    chaosVignetteEl.style.opacity = v;
}

// ── Smoke ─────────────────────────────────────────────────────────────────────
const _smoke     = [];
const _SMOKE_MAX = 60;

function _spawnSmoke(x, y, cf) {
    if (_smoke.length >= _SMOKE_MAX) return;
    const spread = 6 + (1 - cf) * 44;
    const n = 1 + Math.round(cf * 2);
    for (let i = 0; i < n; i++) {
        _smoke.push({
            x:     x + (Math.random() - 0.5) * spread,
            y:     y + (Math.random() - 0.5) * spread * 0.4,
            vx:    (Math.random() - 0.5) * 0.5,
            vy:    -(0.5 + Math.random() * 1.2),
            life:  1.0,
            decay: 0.010 + (1 - cf) * 0.018,
            size:  cf > 0.6 ? 2 : 3 + Math.round((1 - cf) * 4),
        });
    }
}

function _tickSmoke(ctx2d, w, h) {
    if (_smoke.length === 0) return;
    for (let i = _smoke.length - 1; i >= 0; i--) {
        const p = _smoke[i];
        p.x   += p.vx;
        p.y   += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) { _smoke.splice(i, 1); continue; }
        ctx2d.globalAlpha = Math.pow(p.life, 1.4) * 0.9;
        ctx2d.fillStyle = '#ffffff';
        const s = p.size;
        ctx2d.fillRect(Math.round(p.x) - s, Math.round(p.y) - s, s * 2, s * 2);
    }
    ctx2d.globalAlpha = 1;
}

// ── Note canvas ───────────────────────────────────────────────────────────────
// Guard: called once from the join handler, safe against duplicate invocations.
let _noteCanvasInit = false;

function _initNoteCanvas() {
    if (_noteCanvasInit || !noteCanvasEl) return;
    _noteCanvasInit = true;

    function resize() {
        noteCanvasEl.width  = noteCanvasEl.offsetWidth;
        noteCanvasEl.height = noteCanvasEl.offsetHeight;
    }
    resize();
    new ResizeObserver(resize).observe(noteCanvasEl);

    const ctx2d = noteCanvasEl.getContext('2d');
    let _touching = false, _touchX = 0, _touchY = 0;
    let _lastSentHue = -1;

    function _cf(x, y) {
        const w = noteCanvasEl.width, h = noteCanvasEl.height;
        const dx = (x / w - 0.5) * 2, dy = (y / h - 0.5) * 2;
        return Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / Math.SQRT2);
    }

    function _noteIdx(x) {
        return Math.min(KEYS.length - 1, Math.floor(Math.max(0, x / noteCanvasEl.width) * KEYS.length));
    }

    function _applyColor(y) {
        const hue = Math.round((Math.max(0, Math.min(1, y / noteCanvasEl.height)) * 270) / 10) * 10;
        if (hue === _lastSentHue) return;
        _lastSentHue = hue;
        const hex = hslToHex(hue, 80, 50);
        pushedColor = hex;
        updateAura();
        sendEvent('color-pick', { color: hex });
    }

    noteCanvasEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        noteCanvasEl.setPointerCapture(e.pointerId);
        _touching = true;
        _touchX = e.offsetX; _touchY = e.offsetY;
        // Safari può ri-sospendere il context dopo un'interruzione; il gesto dell'utente
        // è il momento giusto per ripristinarlo senza rischiare il blocco autoplay.
        if (_audioCtx?.state === 'suspended') _audioCtx.resume();
        _setContNote(_noteIdx(_touchX));
        _applyColor(_touchY);
    });

    noteCanvasEl.addEventListener('pointermove', (e) => {
        if (!_touching) return;
        _touchX = e.offsetX; _touchY = e.offsetY;
        _setContNote(_noteIdx(_touchX));
        _applyColor(_touchY);
    });

    noteCanvasEl.addEventListener('pointerup',     () => { _touching = false; _silenceContNote(); });
    noteCanvasEl.addEventListener('pointercancel', () => { _touching = false; _silenceContNote(); });

    let _lastSpawn  = 0;
    let _lastChaosT = 0;

    // ── Sine wave state ───────────────────────────────────────────────────────
    let _sineAmp   = 0;
    let _sinePhase = 0;
    let _sinePulse = 0; // set to 1 on note change, decays quickly → mini burst

    function _drawSine(w, h, dt) {
        if (_currentStep < 1) return;
        _sineAmp = _touching
            ? Math.min(1, _sineAmp + 6 * dt)
            : Math.max(0, _sineAmp - 2 * dt);
        _sinePulse = Math.max(0, _sinePulse - dt * 5); // decade in ~0.2s
        if (_sineAmp <= 0.01) return;

        const idx    = Math.max(0, _activeNoteIdx);
        const cycles = 1 + (idx / (KEYS.length - 1)) * 5; // 1–6 cicli visivi
        const freq   = KEYS[idx]?.freq ?? KEYS[4].freq;
        _sinePhase  += (freq / 220) * dt * 3;

        const color = _currentStep >= 2 ? pushedColor : '#ffffff';
        const amp   = h * 0.32 * _sineAmp * (1 + _sinePulse * 0.6);
        const cy    = h / 2;

        ctx2d.save();
        ctx2d.globalAlpha = _sineAmp * 0.9;
        ctx2d.strokeStyle = color;
        ctx2d.lineWidth   = 2.5;
        ctx2d.beginPath();
        for (let x = 0; x <= w; x += 2) {
            const t = (x / w) * cycles * Math.PI * 2 + _sinePhase;
            const y = cy + Math.sin(t) * amp;
            x === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y);
        }
        ctx2d.stroke();
        ctx2d.restore();
    }

    (function loop(ts) {
        requestAnimationFrame(loop);
        const dt = _lastChaosT > 0 ? (ts - _lastChaosT) / 1000 : 0;
        _motionChaos = Math.max(0, _motionChaos - MOTION_DECAY_RATE * dt);
        _applyChaosVisuals();
        _lastChaosT = ts;

        ctx2d.clearRect(0, 0, noteCanvasEl.width, noteCanvasEl.height);
        _drawSine(noteCanvasEl.width, noteCanvasEl.height, dt);

        if (_touching && ts - _lastSpawn > 25) {
            _spawnSmoke(_touchX, _touchY, _cf(_touchX, _touchY));
            _lastSpawn = ts;
        }
        _tickSmoke(ctx2d, noteCanvasEl.width, noteCanvasEl.height);
    })(0);
}

// ── Story step socket handler ─────────────────────────────────────────────────
const _stepDebug = document.querySelector('#step-debug');
socket.on('story-step', ({ step } = {}) => {
    _currentStep = typeof step === 'number' ? step : -1;
    if (_stepDebug) _stepDebug.textContent = _currentStep >= 0 ? _currentStep : '';
    updateAura();
});

// ── Init on first gesture (AudioContext requires user interaction on iOS) ─────
const _tapHint = document.querySelector('#tap-hint');
document.addEventListener('pointerdown', () => {
    _startContOsc();
    _initNoteCanvas();
    _tapHint?.classList.add('hidden');
}, { once: true });
