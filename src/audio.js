// ── Audio input → volume ──────────────────────────────────────────────────────
// Currently: microphone via getUserMedia.
// Future: swap _connect() to accept an AudioNode from the server stream.
//
// getVolume() returns a smoothed 0–1 amplitude each frame.
// When inactive it returns 1.0 so the sim is unaffected.

const FFT_SIZE    = 256;
const EMA_ALPHA   = 0.12; // smoothing — lower = slower reaction
const RAW_CEILING = 0.25; // RMS level mapped to volume 1.0 (typical speech peak)

let _ctx      = null;
let _analyser = null;
let _buf      = null;
let _stream   = null;
let _vol      = 0;
let _active   = false;

function _connect(sourceNode) {
    _analyser = _ctx.createAnalyser();
    _analyser.fftSize              = FFT_SIZE;
    _analyser.smoothingTimeConstant = 0; // we do our own EMA
    sourceNode.connect(_analyser);
    _buf    = new Float32Array(FFT_SIZE);
    _active = true;
}

export async function startMic() {
    if (_active) return;
    _stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    _ctx = new AudioContext();
    _connect(_ctx.createMediaStreamSource(_stream));
    _vol = 0;
}

export function stopAudio() {
    if (!_active) return;
    _stream?.getTracks().forEach(t => t.stop());
    _ctx?.close();
    _ctx = _analyser = _buf = _stream = null;
    _vol    = 0;
    _active = false;
}

export function isActive() { return _active; }

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
