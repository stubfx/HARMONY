import { PHASE } from './constants.js';

// ─── HARMONY — two parallel arcs synced by the voice ─────────────────────────
// Big screen (the collective):
//   NERO → PUNTI CONFINATI → PUNTI LIBERI → CAMPO REATTIVO → HARMONY → CAMPO CAMBIATO
// Phone (the individual):
//   NERO → PUNTO → NOTA → COLORE → NERO
// The audience contributes exactly two decisions: one note and one color.
//
// ─── Narrator Audio Map ──────────────────────────────────────────────────────
// All files live in simAss/narrator/. Replace any file to swap the narration.
// The content is the user's responsibility; the story only wires the filenames
// and never *depends* on a file existing (a missing file is treated as instant end).
//
//   audio1.mp3  →  ENTER   (starts immediately; "collegati")
//   audio2.mp3  →  ENTER   (starts on first connection; on end → FREE)
//   audio3.mp3  →  FREE    ("ora guarda lo schermo")
//   audio4.mp3  →  TUNE    ("trova una nota")
//   audio5.mp3  →  COLOR   ("scegli un colore")
//   audio6.mp3  →  HARMONY (spoken over the climax; optional)
//   audio7.mp3  →  CLOSE   ("puoi chiudere")

// ─── Note on hardcoded parameters ────────────────────────────────────────────
// All timers, thresholds and filenames are intentionally hardcoded here. Each
// phase has precise timings chosen during direction; keeping everything in one
// file makes it easy to tweak without hunting through sim params.

// One field language throughout — "il punto". Agents spiral toward the centre
// (dir) with a tangential offset (wind) so the cloud orbits instead of collapsing.
// Confinement radius and speed do the storytelling, not a second formula set.
const FIELD_DIR  = 'atan2(cy - y, cx - x) + sin(t * 1.4 + length(vec2(x-cx,y-cy)) * 0.012) * PI * 0.38';
const FIELD_WIND = 'atan2(cy - y, cx - x) + PI * 0.46 + sin(t * 0.65 + length(vec2(x-cx,y-cy)) * 0.007) * 0.6';

// Minimum time a voice-led phase stays up even if its narration is short.
const FLOOR_FREE  =  7_000;
const FLOOR_TUNE  = 25_000;
const FLOOR_COLOR = 15_000;

const log = (msg) => console.log(`[story] ${msg}`);

// Advance to the next step no sooner than `floorMs` after the phase was entered.
function advanceAfterFloor(step, sim, floorMs) {
    const elapsed = Date.now() - (step._t0 ?? Date.now());
    const wait    = Math.max(0, floorMs - elapsed);
    step._advTimer = setTimeout(() => sim.next(), wait);
}

