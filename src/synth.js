// ── Procedural synthwave — collective-state-driven generative audio ───────────
// Layers driven by collective state (coherence, temp, wind) and an energy level:
//   drone      : sub-bass pedal A1 — always present
//   colorFilter: master low-pass whose cutoff tracks temperature (cold=dark, warm=open)
//   colorOsc   : reverb-soaked sine that glides from C2 (cold) to A2 (warm)
//   pad        : PolySynth fatsawtooth chord + LFO filter sweep
//                  LFO frequency ← coherence (0.05–0.8 Hz)
//                  LFO amplitude ← wind magnitude (deeper with physical movement)
//   arp        : random minor-scale melody + delay
//                  BPM ← temperature (80–140)
//   bass       : pulsing sub-bass, post-drop — only when colors are cold (cold > 0.45)
//   kick       : four-on-the-floor, post-drop — only when crowd is frenetic (frenzy > 0.55)
//
// Energy (0 = ambient bed, 1 = post-drop energetic) scales pad/arp gain, pad
// filter brightness and transport BPM, and gates the bass+kick rhythm section.
// The generative "drop" (playRiser → triggerImpact) ramps energy to 1 to lock in
// the elevated body. Within that body the crowd average shapes everything: the
// master filter and color oscillator pitch respond to temperature continuously,
// while bass/kick are emergent — they only appear when the room truly earns them.

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

// A natural minor scale across 2 octaves for arp randomisation (default / no shape)
const ARP_POOL = ['A3','B3','C4','D4','E4','F4','G4','A4','B4','C5','E5','G5'];

// ── Shape personality system ───────────────────────────────────────────────────
// Each shape shown as an avoidmap gets its own sonic character: a distinct arp
// mode, pad chord voicing, LFO rate, and a short entry blinker. Personalities
// are keyed by shape name (static images) or 'h0'–'h4' (harmony sum % 5).
const _SHAPE_POOLS = {
    pentatonic:  ['A3','C4','D4','E4','G4','A4','C5','D5','E5','G5'],
    dorian:      ['A3','B3','C4','D4','E4','F#4','G4','A4','B4','C5'],
    phrygian:    ['A3','Bb3','C4','D4','E4','F4','G4','A4','Bb4','C5'],
    lydian:      ['A3','B3','C#4','D#4','E4','F#4','G#4','A4','B4','C5'],
    mixolydian:  ['A3','B3','C#4','D4','E4','F#4','G4','A4','B4','C5'],
    wholetone:   ['A3','B3','C#4','D#4','F4','G4','A4','B4','C#5','D#5'],
};
const _SHAPE_CHORDS = {
    pentatonic:  ['A2','D3','G3','A3','D4','G4'],
    dorian:      ['A2','C3','E3','F#3','A3','C4'],
    phrygian:    ['A2','Bb2','E3','G3','A3','C4'],
    lydian:      ['A2','E3','B3','D#4','G#4','B4'],
    mixolydian:  ['A2','C#3','E3','G3','A3','C#4'],
    wholetone:   ['A2','B2','C#3','D#3','F3','G3'],
    default:     ['A2','E3','A3','C4','E4','G4'],
};
// Named presets for static shapes + 5 harmony archetypes (sum % 5)
const _SHAPE_PRESETS = {
    circle:      { pool: 'pentatonic', chord: 'pentatonic', lfoHz: 0.12, blinker: 'sonar'   },
    full_square: { pool: 'wholetone',  chord: 'wholetone',  lfoHz: 0.06, blinker: 'deep'    },
    aant_logo:   { pool: 'dorian',     chord: 'dorian',     lfoHz: 0.28, blinker: 'ghost'   },
    h0:          { pool: 'lydian',     chord: 'lydian',     lfoHz: 0.22, blinker: 'blip'    },
    h1:          { pool: 'dorian',     chord: 'dorian',     lfoHz: 0.18, blinker: 'sonar'   },
    h2:          { pool: 'phrygian',   chord: 'phrygian',   lfoHz: 0.32, blinker: 'ghost'   },
    h3:          { pool: 'mixolydian', chord: 'mixolydian', lfoHz: 0.10, blinker: 'deep'    },
    h4:          { pool: 'pentatonic', chord: 'pentatonic', lfoHz: 0.16, blinker: 'sputnik' },
};

let _ready = false;
let _pad = null;  // lifted to module scope for chord re-voicing in setShapePersonality
let _lastPadRevoiceT = 0;  // last time the pad chord was re-voiced — throttles rapid image loads
let _padVol, _padFilter, _padLFO, _droneVol, _arpVol, _arpSeq;
let _kickVol, _kickLoop, _bassVol, _bassLoop;   // post-drop rhythm section
let _colorFilter  = null;  // master low-pass whose cutoff tracks crowd color temperature
let _colorOsc     = null;  // reverb-soaked sine gliding C2 (cold) → C4 (warm)
let _colorOscVol  = null;  // volume node for the color osc — swells with temperature
let _synthBus = null;  // top-level synth bus volume

