import './style.css';
import { io as ioConnect } from 'socket.io-client';

// ── Session ───────────────────────────────────────────────────────────────────
const urlParams   = new URLSearchParams(window.location.search);
const room        = urlParams.get('s');
const isBot       = urlParams.get('bot') === '1';

// sessionStorage is shared across all same-origin iframes in one tab, so bots
// must mint a fresh id — otherwise the server collapses every tile into one
// spectator. Real remotes keep the stable per-tab id.
const spectatorId = isBot
    ? crypto.randomUUID()
    : (sessionStorage.getItem('spectator-id') ?? (() => {
        const id = crypto.randomUUID();
        sessionStorage.setItem('spectator-id', id);
        return id;
    })());

// ── DOM refs ──────────────────────────────────────────────────────────────────
const auraEl          = document.querySelector('#aura');
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
    auraEl.style.background = _currentStep >= 2 ? pushedColor : '#000000';
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
let _audioCtx   = null;
let _reverbNode = null;
let _reverbSend = null;

function _ensureAudioCtx() {
    if (!_audioCtx) {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        // iOS 16.4+: declare a playback session so Web Audio is routed through the
        // media channel — it then ignores the hardware silent switch and follows the
        // media volume instead of the (often muted) ringer volume.
        if ('audioSession' in navigator) navigator.audioSession.type = 'playback';
    }
    // iOS may leave the context 'suspended' or in the non-standard 'interrupted'
    // state (after a call, Siri, or focus loss). Resume on anything but 'running'.
    if (_audioCtx.state !== 'running') _audioCtx.resume();
    return _audioCtx;
}

// Safari iOS suspends/interrupts the AudioContext when the page goes to the
// background or an interruption arrives (call, Siri). Restore it on return
// without requiring a fresh user gesture.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _audioCtx && _audioCtx.state !== 'running') {
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

// ── Chirp — local speakBinary played on the phone's own AudioContext ──────────
// Exactly mirrors the sim's speakBinary: sine gliding between two frequencies,
// 200ms per bit. note index → value (index+1) → binary string → melodic glide.
const CHIRP_BIT_MS      = 200;
const CHIRP_COOLDOWN_MS = 800;

let _chirpCooldownUntil = 0;

// oneHz / zeroHz are per-zone so each circle has its own distinctive pitch.
// Default to the original 1245/623 Hz pair for backwards-compat callers.
function _localChirp(noteIdx, oneHz = 1245, zeroHz = 623) {
    const ctx  = _ensureAudioCtx();
    _ensureReverb(ctx);
    const value = noteIdx + 1;
    const bits  = value.toString(2);
    const dur   = (bits.length * CHIRP_BIT_MS) / 1000;
    const glide = (CHIRP_BIT_MS / 1000) * 0.55;
    const freqAt = i => bits[i] === '1' ? oneHz : zeroHz;

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (_reverbNode) gain.connect(_reverbNode);

    const t0 = ctx.currentTime + 0.02;
    osc.frequency.setValueAtTime(freqAt(0), t0);
    for (let i = 1; i < bits.length; i++) {
        osc.frequency.exponentialRampToValueAtTime(freqAt(i), t0 + (i * CHIRP_BIT_MS) / 1000 + glide);
    }
    gain.gain.setValueAtTime(0.22, t0);
    gain.gain.linearRampToValueAtTime(0.001, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.1);
}

// ── Chirp rings — expanding circle at tap point ───────────────────────────────
const _chirpRings = [];

function _spawnChirpRing(x, y) {
    _chirpRings.push({ x, y, t: 0, color: _currentStep >= 2 ? pushedColor : '#ffffff' });
}

function _tickChirpRings(ctx2d, dt) {
    for (let i = _chirpRings.length - 1; i >= 0; i--) {
        const r = _chirpRings[i];
        r.t += dt;
        const k = r.t / 0.45;
        if (k >= 1) { _chirpRings.splice(i, 1); continue; }
        ctx2d.save();
        ctx2d.strokeStyle = r.color;
        ctx2d.lineWidth   = 2;
        ctx2d.globalAlpha = (1 - k) * 0.85;
        ctx2d.beginPath();
        ctx2d.arc(r.x, r.y, 12 + k * 55, 0, Math.PI * 2);
        ctx2d.stroke();
        ctx2d.restore();
    }
}

// Older iOS (< 16.4) has no navigator.audioSession. Playing a silent looping
// <audio> element on the unlock gesture flips the media session category so that
// subsequent Web Audio output is routed through the media channel too, ignoring
// the silent switch. No-op where navigator.audioSession is available.
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
        ctx2d.fillStyle = _currentStep >= 2 ? pushedColor : '#ffffff';
        const s = p.size;
        ctx2d.fillRect(Math.round(p.x) - s, Math.round(p.y) - s, s * 2, s * 2);
    }
    ctx2d.globalAlpha = 1;
}

