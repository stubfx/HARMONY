// ── Procedural synthwave — collective-state-driven generative audio ───────────
// Layers driven by collective state (coherence, temp, wind) and an energy level:
//   drone  : sub-bass pedal A1 — always present
//   pad    : PolySynth sawtooth chord + LFO filter sweep
//              LFO frequency ← coherence (0.05–0.8 Hz)
//              LFO amplitude ← wind magnitude (deeper with physical movement)
//   arp    : random minor-scale melody + delay
//              BPM ← temperature (80–140)
//   bass   : pulsing sub-bass, post-drop — louder on colder crowd colors
//   kick   : four-on-the-floor, post-drop — fades in with crowd frenzy (low coherence)
//
// Energy (0 = ambient bed, 1 = post-drop energetic) scales pad/arp gain, pad
// filter brightness and transport BPM, and gates the bass+kick rhythm section.
// The generative "drop" (playRiser → triggerImpact) ramps energy to 1 to lock in
// the elevated body. Within that body, the crowd average shapes the rhythm mix:
// colder colors → more bass; a more scattered/frenetic crowd → more kick.

import * as Tone from 'tone';

const RAMP   = 2.0;  // seconds for smooth parameter transitions
const SILENT = -60;  // dB floor (avoids -Infinity in ramps)

// ── Layer levels & energy scaling ──────────────────────────────────────────────
const PAD_GAIN_BASE    = 0.55; // pad linear gain at energy 0
const PAD_GAIN_ENERGY  = 0.35; // added to pad gain at full energy
const ARP_GAIN_BASE    = 0.40; // arp linear gain at energy 0
const ARP_GAIN_ENERGY  = 0.40; // added to arp gain at full energy
const PAD_FILTER_BASE  = 4000; // pad lowpass cutoff (Hz) at energy 0
const PAD_FILTER_ENERGY = 7000; // added to cutoff at full energy
const BPM_MIN          = 80;   // transport BPM at temp 0
const BPM_TEMP_RANGE   = 60;   // BPM added across the temperature range
const BPM_ENERGY_BOOST = 40;   // BPM added at full energy

// A natural minor scale across 2 octaves for arp randomisation
const ARP_POOL = ['A3','B3','C4','D4','E4','F4','G4','A4','B4','C5','E5','G5'];

let _ready = false;
let _padVol, _padFilter, _padLFO, _droneVol, _arpVol, _arpSeq;
let _kickVol, _kickLoop, _bassVol, _bassLoop;   // post-drop rhythm section
let _synthBus = null;  // top-level synth bus volume

// Energy: 0 = ambient bed, 1 = post-drop energetic. Ramped by setSynthEnergy().
let _energy = 0;
let _energyTimer = null;

// Last collective state, re-applied whenever energy changes between 200 ms ticks.
let _lastCoh = 0.5, _lastBiasX = 0, _lastBiasY = 0, _lastTemp = 0.5;

// Influence pool: remote note presses bias the arp toward pressed pitches
const _influenceNotes      = [];
const _INFLUENCE_WINDOW_MS = 8000;
const _INFLUENCE_BLEND     = 0.90;  // prob of picking from influence vs free pool