export const STORY = [

    // ── PHASE 1 — ENTER (connessione) ─────────────────────────────────────────
    // Points appear at the centre on each join, confined and vibrating. audio1
    // plays immediately; joins during audio1 are queued. On first real join audio2
    // starts, and when audio2 ends we advance to FREE.
    {
        id: PHASE.ENTER,
        enter(sim) {
            this._audio1Playing = true;
            this._audio2Started = false;
            this._pendingJoins  = 0;

            log('PHASE 1 — ENTER. nero, punti confinati. audio1 in partenza.');
            sim.resetStoryChoices();
            sim.setColorMode('GRAYSCALE');
            sim.clearAvoidMap();                 // remove the boot placeholder square
            sim.setParam('autoDir',  false);     // no random formula cycling during the show
            sim.setParam('autoWind', false);
            sim.setFormulas(FIELD_DIR, FIELD_WIND);
            sim.setParam('windEnabled', true);
            sim.setParam('limitAtCenter', true);
            sim.setParam('limitAtCenterRadius', 110);
            sim.dormantSeed();

            this._audio = sim.playNarratorAudio('audio1.mp3');
            this._audio.addEventListener('ended', () => {
                this._audio1Playing = false;
                log('audio1 terminato.');
                if (this._pendingJoins > 0) {
                    for (let i = 0; i < this._pendingJoins; i++) sim.activateChunk(0.18);
                    this._startAudio2(sim);
                }
            }, { once: true });
        },
        _startAudio2(sim) {
            if (this._audio2Started) return;
            this._audio2Started = true;
            log('audio2 in partenza.');
            this._audio = sim.playNarratorAudio('audio2.mp3');
            this._audio.addEventListener('ended', () => {
                log('audio2 terminato — avanzamento a FREE.');
                sim.next();
            }, { once: true });
        },
        onSpectatorJoined(sim, userCount) {
            log('utente connesso — totale: ' + userCount);
            if (this._audio1Playing) {
                this._pendingJoins++;
                return;
            }
            sim.activateChunk(0.18);             // a burst of points at the centre per join
            if (userCount === 1) this._startAudio2(sim);
        },
        exit(sim) {
            log('uscita PHASE 1.');
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 2 — FREE (punti liberi) ─────────────────────────────────────────
    // The constraint relaxes: any still-dormant points light at the centre, then
    // the confinement radius grows over ~7 s so the cloud distends. audio3 tells
    // the audience to look at the screen.
    {
        id: PHASE.FREE,
        enter(sim) {
            log('PHASE 2 — FREE. distensione progressiva.');
            this._t0 = Date.now();
            sim.setColorMode('GRAYSCALE');
            sim.setFormulas(FIELD_DIR, FIELD_WIND);
            sim.setParam('windEnabled', true);
            sim.setParam('limitAtCenter', true);
            sim.activateChunk(1);                                 // light the remainder
            this._cancelTween = sim.tweenParam('limitAtCenterRadius', 450, 7_000);

            this._audio = sim.playNarratorAudio('audio3.mp3');
            this._audio.addEventListener('ended', () => advanceAfterFloor(this, sim, FLOOR_FREE), { once: true });
        },
        exit(sim) {
            log('uscita PHASE 2.');
            this._cancelTween?.();
            clearTimeout(this._advTimer);
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 3 — TUNE (campo reattivo) ───────────────────────────────────────
    // Live notes make the field breathe: low notes gather/slow it, high notes
    // open/speed it, the whole crowd acting as one body (see sim.breathImpulse).
    // Notes do NOT trigger harmony or images here. The audience tries and then
    // confirms a single note; on confirm the phone stops sending live notes.
    {
        id: PHASE.TUNE,
        enter(sim) {
            log('PHASE 3 — TUNE. il campo respira con le note.');
            this._t0 = Date.now();
            sim.setColorMode('GRAYSCALE');
            sim.setFormulas(FIELD_DIR, FIELD_WIND);
            sim.setParam('windEnabled', true);
            sim.setParam('limitAtCenter', true);
            sim.setParam('limitAtCenterRadius', 420);
            sim.setParam('maxSpeed', 4.0);
            sim.setParam('stepLen',  2.0);
            sim.startBreath();                                    // captures the base params above

            this._audio = sim.playNarratorAudio('audio4.mp3');
            this._audio.addEventListener('ended', () => advanceAfterFloor(this, sim, FLOOR_TUNE), { once: true });
        },
        onNoteConfirm(sim, spectatorId, index) {
            log('nota confermata — spettatore ' + String(spectatorId).slice(0, 8) + ' → index ' + index);
        },
        exit(sim) {
            log('uscita PHASE 3.');
            sim.stopBreath();
            clearTimeout(this._advTimer);
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 4 — COLOR (scelta del colore) ───────────────────────────────────
    // The field holds steady (still white/black). The phone shows a discrete
    // palette; the chosen color is buffered on the host and does NOT reach the
    // screen until the climax.
    {
        id: PHASE.COLOR,
        enter(sim) {
            log('PHASE 4 — COLOR. colore bufferizzato, schermo ancora bianco/nero.');
            this._t0 = Date.now();
            sim.setColorMode('GRAYSCALE');                        // guarantees no color leak
            sim.setParam('limitAtCenter', true);
            sim.setParam('limitAtCenterRadius', 420);

            this._audio = sim.playNarratorAudio('audio5.mp3');
            this._audio.addEventListener('ended', () => advanceAfterFloor(this, sim, FLOOR_COLOR), { once: true });
        },
        onColorConfirm(sim, spectatorId, color) {
            log('colore confermato — spettatore ' + String(spectatorId).slice(0, 8) + ' → ' + color);
        },
        exit(sim) {
            log('uscita PHASE 4.');
            clearTimeout(this._advTimer);
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 5 — HARMONY (climax) ────────────────────────────────────────────
    // Scripted montage between the two surfaces:
    //   dim the white points → brief void (phones cut to black via the step cue)
    //   → reignite a colored, spread field (~35% points take the group's palette)
    //   + the confirmed notes enter as one sustained chord → abstract shapes.
    // Advances to CLOSE at the end of the sequence (not audio-driven).
    {
        id: PHASE.HARMONY,
        enter(sim) {
            log('PHASE 5 — HARMONY. climax scriptato.');
            this._timers  = [];
            this._cancels = [];
            const at = (ms, fn) => this._timers.push(setTimeout(fn, ms));

            this._audio = sim.playNarratorAudio('audio6.mp3');    // optional voice over the climax

            // 1) Dim the white points over ~1.6 s.
            this._cancels.push(sim.tweenParam('brightness', 0.003, 1_600));

            // 2) ~0.6 s of void, then reignite: spread the field (invisible while dark),
            //    switch to color, write the confirmed colors, ring the chord.
            at(2_200, () => {
                log('riaccensione colorata + accordo.');
                sim.reseed();                                     // spread across the canvas (dark → unseen)
                sim.setParam('limitAtCenter', true);
                sim.setParam('limitAtCenterRadius', 800);         // wide disc → shapes read across the screen
                sim.setColorMode('NORMAL');
                sim.applyConfirmedColors();
                this._cancels.push(sim.tweenParam('brightness', 0.06, 900));
                sim.climaxChord(7);
            });

            // 3) Abstract shapes revealed by particle avoidance, ~7 s each.
            at(3_800,  () => { log('forma 1.'); sim.loadStaticAvoidMap('shape1.png'); });
            at(10_800, () => { log('forma 2.'); sim.loadStaticAvoidMap('shape2.png'); });
            at(17_800, () => { log('forma 3.'); sim.loadStaticAvoidMap('shape3.png'); });

            // 4) Clear and move on.
            at(24_800, () => { log('fine forme — avanzamento a CLOSE.'); sim.clearAvoidMap(); sim.next(); });
        },
        exit(sim) {
            log('uscita PHASE 5.');
            this._timers?.forEach(clearTimeout);
            this._cancels?.forEach(fn => fn?.());
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 6 — CLOSE (campo cambiato) ──────────────────────────────────────
    // A free, colored, transformed field — like FREE but it carries the group's
    // colors. The phone is black; the voice says the audience can leave.
    // Terminal step — no next().
    {
        id: PHASE.CLOSE,
        enter(sim) {
            log('PHASE 6 — CLOSE. campo libero colorato. audio7. fine storia.');
            sim.setColorMode('NORMAL');
            sim.setFormulas(FIELD_DIR, FIELD_WIND);
            sim.setParam('windEnabled', true);
            sim.setParam('limitAtCenter', true);
            sim.setParam('limitAtCenterRadius', 550);
            sim.applyConfirmedColors();                           // keep the colors present
            this._audio = sim.playNarratorAudio('audio7.mp3');
        },
        exit(sim) {
            this._audio?.pause();
            this._audio = null;
        },
    },
];