// ── Note canvas ───────────────────────────────────────────────────────────────
// Guard: called once from the join handler, safe against duplicate invocations.
let _noteCanvasInit = false;

// Bot sync overrides, set by the simremotes dashboard via postMessage. null =
// autonomous wander on that axis; a value locks it. note: 0–8, hue: 0–270.
let _botCmdNote = null;
let _botCmdHue  = null;

function _initNoteCanvas() {
    if (_noteCanvasInit || !noteCanvasEl) return;
    _noteCanvasInit = true;

    const ctx2d = noteCanvasEl.getContext('2d');

    function _flashAura() {
        if (!auraEl) return;
        auraEl.style.transition = 'background 0s, opacity 0.05s ease';
        auraEl.style.opacity = '0.6';
        setTimeout(() => {
            auraEl.style.transition = 'background 0.6s ease, opacity 0.5s ease';
            auraEl.style.opacity = '1';
        }, 80);
    }

    // ── Bubbles — small colored discs, max 3 on screen ───────────────────────
    // Each bubble has its own note + pitch pair (freq×5 / freq×2.5 keeps the
    // octave-glide character while shifting each bubble into a distinct register).
    // Tapping a bubble: plays its chirp, replaces it with a new random one.
    // Hidden when _currentStep < 2 (no color phase yet).
    const MAX_BUBBLES   = 3;
    const BUBBLE_R      = 26;   // radius in px — small
    const BUBBLE_GAP    = 90;   // min center-to-center distance between bubbles
    const BUBBLE_MARGIN = 40;   // edge margin in px
    const ALL_NOTE_IDX  = [0, 1, 2, 3, 4, 5, 6, 7, 8];

    let _bubbles = []; // active bubble objects

    function _makeBubble(existing) {
        const w = noteCanvasEl.width  || 375;
        const h = noteCanvasEl.height || 667;
        const noteIdx = ALL_NOTE_IDX[Math.floor(Math.random() * ALL_NOTE_IDX.length)];
        const freq    = KEYS[noteIdx].freq;
        for (let attempt = 0; attempt < 40; attempt++) {
            const x = BUBBLE_MARGIN + Math.random() * (w - 2 * BUBBLE_MARGIN);
            const y = BUBBLE_MARGIN + Math.random() * (h - 2 * BUBBLE_MARGIN);
            const ok = existing.every(b => {
                const dx = x - b.x, dy = y - b.y;
                return dx * dx + dy * dy >= BUBBLE_GAP * BUBBLE_GAP;
            });
            if (ok) return { x, y, r: BUBBLE_R, noteIdx, color: KEYS[noteIdx].color, freq, oneHz: freq * 5, zeroHz: freq * 2.5 };
        }
        // Fallback: ignore collision constraint after 40 attempts
        return {
            x: BUBBLE_MARGIN + Math.random() * (w - 2 * BUBBLE_MARGIN),
            y: BUBBLE_MARGIN + Math.random() * (h - 2 * BUBBLE_MARGIN),
            r: BUBBLE_R, noteIdx, color: KEYS[noteIdx].color, freq, oneHz: freq * 5, zeroHz: freq * 2.5,
        };
    }

    function _initBubbles() {
        _bubbles = [];
        for (let i = 0; i < MAX_BUBBLES; i++) _bubbles.push(_makeBubble(_bubbles));
    }

    function _bubbleAt(x, y) {
        for (let i = _bubbles.length - 1; i >= 0; i--) {
            const b = _bubbles[i];
            const dx = x - b.x, dy = y - b.y;
            if (dx * dx + dy * dy <= b.r * b.r) return i;
        }
        return -1;
    }

    function _replaceBubble(idx) {
        _bubbles.splice(idx, 1);
        _bubbles.push(_makeBubble(_bubbles));
    }

    function _drawBubbles(ctx2d, ts) {
        if (_currentStep < 2) return;
        for (const b of _bubbles) {
            const breathe = 0.82 + 0.18 * Math.sin(ts * 0.0014 + b.x * 0.05);
            ctx2d.save();
            ctx2d.globalAlpha = 0.30 * breathe;
            ctx2d.fillStyle   = b.color;
            ctx2d.beginPath();
            ctx2d.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx2d.fill();
            ctx2d.globalAlpha = 0.72 * breathe;
            ctx2d.strokeStyle = b.color;
            ctx2d.lineWidth   = 1.5;
            ctx2d.stroke();
            ctx2d.restore();
        }
    }

    // Initialise once canvas has a real size
    function resize() {
        noteCanvasEl.width  = noteCanvasEl.offsetWidth;
        noteCanvasEl.height = noteCanvasEl.offsetHeight;
        if (_bubbles.length === 0 && noteCanvasEl.width > 0) _initBubbles();
    }
    resize();
    new ResizeObserver(resize).observe(noteCanvasEl);

    // ── Tap-to-chirp ─────────────────────────────────────────────────────────
    noteCanvasEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (_currentStep < 2) return; // bubbles not visible yet

        const idx = _bubbleAt(e.offsetX, e.offsetY);
        if (idx === -1) return; // missed all bubbles

        const now = performance.now();
        if (now < _chirpCooldownUntil) return;
        _chirpCooldownUntil = now + CHIRP_COOLDOWN_MS;

        const bubble = _bubbles[idx];
        if (_audioCtx && _audioCtx.state !== 'running') _audioCtx.resume();

        pushedColor = bubble.color;
        updateAura();
        _localChirp(bubble.noteIdx, bubble.oneHz, bubble.zeroHz);
        _spawnChirpRing(e.offsetX, e.offsetY);
        _flashAura();

        if (_currentStep >= 1) {
            sendEvent('color-pick', { color: bubble.color });
            sendEvent('chirp', { index: bubble.noteIdx, freq: bubble.freq, color: bubble.color });
        }

        _replaceBubble(idx); // this bubble gone, new one spawns
    });

    let _lastChaosT = 0;

    // ── Sine wave state (kept for potential future use) ────────────────────
    let _sineAmp   = 0;
    let _sinePhase = 0;

    function _drawSine(w, h, dt) {
        return; // sine wave replaced by pixel pool interaction
        _sineAmp = _touching
            ? Math.min(1, _sineAmp + 6 * dt)
            : Math.max(0, _sineAmp - 2 * dt);
        _sinePulse = Math.max(0, _sinePulse - dt * 5);
        if (_sineAmp <= 0.01) return;

        const idx    = Math.max(0, _activeNoteIdx);
        const cycles = 1 + (idx / (KEYS.length - 1)) * 5;
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

    // ── Center pixel pool ─────────────────────────────────────────────────────
    // Pixels rest in a disk at center. On touch they drain toward the finger;
    // on note change they burst outward then spring back. Adaptive count keeps
    // fps above 30 while maximising density (floor: 30, no hard ceiling).
    const _pool    = [];
    const POOL_R   = 22;
    let   _poolMax = 105;
    const _POOL_MIN      = 30;
    const _POOL_HARD_MAX = 600;
    const _fpsHistory    = [];

    function _adaptPoolMax(dt) {
        if (dt <= 0) return;
        _fpsHistory.push(dt);
        if (_fpsHistory.length > 20) _fpsHistory.shift();
        if (_fpsHistory.length < 10) return;
        const avg = _fpsHistory.reduce((a, b) => a + b, 0) / _fpsHistory.length;
        const fps = 1 / avg;
        if      (fps > 40) _poolMax = Math.min(_POOL_HARD_MAX, _poolMax + 5);
        else if (fps < 28) _poolMax = Math.max(_POOL_MIN,      _poolMax - 10);
    }

    function _refillPool(cx, cy) {
        while (_pool.length < _poolMax) {
            const angle = Math.random() * Math.PI * 2;
            const r     = Math.sqrt(Math.random()) * POOL_R;
            _pool.push({
                x:     cx + Math.cos(angle) * r,
                y:     cy + Math.sin(angle) * r,
                vx:    (Math.random() - 0.5) * 0.2,
                vy:    (Math.random() - 0.5) * 0.2,
                phase: Math.random() * Math.PI * 2, // idle float phase offset
                life:  Math.random() * 0.4,         // stagger fade-in
            });
        }
    }

    function _tickPool(ctx2d, w, h, dt, ts) {
        if (_currentStep < 0) { _pool.length = 0; return; }
        const cx = w / 2, cy = h / 2;
        if (!_touching) _refillPool(cx, cy);

        _poolShake = Math.max(0, _poolShake - dt * 4);

        for (let i = _pool.length - 1; i >= 0; i--) {
            const p = _pool[i];

            // Touch repulsion — push dots away from finger
            if (_touching) {
                const tdx  = p.x - _touchX, tdy = p.y - _touchY;
                const tdist = Math.sqrt(tdx * tdx + tdy * tdy) + 0.001;
                const force = Math.max(0, 1 - tdist / 100) * 350;
                p.vx += (tdx / tdist) * force * dt;
                p.vy += (tdy / tdist) * force * dt;
            }

            // Note shake: burst outward from center
            if (_poolShake > 0) {
                const ox = p.x - cx, oy = p.y - cy;
                const od = Math.sqrt(ox * ox + oy * oy) + 0.001;
                p.vx += (ox / od) * _poolShake * 90 * dt + (Math.random() - 0.5) * _poolShake * 50 * dt;
                p.vy += (oy / od) * _poolShake * 90 * dt + (Math.random() - 0.5) * _poolShake * 50 * dt;
            }

            // Idle float
            p.vx += Math.sin(ts * 0.001  + p.phase) * 0.25 * dt;
            p.vy += Math.cos(ts * 0.0007 + p.phase) * 0.18 * dt;

            // Spring back toward pool disk
            const dx   = cx - p.x, dy = cy - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            p.vx += dx * (dist > POOL_R ? 0.12 : 0.02) * dt;
            p.vy += dy * (dist > POOL_R ? 0.12 : 0.02) * dt;
            p.vx *= 0.88; p.vy *= 0.88;
            p.life = Math.min(1, p.life + dt * 3);

            p.x += p.vx; p.y += p.vy;
            ctx2d.globalAlpha = p.life * 0.9;
            ctx2d.fillStyle   = _currentStep >= 2 ? pushedColor : '#ffffff';
            ctx2d.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
        }
        ctx2d.globalAlpha = 1;
    }

    (function loop(ts) {
        requestAnimationFrame(loop);
        const dt = _lastChaosT > 0 ? (ts - _lastChaosT) / 1000 : 0;
        _adaptPoolMax(dt);
        _lastChaosT = ts;

        const _w = noteCanvasEl.width, _h = noteCanvasEl.height;
        ctx2d.clearRect(0, 0, _w, _h);

        _drawBubbles(ctx2d, ts);
        _tickChirpRings(ctx2d, dt);
    })(0);

    // ── Bot autopilot ─────────────────────────────────────────────────────────
    // A fake finger wanders on a per-tile Lissajous curve, driving the exact same
    // path a real pointermove takes so smoke, aura and server events match.
    if (isBot) {
        const i  = parseInt(urlParams.get('i') ?? '0', 10) || 0;
        const fx = 0.11 + (i % 5) * 0.017;
        const fy = 0.07 + (i % 3) * 0.023;
        const px = (i * 1.3) % (Math.PI * 2);
        const py = (i * 2.1) % (Math.PI * 2);
        const CHIRP_MIN = 2000 + (i % 4) * 500;
        const CHIRP_MAX = 5000 + (i % 3) * 1000;

        function _botChirp() {
            const delay = CHIRP_MIN + Math.random() * (CHIRP_MAX - CHIRP_MIN);
            if (_bubbles.length === 0 || _currentStep < 1) { setTimeout(_botChirp, delay); return; }
            // Pick a bubble: prefer the one whose noteIdx is closest to the
            // commanded note, otherwise pick randomly.
            let bubble;
            if (_botCmdNote !== null) {
                bubble = _bubbles.reduce((best, b) =>
                    Math.abs(b.noteIdx - _botCmdNote) < Math.abs(best.noteIdx - _botCmdNote) ? b : best
                );
            } else {
                bubble = _bubbles[Math.floor(Math.random() * _bubbles.length)];
            }
            pushedColor = bubble.color;
            sendEvent('chirp', { index: bubble.noteIdx, freq: bubble.freq, color: bubble.color });
            setTimeout(_botChirp, delay);
        }
        setTimeout(_botChirp, Math.random() * 3000);
    }
}

