// ── Audio input → volume ──────────────────────────────────────────────────────
// Three sources feed the same analyser pipeline:
//   • Microphone (getUserMedia)  — via startMic()
//   • Voiceover  (base64, once)  — via playAudio()    key: "audio"
//   • Background (base64, loop)  — via playAudioBg()  key: "audiobg"
// All three drive getVolume(), which the sim reads each frame for brightness.
// Sending null/empty for either audio key stops that track immediately.

const FFT_SIZE    = 256;
const EMA_ALPHA   = 0.12; // smoothing — lower = slower reaction
const RAW_CEILING = 0.25; // RMS level mapped to volume 1.0 (typical speech peak)

let _ctx       = null;
let _analyser  = null;
let _buf       = null;
let _stream    = null;
let _vol       = 0;
let _active    = false;
let _voiceSrc  = null; // currently playing voiceover BufferSourceNode
let _bgSrc     = null; // currently playing background BufferSourceNode

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

function _stopSrc(src) {
    try { src?.stop(); } catch (_) {}
}

async function _decode(base64) {
    _ensureAnalyser();
    if (_ctx.state === 'suspended') await _ctx.resume();
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return _ctx.decodeAudioData(bytes.buffer);
}

export async function startMic() {
    if (_stream) return;
    _stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    _ensureCtx();
    _connect(_ctx.createMediaStreamSource(_stream));
    _vol = 0;
}

// Voiceover track — plays once. Null/empty stops any running voiceover.
export async function playAudio(base64, mimeType = 'audio/webm;codecs=opus') {
    _stopSrc(_voiceSrc);
    _voiceSrc = null;
    if (!base64) return;
    const audioBuffer = await _decode(base64);
    _voiceSrc         = _ctx.createBufferSource();
    _voiceSrc.buffer  = audioBuffer;
    _voiceSrc.connect(_analyser);
    _voiceSrc.connect(_ctx.destination);
    _voiceSrc.onended = () => { _voiceSrc = null; };
    _voiceSrc.start();
}

// Background track — loops until stopped. Null/empty stops the loop.
export async function playAudioBg(base64, mimeType = 'audio/webm;codecs=opus') {
    _stopSrc(_bgSrc);
    _bgSrc = null;
    if (!base64) return;
    const audioBuffer = await _decode(base64);
    _bgSrc            = _ctx.createBufferSource();
    _bgSrc.buffer     = audioBuffer;
    _bgSrc.loop       = true;
    _bgSrc.connect(_analyser);
    _bgSrc.connect(_ctx.destination);
    _bgSrc.start();
}

export function stopAudio() {
    _stopSrc(_voiceSrc); _voiceSrc = null;
    _stopSrc(_bgSrc);    _bgSrc    = null;
    if (!_active && !_stream) return;
    _stream?.getTracks().forEach(t => t.stop());
    _ctx?.close();
    _ctx = _analyser = _buf = _stream = null;
    _vol    = 0;
    _active = false;
}

export function isActive() { return _active; }

// Call on first user interaction to satisfy the browser autoplay policy.
export async function unlockAudio() {
    _ensureAnalyser();
    if (_ctx.state === 'suspended') await _ctx.resume();
}

// Call once per frame. Returns a smoothed 0–1 brightness multiplier; 1.0 when off.
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