// Shape personality state — null means "use defaults / let collective state drive"
let _activeArpPool = null;  // overrides ARP_POOL while a shape is showing
let _shapeLfoHz    = null;  // overrides coherence-driven LFO frequency while a shape is showing

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

    _synthBus    = new Tone.Volume(0).toDestination();
    // Color filter sits between master and the output bus; its cutoff tracks the
    // crowd's average color temperature — cold colors darken the whole mix, warm
    // colors open it up. Starts at neutral (4 kHz) and is driven by _applyState.
    _colorFilter = new Tone.Filter({ type: 'lowpass', frequency: 4000, rolloff: -12 });
    _colorFilter.connect(_synthBus);
    const master = new Tone.Gain(0.75).connect(_colorFilter);

    // Color oscillator — a very soft, heavily reverb-soaked sine that glides in
    // pitch with temperature: C2 (65 Hz) when the crowd is cold, A2 (110 Hz) warm.
    // Barely audible, more felt than heard — gives each color temperature a "voice".
    const colorRev = new Tone.Reverb({ decay: 12, wet: 0.95 });
    _colorOsc    = new Tone.Oscillator({ type: 'sine', frequency: 65 });
    _colorOscVol = new Tone.Volume(-40);
    _colorOsc.connect(colorRev);
    colorRev.connect(_colorOscVol);
    _colorOscVol.connect(master);
    await colorRev.ready;
    _colorOsc.start();

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

    _pad = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 20 },
        envelope:   { attack: 4.0, decay: 2.0, sustain: 0.65, release: 8 },
        volume:     -12,
    });
    _pad.maxPolyphony = 48;  // headroom above default 32 for legitimate chord crossfades
    _pad.connect(_padFilter);
    _padFilter.connect(chorus);
    chorus.connect(reverb);
    reverb.connect(_padVol);
    _padVol.connect(master);
    await reverb.ready;
    _pad.triggerAttack(['A2', 'E3', 'A3', 'C4', 'E4', 'G4']);

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
            const pool = _activeArpPool ?? ARP_POOL;
            let note;
            if (_influenceNotes.length > 0 && Math.random() < _INFLUENCE_BLEND) {
                note = _influenceNotes[Math.floor(Math.random() * _influenceNotes.length)].note;
            } else {
                note = pool[Math.floor(Math.random() * pool.length)];
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

    // Color modulation — driven even in droneOnly mode so the room always breathes
    // with color. Filter: 1.2 kHz (cold/dark) → 12 kHz (warm/bright), gentle -12 rolloff.
    // Color oscillator: C2 (65 Hz) cold → C4 (262 Hz) warm — two octaves, clearly audible.
    // Volume swells with temperature so silence = cold crowd, presence = warm crowd.
    if (_colorFilter) _colorFilter.frequency.rampTo(1200 + tmp * 10800, 3);
    if (_colorOsc)    _colorOsc.frequency.rampTo(65 * Math.pow(262 / 65, tmp), 1.5);
    if (_colorOscVol) smoothTo(_colorOscVol.volume, -40 + tmp * 18); // −40 dB cold → −22 dB warm

    if (_droneOnly) return; // PHASE 1: solo drone, gli altri layer restano silenziosi

    // Pad — louder and brighter with energy
    const padGain = PAD_GAIN_BASE + e * PAD_GAIN_ENERGY;
    smoothTo(_padVol.volume, Tone.gainToDb(padGain));
    smoothTo(_padFilter.frequency, PAD_FILTER_BASE + e * PAD_FILTER_ENERGY);

    // LFO frequency ← coherence (bypassed while a shape personality overrides it)
    if (_shapeLfoHz === null) _padLFO.frequency.value = 0.05 + coh * 0.75;

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

    // Bass — only emerges when colors are genuinely cold (dead zone 0–0.45).
    // Smooth ramp above the threshold so it feels like something waking up, not a switch.
    const bassLevel = Math.max(0, (cold - 0.45) / 0.55);   // 0 at warm → 1 at fully cold
    const bassGain  = e * 0.8 * bassLevel;
    smoothTo(_bassVol.volume, (e > 0.001 && bassLevel > 0.01) ? Tone.gainToDb(bassGain) : SILENT);

    // Kick — only emerges when the crowd is genuinely frenetic (dead zone 0–0.55).
    // The wide dead zone keeps it absent during typical play and reserves it for
    // peak chaos so it never feels like a constant disco beat.
    const kickLevel = Math.max(0, (frenzy - 0.55) / 0.45); // 0 at calm → 1 at full frenzy
    const kickGain  = e * 0.85 * kickLevel;
    smoothTo(_kickVol.volume, (e > 0.001 && kickLevel > 0.01) ? Tone.gainToDb(kickGain) : SILENT);

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

// ── Shape personality ──────────────────────────────────────────────────────────
// Call when an avoidmap image appears on screen. `key` is the shape filename
// (without extension) for static assets, or 'h0'–'h4' for harmony images.
// Swaps the arp mode, re-voices the pad chord (via its natural 4 s attack /
// 8 s release crossfade), locks the LFO to the shape's rate, and plays a short
// entry blinker so each shape has an immediately audible personality.
export function setShapePersonality(key) {
    if (!_ready) return;
    const preset = _SHAPE_PRESETS[key];
    if (!preset) return;

    _activeArpPool = _SHAPE_POOLS[preset.pool] ?? ARP_POOL;
    _shapeLfoHz    = preset.lfoHz;
    _padLFO.frequency.rampTo(preset.lfoHz, 2);

    // Re-voice the pad: release the old chord immediately and swell the new
    // voicing in over its 4 s attack — the release tail crossfades against it.
    // Throttled so rapid image loads coalesce and never overflow the voice pool;
    // the arp pool, LFO, and blinker below stay outside the guard so each image
    // keeps its own audible identity.
    if (_pad) {
        const now = Tone.now();
        if (now - _lastPadRevoiceT >= 2.5) {
            _lastPadRevoiceT = now;
            _pad.releaseAll(now);
            _pad.triggerAttack(_SHAPE_CHORDS[preset.chord] ?? _SHAPE_CHORDS.default, now);
        }
    }

    blinker(preset.blinker);
}

// Call when the avoidmap is cleared. Restores all shape overrides to defaults.
export function clearShapePersonality() {
    if (!_ready) return;
    _activeArpPool = null;
    _shapeLfoHz    = null;
    // Restore default pad chord — same throttled immediate-release crossfade as setShapePersonality
    if (_pad) {
        const now = Tone.now();
        if (now - _lastPadRevoiceT >= 2.5) {
            _lastPadRevoiceT = now;
            _pad.releaseAll(now);
            _pad.triggerAttack(_SHAPE_CHORDS.default, now);
        }
    }
    // LFO rate will be restored to coherence-driven value on the next _applyState tick
}

export function stopSynth() {
    if (!_ready) return;
    _arpSeq?.stop();
    _kickLoop?.stop();
    _bassLoop?.stop();
    _colorOsc?.stop();
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

// ── Generative riser — variant-parameterized harmonic build ───────────────────
// playRiser(durationMs, variant?) builds organic tension: staggered sine choir
// whose voices rise in pitch over the duration, plus an optional noise undertow.
// Called with no variant it picks randomly from RISER_VARIANTS — each call in
// PHASE 9's loop sounds distinct. PHASE 3 uses the default (warm).
// triggerImpact() resolves the PHASE 3 drop.

// Each voice is defined as ratios relative to the variant's rootHz so the same
// shape plays at any pitch. sr = start ratio, er = end ratio (both × rootHz).
const RISER_VARIANTS = [
    // warm — A2 root, A minor harmonics, the default — familiar and building
    { rootHz: 110, voices: [
        { sr: 1.000, er: 1.500, peak: 0.10, delay: 0.0 },
        { sr: 1.500, er: 2.000, peak: 0.08, delay: 0.6 },
        { sr: 2.000, er: 2.667, peak: 0.06, delay: 1.2 },
        { sr: 2.518, er: 3.364, peak: 0.04, delay: 1.8 },
    ], noise: 'pink', noiseLevel: 0.020, duckDb: -6 },

    // sparse — E2 root, 3 open-fifth voices, no noise — spacious and slow
    { rootHz: 82, voices: [
        { sr: 1.000, er: 1.500, peak: 0.09, delay: 0.0 },
        { sr: 1.500, er: 2.000, peak: 0.07, delay: 0.8 },
        { sr: 2.000, er: 3.000, peak: 0.05, delay: 1.6 },
    ], noise: null, noiseLevel: 0, duckDb: -4 },

    // tense — D2 root, dissonant intervals (m2, tritone) — unsettling, searching
    { rootHz: 73, voices: [
        { sr: 1.000, er: 1.125, peak: 0.08, delay: 0.0 },
        { sr: 1.125, er: 1.414, peak: 0.07, delay: 0.5 },
        { sr: 1.414, er: 2.000, peak: 0.06, delay: 1.0 },
        { sr: 2.000, er: 2.828, peak: 0.04, delay: 1.5 },
    ], noise: 'pink', noiseLevel: 0.025, duckDb: -8 },

    // high — A3 root (octave above warm), airy and bright — like light opening
    { rootHz: 220, voices: [
        { sr: 1.000, er: 1.333, peak: 0.08, delay: 0.0 },
        { sr: 1.333, er: 1.500, peak: 0.06, delay: 0.7 },
        { sr: 1.500, er: 2.000, peak: 0.05, delay: 1.4 },
        { sr: 2.000, er: 2.500, peak: 0.03, delay: 2.0 },
    ], noise: 'pink', noiseLevel: 0.015, duckDb: -5 },
];

// Tracks the end timestamp (Date.now()) of the current speakBinary cue.
// playRiser and triggerImpact check this to stay silent during speech.
let _speakingUntil = 0;
export function isSpeaking() { return Date.now() < _speakingUntil; }
export function speakingRemainingMs() { return Math.max(0, _speakingUntil - Date.now()); }

// A build voice: staggered sine harmonics rising in pitch + optional noise undertow.
// Pass a variant object to specify character; omit to pick randomly.
//
// CAUTION — `await rev.ready` below generates the Reverb impulse response on the
// audio thread. With decay:8 this produces a large IR buffer whose allocation can
// block the compositor for 20–80 ms depending on sample rate. This is a hard Tone.js
// constraint (no way to pre-warm a Reverb node before calling playRiser). Consequence:
// never call playRiser immediately before a visually time-sensitive operation (e.g.
// loading a new avoidmap / GPU texture upload) — the IR stall will land at the worst
// possible moment and cause a visible freeze. The harmony flow removed its pre-image
// riser for exactly this reason; triggerImpact() fires instead (no Reverb, no stall).
export async function playRiser(durationMs = 4000, variant) {
    await Tone.start();
    const v   = variant ?? RISER_VARIANTS[Math.floor(Math.random() * RISER_VARIANTS.length)];
    const dur = durationMs / 1000;
    const t   = Tone.now();

    const rev = new Tone.Reverb({ decay: 8, wet: 0.92 });
    rev.toDestination();
    await rev.ready;

    const nodes = v.voices.map(({ sr, er, peak, delay }) => {
        const f0   = v.rootHz * sr;
        const f1   = v.rootHz * er;
        const osc  = new Tone.Oscillator({ type: 'sine', frequency: f0 });
        const gain = new Tone.Gain(0.0001);
        osc.connect(gain); gain.connect(rev);
        osc.start(t + delay);
        osc.frequency.setValueAtTime(f0, t + delay);
        osc.frequency.linearRampToValueAtTime(f1, t + dur);
        gain.gain.setValueAtTime(0.0001, t + delay);
        gain.gain.linearRampToValueAtTime(peak, t + dur - 0.3);
        gain.gain.linearRampToValueAtTime(peak * 0.5, t + dur);
        osc.stop(t + dur + 0.5);
        return { osc, gain };
    });

    let noiseNodes = null;
    if (v.noise && v.noiseLevel > 0) {
        const noise     = new Tone.Noise(v.noise);
        const noiseLPF  = new Tone.Filter({ type: 'lowpass', frequency: 500 });
        const noiseGain = new Tone.Gain(0.0001);
        noise.connect(noiseLPF); noiseLPF.connect(noiseGain); noiseGain.connect(rev);
        noise.start(t);
        noiseGain.gain.setValueAtTime(0.0001, t);
        noiseGain.gain.linearRampToValueAtTime(v.noiseLevel, t + dur);
        noise.stop(t + dur);
        noiseNodes = { noise, noiseLPF, noiseGain };
    }

    if (_synthBus) {
        _synthBus.volume.cancelScheduledValues(t);
        _synthBus.volume.setValueAtTime(_synthBus.volume.value, t);
        _synthBus.volume.linearRampToValueAtTime(v.duckDb, t + dur * 0.85);
    }

    setTimeout(() => {
        rev.dispose();
        nodes.forEach(({ osc, gain }) => { osc.dispose(); gain.dispose(); });
        if (noiseNodes) { noiseNodes.noise.dispose(); noiseNodes.noiseLPF.dispose(); noiseNodes.noiseGain.dispose(); }
    }, durationMs + 3000);
}

// Restore the ducked synth bus and fire a short beat at the end of any riser
// that is not followed by triggerImpact (i.e. PHASE 9 and harmony risers).
export function resolveRiser() {
    blinker('blip');
    if (_synthBus) {
        const t = Tone.now();
        _synthBus.volume.cancelScheduledValues(t);
        _synthBus.volume.setValueAtTime(_synthBus.volume.value, t);
        _synthBus.volume.linearRampToValueAtTime(0, t + 0.3);
    }
}

// The impact at the end of the riser: a deep sub boom + a bright transient, then
// setSynthEnergy(1) to lock in the energetic body and restore the ducked bed.
export async function triggerImpact() {
    if (isSpeaking()) { console.log('[audio] triggerImpact suppressed — shape speaking'); return; }
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
    _speakingUntil = Date.now() + bits.length * bitMs + 900;
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