export async function startSynth() {
    if (_ready) return;
    await Tone.start();

    _synthBus   = new Tone.Volume(0).toDestination();
    const master = new Tone.Gain(0.75).connect(_synthBus);

    // ── Drone — sub-bass pedal A1, always on ─────────────────────────────────
    const droneReverb = new Tone.Reverb({ decay: 10, wet: 0.6 });
    _droneVol = new Tone.Volume(-18);
    const drone = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope:   { attack: 6, decay: 2, sustain: 1, release: 12 },
        volume:     -6,
    });
    drone.connect(droneReverb);
    droneReverb.connect(_droneVol);
    _droneVol.connect(master);
    await droneReverb.ready;
    drone.triggerAttack('A1');

    // ── Pad — fatsawtooth chord with LFO filter sweep ────────────────────────
    const reverb   = new Tone.Reverb({ decay: 15, wet: 0.88 });
    const chorus   = new Tone.Chorus(2.5, 3.5, 0.7).start();
    _padFilter     = new Tone.Filter({ frequency: 250, type: 'lowpass', rolloff: -24 });
    _padVol        = new Tone.Volume(SILENT);

    // LFO sweeps the filter cutoff — frequency driven by coherence, amplitude by wind
    _padLFO = new Tone.LFO({ frequency: 0.3, min: -800, max: 800, type: 'sine' });
    _padLFO.connect(_padFilter.frequency);
    _padLFO.start();

    const pad = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 20 },
        envelope:   { attack: 4.0, decay: 2.0, sustain: 0.65, release: 8 },
        volume:     -12,
    });
    pad.connect(_padFilter);
    _padFilter.connect(chorus);
    chorus.connect(reverb);
    reverb.connect(_padVol);
    _padVol.connect(master);
    await reverb.ready;
    pad.triggerAttack(['A2', 'E3', 'A3', 'C4', 'E4', 'G4']);

    // ── Arp — random notes from A minor scale ─────────────────────────────────
    const arpDelay  = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.5, wet: 0.6 });
    const arpReverb = new Tone.Reverb({ decay: 8, wet: 0.65 });
    _arpVol         = new Tone.Volume(SILENT);

    const arpSynth = new Tone.Synth({
        oscillator: { type: 'triangle' },
        envelope:   { attack: 0.04, decay: 0.18, sustain: 0.2, release: 1.8 },
        volume:     -18,
    });
    arpSynth.connect(arpDelay);
    arpDelay.connect(arpReverb);
    arpReverb.connect(_arpVol);
    _arpVol.connect(master);
    await arpReverb.ready;

    _arpSeq = new Tone.Sequence(
        (time) => {
            const now = Date.now();
            while (_influenceNotes.length && now - _influenceNotes[0].ts > _INFLUENCE_WINDOW_MS) {
                _influenceNotes.shift();
            }
            let note;
            if (_influenceNotes.length > 0 && Math.random() < _INFLUENCE_BLEND) {
                note = _influenceNotes[Math.floor(Math.random() * _influenceNotes.length)].note;
            } else {
                note = ARP_POOL[Math.floor(Math.random() * ARP_POOL.length)];
            }
            arpSynth.triggerAttackRelease(note, '16n', time);
        },
        new Array(8).fill(null),
        '8n',
    );

    // ── Kick — four-on-the-floor pulse, faded in by crowd frenzy (see _applyState) ─
    const kickReverb = new Tone.Reverb({ decay: 1.5, wet: 0.12 });
    _kickVol = new Tone.Volume(SILENT);
    const kick = new Tone.MembraneSynth({
        pitchDecay: 0.045,
        octaves:    5,
        oscillator: { type: 'sine' },
        envelope:   { attack: 0.001, decay: 0.35, sustain: 0, release: 0.2 },
        volume:     -4,
    });
    kick.connect(kickReverb);
    kickReverb.connect(_kickVol);
    _kickVol.connect(master);
    await kickReverb.ready;
    _kickLoop = new Tone.Loop((time) => { kick.triggerAttackRelease('C1', '8n', time); }, '4n');

    // ── Bass — rounded sub-bass on quarter notes, swelled by colder colors (see _applyState) ─
    _bassVol = new Tone.Volume(SILENT);
    const bassFilter = new Tone.Filter({ frequency: 220, type: 'lowpass', rolloff: -24 });
    const bass = new Tone.Synth({
        oscillator: { type: 'triangle' },
        envelope:   { attack: 0.02, decay: 0.2, sustain: 0.2, release: 0.35 },
        volume:     -8,
    });
    bass.connect(bassFilter);
    bassFilter.connect(_bassVol);
    _bassVol.connect(master);
    _bassLoop = new Tone.Loop((time) => {
        bass.triggerAttackRelease(Math.random() < 0.5 ? 'A1' : 'E1', '4n', time);
    }, '4n');

    Tone.getTransport().bpm.value = 110;
    _arpSeq.start(0);
    _kickLoop.start(0);
    _bassLoop.start(0);
    Tone.getTransport().start();

    _ready = true;
}

// coherence : 0 = scattered, 1 = converged
// biasX/Y   : collective tilt (wind direction), nominally 0–1 centered at 0
// temp      : collective temperature 0–1
let _droneOnly = false;

// When true, only the drone plays — pad/arp are silenced.
// Call setSynthDroneOnly(false) to restore all layers.
export function setSynthDroneOnly(enabled) {
    _droneOnly = enabled;
}

export function setSynthState(coherence = 0.5, biasX = 0, biasY = 0, temp = 0.5) {
    _lastCoh   = coherence;
    _lastBiasX = biasX;
    _lastBiasY = biasY;
    _lastTemp  = temp;
    _applyState();
}

