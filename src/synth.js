// ── Procedural synthwave — collective-state-driven generative audio ───────────
// Layers driven by collective state (chaos 0=harmony 1=chaos, coherence, temp, wind):
//   drone  : sub-bass pedal A1 — always present, quieter at peak chaos
//   noise  : pink noise bandpass — loud at chaos, silent at harmony
//   pad    : PolySynth sawtooth chord + LFO filter sweep — emerges below chaos 0.6
//              LFO frequency ← coherence (0.05–0.8 Hz)
//              LFO amplitude ← wind magnitude (deeper with physical movement)
//   melody : MusicVAE-generated 4-bar loops — see magenta-synth.js
//              BPM ← temperature (80–140), shared Transport

import * as Tone from 'tone';

const RAMP   = 2.0;  // seconds for smooth parameter transitions
const SILENT = -60;  // dB floor (avoids -Infinity in ramps)


let _ready = false;
let _noiseGain, _padVol, _padFilter, _padLFO, _droneVol;

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

    // LFO sweeps the filter cutoff — frequency driven by coherence, amplitude by wind
    _padLFO = new Tone.LFO({ frequency: 0.43, min: -600, max: 600, type: 'sine' });
    _padLFO.connect(_padFilter.frequency);
    _padLFO.start();

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

    // Melody layer handled by magenta-synth.js (MusicVAE replaces arp)
    Tone.getTransport().bpm.value = 110;
    Tone.getTransport().start();

    _ready = true;
}

// chaos     : 0 = harmony, 1 = chaos
// coherence : 0 = scattered, 1 = converged
// biasX/Y   : collective tilt (wind direction), nominally 0–1 centered at 0
// temp      : collective temperature 0–1
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

    // Noise — fades out as harmony approaches
    smoothTo(_noiseGain.gain, Math.max(1e-4, c * 0.25));

    // Pad — emerges below chaos 0.6, filter opens further at harmony
    const padGain = c < 0.6 ? Math.pow(1 - c / 0.6, 1.5) * 0.55 : 0;
    smoothTo(_padVol.volume, padGain > 0 ? Math.max(SILENT, Tone.gainToDb(padGain)) : SILENT);
    smoothTo(_padFilter.frequency, 300 + (1 - c) * 5500);

    // LFO frequency ← coherence: converged room = faster oscillation (0.05–0.8 Hz)
    _padLFO.frequency.value = 0.05 + coh * 0.75;

    // LFO amplitude ← wind magnitude: physical tilt deepens the filter sweep (0.3–1.0)
    const windMag = Math.min(1, Math.sqrt(biasX * biasX + biasY * biasY) / Math.SQRT2);
    _padLFO.amplitude.value = 0.3 + windMag * 0.7;

    // Arp tempo ← temperature: higher temp = faster arpeggiation (80–140 BPM)
    // Also drives Magenta's Tone.Part (both share the same Transport)
    Tone.getTransport().bpm.value = 80 + tmp * 60;
}

export function stopSynth() {
    if (!_ready) return;
    Tone.getTransport().stop();
    Tone.getDestination().volume.setTargetAtTime(SILENT, Tone.now(), 0.5);
    setTimeout(() => {
        Tone.getDestination().volume.value = 0;
        _ready = false;
    }, 1600);
}
