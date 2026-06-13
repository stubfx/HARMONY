// ── Audio input → volume ──────────────────────────────────────────────────────
// Three sources feed the same analyser pipeline:
//   • Microphone (getUserMedia)  — via startMic()
//   • Voiceover  (base64, once)  — via playAudio()    key: "audio"
//   • Background (base64, loop)  — via playAudioBg()  key: "audiobg"
// All three drive getVolume(), which the sim reads each frame for brightness.
// Sending null/empty for either audio key stops that track immediately.
//
// Ducking: when a voiceover plays, the bg track is smoothly attenuated to
// DUCK_LEVEL and restored when the voiceover ends (naturally or via stop).

const FFT_SIZE    = 256;
const EMA_ALPHA   = 0.12; // smoothing — lower = slower reaction
const RAW_CEILING = 0.25; // RMS level mapped to volume 1.0 (typical speech peak)

let _duckLevel = 0.15; // bg gain while voiceover is active — adjustable via setDuckLevel()
export function setDuckLevel(v) { _duckLevel = Math.max(0, Math.min(1, v)); }
const DUCK_ATTACK  = 0.3;  // seconds to ramp down
const DUCK_RELEASE = 1.0;  // seconds to ramp back up after voice ends

// ── Chaos modulation ──────────────────────────────────────────────────────────
// setChaos(0-1): 0 = armonia (filter fully open, no tremolo)
//               1 = chaos   (filter closed ~200Hz, tremolo at max depth)
// Applied to both bg track and voice track (prepared for future OpenAI audio flow).
const CHAOS_FREQ_MIN  = 200;   // Hz — filter cutoff at full chaos
const CHAOS_FREQ_MAX  = 8000;  // Hz — filter cutoff at full harmony
const CHAOS_LFO_FREQ  = 4;     // Hz — tremolo oscillation rate
const CHAOS_LFO_MAX   = 0.25;  // max tremolo depth (gain ± this value)
const CHAOS_SMOOTH_TC = 0.08;  // Web Audio setTargetAtTime time constant (seconds)

let _onStateChange = null;
export function onAudioStateChange(cb) { _onStateChange = cb; }
export function isAudioLocked()  { return _ctx !== null && _ctx.state === 'suspended'; }
export function isAudioReady()   { return _ctx !== null && _ctx.state === 'running'; }

let _ctx       = null;
let _analyser  = null;
let _buf       = null;
let _stream    = null;
let _vol       = 0;
let _active    = false;
let _voiceSrc  = null; // currently playing voiceover BufferSourceNode
let _bgSrc     = null; // currently playing background BufferSourceNode
let _bgGain    = null; // GainNode on the bg path — used for ducking
let _voiceGen  = 0;    // increments each time a voiceover starts; guards onended

// Chaos modulation nodes
let _bgChaosFilter    = null; // BiquadFilterNode — lowpass on bg track
let _voiceChaosFilter = null; // BiquadFilterNode — lowpass on voice track (future OpenAI audio)
let _tremoloGain      = null; // GainNode whose .gain is modulated by the LFO
let _tremoloDepth     = null; // GainNode scaling LFO amplitude (0 = no tremolo)
let _tremoloLFO       = null; // OscillatorNode driving the tremolo

function _ensureCtx() {
    if (!_ctx) {
        _ctx = new AudioContext();
        _ctx.onstatechange = () => _onStateChange?.();
    }
}

