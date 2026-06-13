// ── Procedural synthwave — chaos-driven generative audio ─────────────────────
// Three layers driven by collective chaos (0 = harmony, 1 = chaos):
//   noise  : pink noise bandpass — loud at chaos, silent at harmony
//   pad    : PolySynth sawtooth chord — emerges as chaos falls below 0.6
//   arp    : Synth melody sequence — fully revealed below 0.3
//
// Call startSynth() on first user connect (needs prior user gesture for AudioContext).
// Call setSynthChaos(0-1) every frame alongside setChaos().
// Call stopSynth() when all users disconnect.

import * as Tone from 'tone';

const RAMP    = 2.0;   // seconds for smooth parameter transitions
const SILENT  = -60;   // dB floor used instead of -Infinity for ramps
const BPM     = 110;

const PAD_CHORD = ['A2', 'E3', 'A3', 'C4', 'E4', 'G4'];
const ARP_NOTES = ['A3', 'C4', 'E4', 'G4', 'A4', 'G4', 'E4', 'C4'];

let _ready  = false;
let _noiseGain, _padVol, _padFilter, _arpVol, _arpSeq;

export async function startSynth() {
    if (_ready) return;
    await Tone.start();

    const master  = new Tone.Gain(0.75).toDestination();

    // ── Noise ─────────────────────────────────────────────────────────────────
    const noiseFilt = new Tone.Filter({ frequency: 900, type: 'bandpass', Q: 1.5 });
    _noiseGain      = new Tone.Gain(0.25);
    const noise     = new Tone.Noise('pink');
    noise.connect(noiseFilt);
    noiseFilt.connect(_noiseGain);
    _noiseGain.connect(master);
    noise.start();

    // ── Pad ───────────────────────────────────────────────────────────────────
    const reverb  = new Tone.Reverb({ decay: 9, wet: 0.75 });
    const chorus  = new Tone.Chorus(3, 2, 0.5).start();
    _padFilter    = new Tone.Filter({ frequency: 250, type: 'lowpass', rolloff: -24 });
    _padVol       = new Tone.Volume(SILENT);

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
    pad.triggerAttack(PAD_CHORD);

    // ── Arp ───────────────────────────────────────────────────────────────────
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

    let _idx = 0;
    _arpSeq = new Tone.Sequence(
        (time) => { arpSynth.triggerAttackRelease(ARP_NOTES[_idx++ % ARP_NOTES.length], '16n', time); },
        ARP_NOTES,
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

    // Noise — fades out as harmony approaches
    _noiseGain.gain.rampTo(c * 0.25, RAMP, t);

    // Pad — emerges below chaos 0.6
    const padGain = c < 0.6 ? Math.pow(1 - c / 0.6, 1.5) * 0.55 : 0;
    _padVol.volume.rampTo(padGain > 0 ? Tone.gainToDb(padGain) : SILENT, RAMP, t);
    _padFilter.frequency.rampTo(250 + (1 - c) * 5750, RAMP, t);

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