// Applies the stored collective state and current energy to the live nodes.
// Re-called on each energy ramp step so BPM/gain track energy between ticks.
function _applyState() {
    if (!_ready) return;
    const coh = Math.max(0, Math.min(1, _lastCoh));
    const tmp = Math.max(0, Math.min(1, _lastTemp));
    const e   = Math.max(0, Math.min(1, _energy));
    const t   = Tone.now();
    const TC  = RAMP / 3;  // exponential time constant (~95% after RAMP seconds)

    // setTargetAtTime avoids setRampPoint (which injects EPS=1e-7 into setValueAtTime,
    // crashing when the AudioParam's range check sees [0,0] as bounds).
    function smoothTo(param, value) {
        param.cancelScheduledValues(t);
        param.setTargetAtTime(value, t, TC);
    }

    // Drone — always audible
    smoothTo(_droneVol.volume, -18);

    if (_droneOnly) return; // PHASE 1: solo drone, gli altri layer restano silenziosi

    // Pad — louder and brighter with energy
    const padGain = PAD_GAIN_BASE + e * PAD_GAIN_ENERGY;
    smoothTo(_padVol.volume, Tone.gainToDb(padGain));
    smoothTo(_padFilter.frequency, PAD_FILTER_BASE + e * PAD_FILTER_ENERGY);

    // LFO frequency ← coherence: converged crowd sweeps the filter faster
    _padLFO.frequency.value = 0.05 + coh * 0.75;

    // LFO amplitude ← wind magnitude: physical tilt deepens the sweep
    const windMag = Math.min(1, Math.sqrt(_lastBiasX * _lastBiasX + _lastBiasY * _lastBiasY) / Math.SQRT2);
    _padLFO.amplitude.value = 0.3 + windMag * 0.7;

    // Arp — louder with energy
    const arpGain = ARP_GAIN_BASE + e * ARP_GAIN_ENERGY;
    smoothTo(_arpVol.volume, Tone.gainToDb(arpGain));

    // ── Rhythm section — only in the post-drop body (scaled by energy) ───────────
    // Two crowd-average signals shape the mix so it breathes with the room:
    //   • colder average color (low temp) swells the grounded sub-bass
    //   • a more scattered / frenetic crowd (low coherence) fades in the kick
    // The kick being frenzy-gated keeps it from feeling like a constant disco beat:
    // it only drives when the crowd itself is agitated.
    const cold   = 1 - tmp;   // 0 warm … 1 cold
    const frenzy = 1 - coh;   // 0 ordered/calm … 1 scattered/frenetic

    // Bass: present across the body, louder on colder colors (0.25× warm → 0.80× cold).
    const bassGain = e * (0.25 + 0.55 * cold);
    smoothTo(_bassVol.volume, e > 0.001 ? Tone.gainToDb(bassGain) : SILENT);

    // Kick: silent on a calm/ordered crowd, fading in with frenzy up to ~0.85×.
    const kickGain = e * 0.85 * frenzy;
    smoothTo(_kickVol.volume, (e > 0.001 && frenzy > 0.03) ? Tone.gainToDb(kickGain) : SILENT);

    // Arp tempo ← temperature (+ energy boost): higher = faster arpeggiation
    Tone.getTransport().bpm.value = BPM_MIN + tmp * BPM_TEMP_RANGE + e * BPM_ENERGY_BOOST;
}

// Ramp the energy level toward `e` over `rampSec`, re-applying state each step so
// BPM and layer gains glide smoothly rather than jumping on the next 200 ms tick.
export function setSynthEnergy(e, rampSec = 1.5) {
    const target = Math.max(0, Math.min(1, e));
    if (_energyTimer) { clearInterval(_energyTimer); _energyTimer = null; }
    const start   = _energy;
    const stepMs  = 50;
    const steps   = Math.max(1, Math.round((rampSec * 1000) / stepMs));
    let   n       = 0;
    _energyTimer = setInterval(() => {
        n++;
        _energy = start + (target - start) * Math.min(1, n / steps);
        _applyState();
        if (n >= steps) { _energy = target; clearInterval(_energyTimer); _energyTimer = null; }
    }, stepMs);
}

// Called from sim.js on each remote 'note' event.
// Freq is converted to note name; notes below A3 are shifted up an octave to stay in arp range.
export function addArpInfluence(freq) {
    if (!_ready) return;
    let midi = Tone.Frequency(freq, 'hz').toMidi();
    if (midi < 57) midi += 12;
    const note = Tone.Frequency(midi, 'midi').toNote();
    _influenceNotes.push({ note, ts: Date.now() });
    if (_influenceNotes.length > 20) _influenceNotes.shift();
}