// ── Story step socket handler ─────────────────────────────────────────────────
// _stepDebug is intentional — keep it. Small phase number at top for director use.
const _stepDebug = document.querySelector('#step-debug');
socket.on('story-step', ({ step } = {}) => {
    _currentStep = typeof step === 'number' ? step : -1;
    if (_stepDebug) _stepDebug.textContent = _currentStep >= 0 ? _currentStep + 1 : '';
    updateAura();
});

// ── Init ──────────────────────────────────────────────────────────────────────
// Canvas loop starts immediately so the pixel pool is visible before first touch.
// AudioContext requires a user gesture, so the oscillator is deferred.
const _tapHint = document.querySelector('#tap-hint');
_initNoteCanvas();
if (isBot) {
    _tapHint?.classList.add('hidden');
    window.addEventListener('message', (e) => {
        if (e.origin !== window.location.origin) return;
        const d = e.data;
        if (!d || d.type !== 'bot-cmd') return;
        if ('note' in d) _botCmdNote = d.note;
        if ('hue'  in d) _botCmdHue  = d.hue;
    });
    try { window.parent?.postMessage({ type: 'bot-ready' }, window.location.origin); } catch {}
}
document.addEventListener('pointerdown', () => {
    _silentAudioKick();
    _tapHint?.classList.add('hidden');
}, { once: true });
