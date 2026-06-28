// ── Procedural synthwave — collective-state-driven generative audio ───────────
// Layers driven by collective state (chaos 0=harmony 1=chaos, coherence, temp, wind):
//   drone  : sub-bass pedal A1 — always present, quieter at peak chaos
//   noise  : pink noise bandpass — loud at chaos, silent at harmony
//   pad    : PolySynth sawtooth chord + LFO filter sweep — emerges below chaos 0.6
//              LFO frequency ← coherence (0.05–0.8 Hz)
//              LFO amplitude ← wind magnitude (deeper with physical movement)
//   arp    : random minor-scale melody + delay — revealed below chaos 0.35
//              BPM ← temperature (80–140)

import * as Tone from 'tone';

const RAMP   = 2.0;  // seconds for smooth parameter transitions
const SILENT = -60;  // dB floor (avoids -Infinity in ramps)

// A natural minor scale across 2 octaves for arp randomisation
const ARP_POOL = ['A3','B3','C4','D4','E4','F4','G4','A4','B4','C5','E5','G5'];

let _ready = false;
let _noiseGain, _padVol, _padFilter, _padLFO, _droneVol, _arpVol, _arpSeq;
let _synthBus = null;  // top-level synth bus volume

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

    // ── Noise — interference at high chaos ────────────────────────────────────
    const noiseFilt = new Tone.Filter({ frequency: 900, type: 'bandpass', Q: 1.5 });
    _noiseGain      = new Tone.Gain(0.25);
    const noise     = new Tone.Noise('pink');
    noise.connect(noiseFilt);
    noiseFilt.connect(_noiseGain);
    _noiseGain.connect(master);
    noise.start();

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

    Tone.getTransport().bpm.value = 110;
    _arpSeq.start(0);
    Tone.getTransport().start();

    _ready = true;
}

// chaos     : 0 = harmony, 1 = chaos
// coherence : 0 = scattered, 1 = converged
// biasX/Y   : collective tilt (wind direction), nominally 0–1 centered at 0
// temp      : collective temperature 0–1
let _droneOnly = false;

// When true, only the drone plays — noise/pad/arp are silenced.
// Call setSynthDroneOnly(false) to restore all layers.
export function setSynthDroneOnly(enabled) {
    _droneOnly = enabled;
}

export function setSynthState(chaos, coherence = 0.5, biasX = 0, biasY = 0, temp = 0.5) {
    if (!_ready) return;
    const c   = Math.max(0, Math.min(1, chaos));
    const coh = Math.max(0, Math.min(1, coherence));
    const tmp = Math.max(0, Math.min(1, temp));
    const t   = Tone.now();
    const TC  = RAMP / 3;  // exponential time constant (~95% after RAMP seconds)

    // setTargetAtTime avoids setRampPoint (which injects EPS=1e-7 into setValueAtTime,
    // crashing when the AudioParam's range check sees [0,0] as bounds).
    function smoothTo(param, value) {
        param.cancelScheduledValues(t);
        param.setTargetAtTime(value, t, TC);
    }

    // Drone — always audible, slightly quieter at peak chaos
    smoothTo(_droneVol.volume, -18 - c * 6);

    if (_droneOnly) return; // PHASE 1: solo drone, gli altri layer restano silenziosi

    // Noise — fades out as harmony approaches
    smoothTo(_noiseGain.gain, Math.max(1e-4, c * 0.25));

    // Pad — emerges below chaos 0.6, filter opens further at harmony
    const padGain = c < 0.6 ? Math.pow(1 - c / 0.6, 1.5) * 0.55 : 0;
    smoothTo(_padVol.volume, padGain > 0 ? Math.max(SILENT, Tone.gainToDb(padGain)) : SILENT);
    smoothTo(_padFilter.frequency, 300 + (1 - c) * 9000);

    // LFO frequency ← (1-chaos): fast at harmony (2 Hz), near-still at full chaos (0.05 Hz)
    _padLFO.frequency.value = 0.05 + (1 - c) * 2.0;

    // LFO amplitude ← wind magnitude + chaos: tilt deepens sweep, chaos suppresses it
    const windMag = Math.min(1, Math.sqrt(biasX * biasX + biasY * biasY) / Math.SQRT2);
    _padLFO.amplitude.value = (1 - c * 0.7) * (0.3 + windMag * 0.7);

    // Arp — only below chaos 0.35
    const arpGain = c < 0.35 ? Math.pow(1 - c / 0.35, 2) * 0.4 : 0;
    smoothTo(_arpVol.volume, arpGain > 0 ? Math.max(SILENT, Tone.gainToDb(arpGain)) : SILENT);

    // Arp tempo ← temperature: higher temp = faster arpeggiation (80–140 BPM)
    Tone.getTransport().bpm.value = 80 + tmp * 60;
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