export function setSynthBusVolume(db) {
    if (_synthBus) _synthBus.volume.value = db;
}

export function stopSynth() {
    if (!_ready) return;
    _arpSeq?.stop();
    _kickLoop?.stop();
    _bassLoop?.stop();
    Tone.getTransport().stop();
    Tone.getDestination().volume.setTargetAtTime(SILENT, Tone.now(), 0.5);
    setTimeout(() => {
        Tone.getDestination().volume.value = 0;
        _ready = false;
    }, 1600);
}

// ── Ping / blip — short tonal transient, fires on spectator join ──────────────
// Shared reverb tail — built once, reused across all ping types.
let _pingReverb = null;
async function _ensurePingReverb() {
    if (_pingReverb) return;
    _pingReverb = new Tone.Reverb({ decay: 6, wet: 0.65 });
    await _pingReverb.ready;
    _pingReverb.toDestination();
}

const BLINKER_PRESETS = {
    //          freq   slide  decay  vol    type
    sonar:    [ 528,   0.82,  1.8,  -22,  'sine'     ],
    sputnik:  [ 880,   0.97,  0.7,  -24,  'sine'     ],
    deep:     [ 264,   0.80,  3.0,  -18,  'sine'     ],
    blip:     [ 1320,  1.00,  0.18, -26,  'triangle' ],
    ghost:    [ 440,   0.75,  4.0,  -30,  'sine'     ],
};

export async function blinker(type = 'sonar') {
    await Tone.start();
    await _ensurePingReverb();
    const [freq, slideRatio, decay, vol, oscType] = BLINKER_PRESETS[type] ?? BLINKER_PRESETS.sonar;
    const synth = new Tone.Synth({
        oscillator: { type: oscType },
        envelope:   { attack: 0.002, decay, sustain: 0, release: 0.1 },
        volume:     vol,
    }).connect(_pingReverb);

    const t = Tone.now();
    synth.frequency.setValueAtTime(freq, t);
    if (slideRatio < 1) synth.frequency.exponentialRampToValueAtTime(freq * slideRatio, t + decay);
    synth.triggerAttackRelease(freq, decay + 0.1, t);
    setTimeout(() => synth.dispose(), (decay + 1.5) * 1000);
}

export const BLINKER_TYPES = Object.keys(BLINKER_PRESETS);

// ── Generative "drop" — riser build-up + impact ───────────────────────────────
// playRiser() is a rising build voice; triggerImpact() resolves it into a body
// hit and locks in the energetic state via setSynthEnergy(1). Both are one-shot,
// auto-disposing voices modelled on blinker(); story.js fires them around the
// PHASE 3 red reveal so the color lands like an EDM drop.

const RISER_NOISE_PEAK = 0.35; // band-passed noise gain at the top of the build
const RISER_TONE_PEAK  = 0.30; // sweeping tone gain at the top of the build
const RISER_DUCK_DB    = -12;  // synth bus duck at the height of the build (contrast)

// A build voice: band-passed white noise + a saw tone whose pitch and filter
// cutoff sweep upward while the volume swells over `durationMs`. Auto-disposes.
export async function playRiser(durationMs = 4000) {
    await Tone.start();
    const dur = durationMs / 1000;
    const t   = Tone.now();

    // Band-passed white noise sweeping up
    const noise     = new Tone.Noise('white');
    const noiseBP   = new Tone.Filter({ type: 'bandpass', Q: 2, frequency: 400 });
    const noiseGain = new Tone.Gain(0.0001);
    noise.connect(noiseBP); noiseBP.connect(noiseGain); noiseGain.toDestination();
    noise.start(t);
    noiseBP.frequency.setValueAtTime(400, t);
    noiseBP.frequency.exponentialRampToValueAtTime(6000, t + dur);
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime(RISER_NOISE_PEAK, t + dur);

    // Saw tone whose pitch and filter cutoff sweep upward
    const tone     = new Tone.Oscillator({ type: 'sawtooth', frequency: 110 });
    const toneFilt = new Tone.Filter({ type: 'lowpass', frequency: 400 });
    const toneGain = new Tone.Gain(0.0001);
    tone.connect(toneFilt); toneFilt.connect(toneGain); toneGain.toDestination();
    tone.start(t);
    tone.frequency.setValueAtTime(110, t);
    tone.frequency.exponentialRampToValueAtTime(880, t + dur);
    toneFilt.frequency.setValueAtTime(400, t);
    toneFilt.frequency.exponentialRampToValueAtTime(8000, t + dur);
    toneGain.gain.setValueAtTime(0.0001, t);
    toneGain.gain.exponentialRampToValueAtTime(RISER_TONE_PEAK, t + dur);

    // Duck the generative bed during the build for contrast; triggerImpact restores it.
    if (_synthBus) {
        _synthBus.volume.cancelScheduledValues(t);
        _synthBus.volume.setValueAtTime(_synthBus.volume.value, t);
        _synthBus.volume.linearRampToValueAtTime(RISER_DUCK_DB, t + dur * 0.85);
    }

    noise.stop(t + dur);
    tone.stop(t + dur);
    setTimeout(() => {
        noise.dispose(); noiseBP.dispose(); noiseGain.dispose();
        tone.dispose();  toneFilt.dispose(); toneGain.dispose();
    }, durationMs + 300);
}

