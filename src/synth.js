// ── Procedural synthwave — chaos-driven generative audio ─────────────────────
// Layers driven by collective chaos (0 = harmony, 1 = chaos):
//   drone  : sub-bass pedal note A1 — always present, anchors the sound
//   noise  : pink noise bandpass — loud at chaos, silent at harmony
//   pad    : PolySynth sawtooth chord + LFO filter sweep — emerges below 0.6
//   arp    : random minor-scale melody + delay — revealed below 0.35

import * as Tone from 'tone';

const RAMP   = 2.0;  // seconds for smooth parameter transitions
const SILENT = -60;  // dB floor (avoids -Infinity in ramps)
const BPM    = 110;

// A natural minor scale across 2 octaves for arp randomisation
const ARP_POOL = ['A3','B3','C4','D4','E4','F4','G4','A4','B4','C5','E5','G5'];

let _ready = false;
let _noiseGain, _padVol, _padFilter, _droneVol, _arpVol, _arpSeq;

export async function startSynth() {
    if (_ready) return;
    await Tone.start();

    const master = new Tone.Gain(0.75).toDestination();

    // ── Drone — sub-bass pedal A1, always on ─────────────────────────────────
    const droneReverb = new Tone.Reverb({ decay: 6, wet: 0.4 });
    _droneVol = new Tone.Volume(-18);
    const drone = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope:   { attack: 4, decay: 2, sustain: 1, release: 8 },
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

    // ── Pad — sawtooth chord with LFO filter sweep ────────────────────────────
    const reverb   = new Tone.Reverb({ decay: 9, wet: 0.75 });
    const chorus   = new Tone.Chorus(3, 2, 0.5).start();
    _padFilter     = new Tone.Filter({ frequency: 250, type: 'lowpass', rolloff: -24 });
    _padVol        = new Tone.Volume(SILENT);

    // LFO slowly sweeps the filter cutoff for movement (0.15 Hz, ±600 Hz)
    const padLFO = new Tone.LFO({ frequency: 0.15, min: -600, max: 600, type: 'sine' });
    padLFO.connect(_padFilter.frequency);
    padLFO.start();

    const pad = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope:   { attack: 2.5, decay: 1.5, sustain: 0.7, release: 5 },
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
    const arpDelay  = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.35, wet: 0.5 });
    const arpReverb = new Tone.Reverb({ decay: 3, wet: 0.35 });
    _arpVol         = new Tone.Volume(SILENT);

    const arpSynth = new Tone.Synth({
        oscillator: { type: 'square4' },
        envelope:   { attack: 0.01, decay: 0.12, sustain: 0.25, release: 0.6 },
        volume:     -18,
    });
    arpSynth.connect(arpDelay);
    arpDelay.connect(arpReverb);
    arpReverb.connect(_arpVol);
    _arpVol.connect(master);
    await arpReverb.ready;

    _arpSeq = new Tone.Sequence(
        (time) => {
            const note = ARP_POOL[Math.floor(Math.random() * ARP_POOL.length)];
            arpSynth.triggerAttackRelease(note, '16n', time);
        },
        new Array(8).fill(null),
        '8n',
    );

    Tone.getTransport().bpm.value = BPM;
    _arpSeq.start(0);
    Tone.getTransport().start();

    _ready = true;
}

export function setSynthChaos(chaos) {
    if (!_ready) return;
    const c = Math.max(0, Math.min(1, chaos));
    const t = Tone.now();

    // Drone — always audible, slightly quieter at peak chaos
    _droneVol.volume.rampTo(-18 - c * 6, RAMP, t);

    // Noise — fades out as harmony approaches
    _noiseGain.gain.rampTo(c * 0.25, RAMP, t);

    // Pad — emerges below chaos 0.6, filter opens further at harmony
    const padGain = c < 0.6 ? Math.pow(1 - c / 0.6, 1.5) * 0.55 : 0;
    _padVol.volume.rampTo(padGain > 0 ? Tone.gainToDb(padGain) : SILENT, RAMP, t);
    _padFilter.frequency.rampTo(300 + (1 - c) * 5500, RAMP, t);

    // Arp — only below chaos 0.35
    const arpGain = c < 0.35 ? Math.pow(1 - c / 0.35, 2) * 0.4 : 0;
    _arpVol.volume.rampTo(arpGain > 0 ? Tone.gainToDb(arpGain) : SILENT, RAMP, t);
}

export function stopSynth() {
    if (!_ready) return;
    _arpSeq?.stop();
    Tone.getTransport().stop();
    Tone.getDestination().volume.rampTo(SILENT, 1.5);
    setTimeout(() => {
        Tone.getDestination().volume.value = 0;
        _ready = false;
    }, 1600);
}
