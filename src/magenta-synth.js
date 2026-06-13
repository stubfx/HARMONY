// ── Magenta MusicVAE — ML-generated melody layer ─────────────────────────────
// MusicVAE samples 4-bar melodies from a latent space learned on MIDI.
// chaos drives sampling temperature: low chaos → structured melodies;
//                                    high chaos → unpredictable variation.
// The layer appears below chaos 0.6, same threshold as the pad layer.

import * as mm from '@magenta/music';
import * as Tone from 'tone';

const CHECKPOINT = 'https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/mel_4bar_med_q2';
const TOTAL_STEPS = 64; // mel_4bar: 4 bars × 16 steps

let _vae        = null;
let _synth      = null;
let _vol        = null;
let _seq        = null;
let _ready      = false;
let _lastChaos  = -1;
let _resampling = false;

function _midiToNote(midi) {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return names[midi % 12] + (Math.floor(midi / 12) - 1);
}

export async function initMagentaSynth() {
    if (_ready) return;
    try {
        _vae = new mm.MusicVAE(CHECKPOINT);
        await _vae.initialize();

        const delay  = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.3, wet: 0.4 });
        const reverb = new Tone.Reverb({ decay: 4, wet: 0.5 });
        _vol = new Tone.Volume(-60);

        _synth = new Tone.Synth({
            oscillator: { type: 'triangle8' },
            envelope:   { attack: 0.03, decay: 0.15, sustain: 0.35, release: 1.2 },
            volume:     -14,
        });
        _synth.connect(delay);
        delay.connect(reverb);
        await reverb.ready;
        reverb.connect(_vol);
        _vol.toDestination();

        _ready = true;
        console.log('[magenta] initialized');
        _resample(1.0);
    } catch (e) {
        console.warn('[magenta] init failed — melody layer disabled:', e);
    }
}

function _resample(chaos) {
    if (!_vae || !_ready || _resampling) return;
    _resampling = true;
    const temp = 0.3 + chaos * 1.4; // 0.3 at harmony → 1.7 at chaos
    _vae.sample(1, temp).then(([seq]) => {
        _scheduleSeq(seq);
        _lastChaos = chaos;
        console.log(`[magenta] resampled  chaos=${chaos.toFixed(2)}  temp=${temp.toFixed(2)}  notes=${seq.notes?.length ?? 0}`);
    }).catch(e => {
        console.warn('[magenta] sample error:', e);
    }).finally(() => {
        _resampling = false;
    });
}

function _scheduleSeq(seq) {
    _seq?.stop();
    _seq?.dispose();

    // Fill 64 slots (4 bars × 16 steps) with note names; null = rest
    const steps = new Array(TOTAL_STEPS).fill(null);
    for (const n of (seq.notes ?? [])) {
        if (n.quantizedStartStep < TOTAL_STEPS) {
            steps[n.quantizedStartStep] = _midiToNote(n.pitch);
        }
    }

    _seq = new Tone.Sequence((time, note) => {
        if (note) _synth.triggerAttackRelease(note, '16n', time);
    }, steps, '16n');

    _seq.start('+0.1');
    console.log('[magenta] sequence scheduled');
}

// chaos     : 0 = harmony, 1 = chaos
// coherence : unused here but reserved for future filter modulation
export function setMagentaState(chaos, _coherence = 0.5, _temp = 0.5) {
    if (!_ready) return;
    const c = Math.max(0, Math.min(1, chaos));

    // Melody audible below chaos 0.6, same threshold as the pad layer
    const gain = c < 0.6 ? Math.pow(1 - c / 0.6, 1.5) * 0.45 : 0;
    _vol.volume.value = gain > 0 ? Math.max(-60, Tone.gainToDb(gain)) : -60;

    // Re-sample when chaos crosses a significant threshold
    if (!_resampling && Math.abs(c - _lastChaos) > 0.15) {
        _resample(c);
    }
}

export function stopMagentaSynth() {
    if (!_ready) return;
    _seq?.stop();
    if (_vol) _vol.volume.value = -60;
}
