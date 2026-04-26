// ── Audio input → volume ──────────────────────────────────────────────────────
// Two sources feed the same analyser pipeline:
//   • Microphone (getUserMedia)  — via startMic()
//   • Server-sent audio (base64) — via playAudio()
// Both drive getVolume(), which the sim reads each frame for brightness.

const FFT_SIZE    = 256;
const EMA_ALPHA   = 0.12; // smoothing — lower = slower reaction
const RAW_CEILING = 0.25; // RMS level mapped to volume 1.0 (typical speech peak)

let _ctx      = null;
let _analyser = null;
let _buf      = null;
let _stream   = null;
let _vol      = 0;
let _active   = false;

function _ensureCtx() {
    if (!_ctx) _ctx = new AudioContext();
}

function _ensureAnalyser() {
    if (_analyser) return;
    _ensureCtx();
    _analyser = _ctx.createAnalyser();
    _analyser.fftSize               = FFT_SIZE;
    _analyser.smoothingTimeConstant = 0; // we do our own EMA
    _buf    = new Float32Array(FFT_SIZE);
    _active = true;
}

function _connect(sourceNode) {
    _ensureAnalyser();
    sourceNode.connect(_analyser);
}

export async function startMic() {
    if (_stream) return;
    _stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    _ensureCtx();
    _connect(_ctx.createMediaStreamSource(_stream));
    _vol = 0;
}

// Decode base64 audio and play it through the same analyser pipeline.
// mimeType defaults to Opus; pass a different value only if needed.
export async function playAudio(base64, mimeType = 'audio/webm;codecs=opus') {
    _ensureAnalyser();
    if (_ctx.state === 'suspended') await _ctx.resume();
    const bytes       = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const audioBuffer = await _ctx.decodeAudioData(bytes.buffer);
    const source      = _ctx.createBufferSource();
    source.buffer     = audioBuffer;
    source.connect(_analyser);        // drives volume / brightness
    source.connect(_ctx.destination); // plays to speakers
    source.start();
}

export function stopAudio() {
    if (!_active && !_stream) return;
    _stream?.getTracks().forEach(t => t.stop());
    _ctx?.close();
    _ctx = _analyser = _buf = _stream = null;
    _vol    = 0;
    _active = false;
}

export function isActive() { return _active; }

// Call on first user interaction to satisfy the browser autoplay policy.
// Safe to call multiple times — no-ops if already running.
export async function unlockAudio() {
    _ensureAnalyser();
    if (_ctx.state === 'suspended') await _ctx.resume();
}

// Call once per frame (inside the render loop).
// Returns a smoothed 0–1 brightness multiplier; 1.0 when audio is off.
export function getVolume() {
    if (!_active || !_analyser) return 1.0;
    _analyser.getFloatTimeDomainData(_buf);
    let sum = 0;
    for (let i = 0; i < _buf.length; i++) sum += _buf[i] * _buf[i];
    const rms = Math.sqrt(sum / _buf.length);
    const raw = Math.min(rms / RAW_CEILING, 1.0);
    _vol += (raw - _vol) * EMA_ALPHA;
    return _vol;
}