// The impact at the end of the riser: a deep sub boom + a bright transient, then
// setSynthEnergy(1) to lock in the energetic body and restore the ducked bed.
export async function triggerImpact() {
    await Tone.start();
    const t = Tone.now();

    // Deep sub "boom" — low sine with a fast attack and pitch drop
    const boom = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope:   { attack: 0.005, decay: 0.6, sustain: 0, release: 0.3 },
        volume:     -4,
    }).toDestination();
    boom.frequency.setValueAtTime(90, t);
    boom.frequency.exponentialRampToValueAtTime(40, t + 0.5);
    boom.triggerAttackRelease(90, 0.7, t);
    setTimeout(() => boom.dispose(), 1500);

    // Bright transient
    blinker('blip');

    // Restore the ducked bed and lock in the energetic body.
    if (_synthBus) {
        _synthBus.volume.cancelScheduledValues(t);
        _synthBus.volume.setValueAtTime(_synthBus.volume.value, t);
        _synthBus.volume.linearRampToValueAtTime(0, t + 0.3);
    }
    setSynthEnergy(1, 1.2);
}

// ── "The simulation speaks" — binary phase cue ────────────────────────────────
// Replaces recorded narration in the later phases: the sim announces itself by
// encoding a small integer in binary, most-significant bit first, as a single
// continuous sine tone that glides between a high pitch (a 1 bit) and the octave
// below (a 0 bit). One-shot and auto-disposing — a soft machine "voice" that
// slides through its bits rather than beeping them, so it blends into the bed.
const SPEAK_BIT_MS    = 200;   // slot length per bit (sounded tone + trailing gap)
const SPEAK_TONE_MS   = 120;   // sounded portion of each slot
const SPEAK_ONE_FREQ  = 1245;  // Hz — a 1 bit
const SPEAK_ZERO_FREQ = 623;   // Hz — a 0 bit (an octave down)

// Total duration (ms) of the cue for `n` — deterministic so callers can time a
// follow-up (e.g. auto-advancing a story phase) without awaiting playback.
export function binaryCueDurationMs(n, bitMs = SPEAK_BIT_MS) {
    return Math.max(0, n | 0).toString(2).length * bitMs;
}

export async function speakBinary(n, { bitMs = SPEAK_BIT_MS } = {}) {
    await Tone.start();
    await _ensurePingReverb();
    const bits  = Math.max(0, n | 0).toString(2);
    const synth = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope:   { attack: 0.09, decay: 0.1, sustain: 0.85, release: 0.5 },
        volume:     -17,
    }).connect(_pingReverb);

    const t0    = Tone.now() + 0.02;
    const dur   = (bits.length * bitMs) / 1000;
    const glide = (bitMs / 1000) * 0.55; // portamento time between bit pitches

    // One continuous sine held across the whole cue; the pitch glides between the
    // high ("1") and octave-down ("0") frequencies, so the ups and downs read as a
    // smooth melodic contour that sits inside the bed rather than discrete beeps.
    const freqAt = i => (bits[i] === '1' ? SPEAK_ONE_FREQ : SPEAK_ZERO_FREQ);
    synth.triggerAttack(freqAt(0), t0);
    synth.frequency.setValueAtTime(freqAt(0), t0);
    for (let i = 1; i < bits.length; i++) {
        synth.frequency.exponentialRampToValueAtTime(freqAt(i), t0 + (i * bitMs) / 1000 + glide);
    }
    synth.triggerRelease(t0 + dur);
    setTimeout(() => synth.dispose(), bits.length * bitMs + 900);
}