function _ensureAnalyser() {
    if (_analyser) return;
    _ensureCtx();
    _analyser = _ctx.createAnalyser();
    _analyser.fftSize               = FFT_SIZE;
    _analyser.smoothingTimeConstant = 0; // we do our own EMA
    _buf = new Float32Array(FFT_SIZE);

    // ── Bg chain: bgSrc → _bgChaosFilter → _tremoloGain → _bgGain → analyser+dest
    _bgChaosFilter = _ctx.createBiquadFilter();
    _bgChaosFilter.type            = 'lowpass';
    _bgChaosFilter.frequency.value = CHAOS_FREQ_MAX;
    _bgChaosFilter.Q.value         = 0.8;

    _tremoloGain = _ctx.createGain();
    _tremoloGain.gain.value = 1.0;

    _tremoloDepth = _ctx.createGain();
    _tremoloDepth.gain.value = 0; // no tremolo until setChaos is called

    _tremoloLFO = _ctx.createOscillator();
    _tremoloLFO.type            = 'sine';
    _tremoloLFO.frequency.value = CHAOS_LFO_FREQ;
    _tremoloLFO.connect(_tremoloDepth);
    _tremoloDepth.connect(_tremoloGain.gain);
    _tremoloLFO.start();

    _bgGain = _ctx.createGain();

    _bgChaosFilter.connect(_tremoloGain);
    _tremoloGain.connect(_bgGain);
    _bgGain.connect(_analyser);
    _bgGain.connect(_ctx.destination);

    // ── Voice chain: voiceSrc → _voiceChaosFilter → analyser+dest
    // Prepared for future OpenAI audio flow — filter open by default.
    _voiceChaosFilter = _ctx.createBiquadFilter();
    _voiceChaosFilter.type            = 'lowpass';
    _voiceChaosFilter.frequency.value = CHAOS_FREQ_MAX;
    _voiceChaosFilter.Q.value         = 0.8;
    _voiceChaosFilter.connect(_analyser);
    _voiceChaosFilter.connect(_ctx.destination);

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

function _duckBg() {
    if (!_bgGain) return;
    const now = _ctx.currentTime;
    _bgGain.gain.cancelScheduledValues(now);
    _bgGain.gain.setValueAtTime(_bgGain.gain.value, now);
    _bgGain.gain.linearRampToValueAtTime(_duckLevel, now + DUCK_ATTACK);
}

function _unduckBg() {
    if (!_bgGain) return;
    const now = _ctx.currentTime;
    _bgGain.gain.cancelScheduledValues(now);
    _bgGain.gain.setValueAtTime(_bgGain.gain.value, now);
    _bgGain.gain.linearRampToValueAtTime(1.0, now + DUCK_RELEASE);
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
    if (!base64) {
        _unduckBg(); // restore bg if we're explicitly stopping the voiceover
        return;
    }
    const audioBuffer = await _decode(base64);
    const gen         = ++_voiceGen;
    _voiceSrc         = _ctx.createBufferSource();
    _voiceSrc.buffer  = audioBuffer;
    _voiceSrc.connect(_voiceChaosFilter);
    _voiceSrc.onended = () => {
        if (gen === _voiceGen) { // only unduck if no newer voiceover has taken over
            _voiceSrc = null;
            _unduckBg();
        }
    };
    _duckBg();
    _voiceSrc.start();
}

// Background track. loop=true (default) loops forever; loop=false plays once then stops.
// Null/empty stops and clears the track immediately.
export async function playAudioBg(base64, mimeType = 'audio/webm;codecs=opus', loop = true) {
    _stopSrc(_bgSrc);
    _bgSrc = null;
    if (!base64) {
        if (_bgGain) {
            const now = _ctx?.currentTime ?? 0;
            _bgGain.gain.cancelScheduledValues(now);
            _bgGain.gain.setValueAtTime(1.0, now);
        }
        return;
    }
    const audioBuffer = await _decode(base64);
    _bgSrc            = _ctx.createBufferSource();
    _bgSrc.buffer     = audioBuffer;
    _bgSrc.loop       = loop;
    _bgSrc.connect(_bgChaosFilter);
    if (!loop) _bgSrc.onended = () => { _bgSrc = null; };
    _bgSrc.start();
}

export function stopAudio() {
    _stopSrc(_voiceSrc); _voiceSrc = null;
    _stopSrc(_bgSrc);    _bgSrc    = null;
    try { _tremoloLFO?.stop(); } catch (_) {}
    if (!_active && !_stream) return;
    _stream?.getTracks().forEach(t => t.stop());
    _ctx?.close();
    _ctx = _analyser = _buf = _stream = _bgGain = null;
    _bgChaosFilter = _voiceChaosFilter = _tremoloGain = _tremoloDepth = _tremoloLFO = null;
    _vol    = 0;
    _active = false;
}

// Call each frame with the current chaos value (0 = armonia, 1 = chaos).
// Smoothly adjusts the lowpass filter cutoff and tremolo depth on both
// bg and voice chains. Safe to call before audio is initialised — no-ops if
// the chain does not exist yet.
export function setChaos(chaos) {
    if (!_bgChaosFilter) return;
    const c   = Math.max(0, Math.min(1, chaos));
    const now = _ctx.currentTime;
    const freq = CHAOS_FREQ_MIN + (CHAOS_FREQ_MAX - CHAOS_FREQ_MIN) * (1 - c);
    _bgChaosFilter.frequency.setTargetAtTime(freq, now, CHAOS_SMOOTH_TC);
    _voiceChaosFilter?.frequency.setTargetAtTime(freq, now, CHAOS_SMOOTH_TC);
    _tremoloDepth.gain.setTargetAtTime(CHAOS_LFO_MAX * c, now, CHAOS_SMOOTH_TC);
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
