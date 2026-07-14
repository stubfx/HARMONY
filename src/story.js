import { PHASE } from './constants.js';

// ─── HARMONY — two parallel arcs synced by the voice ─────────────────────────
// Big screen (the collective):
//   NERO → PUNTI CONFINATI → PUNTI LIBERI → CAMPO REATTIVO → HARMONY → CAMPO CAMBIATO
// Phone (the individual):
//   NERO → PUNTO → NOTA → COLORE → NERO
// The audience contributes exactly two decisions: one note and one color.
//
// ─── TEMPORARY: narration is printed, not played ─────────────────────────────
// The narrator MP3s aren't recorded yet, so instead of sim.playNarratorAudio()
// each phase PRINTS the lines the voice should say to the console and advances on
// a fixed 2 s beat (see STEP_MS + narrate()). Phases with several beats step
// through them 2 s apart. When the audio exists, swap narrate() back for
// sim.playNarratorAudio('audioN.mp3') and advance on its 'ended' event.

// One field language throughout — "il punto". Agents spiral toward the centre
// (dir) with a tangential offset (wind) so the cloud orbits instead of collapsing.
// Confinement radius and speed do the storytelling, not a second formula set.
const FIELD_DIR  = 'atan2(cy - y, cx - x) + sin(t * 1.4 + length(vec2(x-cx,y-cy)) * 0.012) * PI * 0.38';
const FIELD_WIND = 'atan2(cy - y, cx - x) + PI * 0.46 + sin(t * 0.65 + length(vec2(x-cx,y-cy)) * 0.007) * 0.6';

// The lines the voice should say, per phase. First-person collective/entity tone.
const LINES = {
    ENTER: [
        'Prima che tutto cominci, resta il buio. Ogni punto esiste già; nessuno si vede ancora.',
        'Collegatevi. A ogni presenza, un punto si accende al centro.',
    ],
    FREE: [
        'Ora i punti non sono più trattenuti: si distendono, si liberano.',
        'Guardate lo schermo. Da qui in avanti, guardate insieme.',
    ],
    TUNE: [
        'Provate a suonare. Ogni nota fa respirare il campo.',
        'Le note basse lo raccolgono, le alte lo aprono.',
        'Quando avete trovato la vostra nota, tenetela: quella nota è vostra.',
    ],
    COLOR: [
        'Adesso scegliete un colore.',
        'Lo schermo resta bianco: il colore, per ora, resta con voi.',
    ],
    CLOSE: [
        'Il campo non è più quello di prima. Porta i vostri colori.',
        'Potete lasciare il telefono. La cosa che avete acceso resta.',
    ],
};

const STEP_MS = 2_000;   // temporary: print a line, wait 2 s, move on
const log = (msg) => console.log(`[story] ${msg}`);
const say = (phase, line) => console.log(`[voce·${phase}] ${line}`);

// Print each line STEP_MS apart, then (2 s after the last line) run onDone.
// Timers are tracked on the step so exit() can cancel a half-run sequence.
function narrate(step, phase, lines, onDone) {
    step._timers = step._timers ?? [];
    let t = 0;
    for (const line of lines) {
        step._timers.push(setTimeout(() => say(phase, line), t));
        t += STEP_MS;
    }
    if (onDone) step._timers.push(setTimeout(onDone, t));
}

// Cancel every timer and tween a step scheduled.
function clearBeats(step) {
    step._timers?.forEach(clearTimeout);
    step._cancels?.forEach(fn => fn?.());
    step._timers  = [];
    step._cancels = [];
}

export const STORY = [

    // ── PHASE 1 — ENTER (connessione) ─────────────────────────────────────────
    // Points appear at the centre on each join, confined and vibrating.
    {
        id: PHASE.ENTER,
        enter(sim) {
            log('PHASE 1 — ENTER. nero, punti confinati.');
            this._timers = []; this._cancels = [];
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
            narrate(this, 'ENTER', LINES.ENTER, () => sim.next());
        },
        onSpectatorJoined(sim, userCount) {
            log('utente connesso — totale: ' + userCount);
            sim.activateChunk(0.18);             // a burst of points at the centre per join
        },
        exit(sim) { log('uscita PHASE 1.'); clearBeats(this); },
    },

    // ── PHASE 2 — FREE (punti liberi) ─────────────────────────────────────────
    // The constraint relaxes: any still-dormant points light at the centre, then
    // the confinement radius grows over ~7 s so the cloud distends.
    {
        id: PHASE.FREE,
        enter(sim) {
            log('PHASE 2 — FREE. distensione progressiva.');
            this._timers = []; this._cancels = [];
            sim.setColorMode('GRAYSCALE');
            sim.setFormulas(FIELD_DIR, FIELD_WIND);
            sim.setParam('windEnabled', true);
            sim.setParam('limitAtCenter', true);
            sim.activateChunk(1);                                 // light the remainder
            this._cancels.push(sim.tweenParam('limitAtCenterRadius', 450, 7_000));
            narrate(this, 'FREE', LINES.FREE, () => sim.next());
        },
        exit(sim) { log('uscita PHASE 2.'); clearBeats(this); },
    },

    // ── PHASE 3 — TUNE (campo reattivo) ───────────────────────────────────────
    // Live notes make the field breathe: low notes gather/slow it, high notes
    // open/speed it, the whole crowd acting as one body (see sim.breathImpulse).
    // Notes do NOT trigger harmony or images here. The audience tries then confirms
    // a single note; on confirm the phone stops sending live notes.
    {
        id: PHASE.TUNE,
        enter(sim) {
            log('PHASE 3 — TUNE. il campo respira con le note.');
            this._timers = []; this._cancels = [];
            sim.setColorMode('GRAYSCALE');
            sim.setFormulas(FIELD_DIR, FIELD_WIND);
            sim.setParam('windEnabled', true);
            sim.setParam('limitAtCenter', true);
            sim.setParam('limitAtCenterRadius', 420);
            sim.setParam('maxSpeed', 4.0);
            sim.setParam('stepLen',  2.0);
            sim.startBreath();                                    // captures the base params above
            narrate(this, 'TUNE', LINES.TUNE, () => sim.next());
        },
        onNoteConfirm(sim, spectatorId, index) {
            log('nota confermata — spettatore ' + String(spectatorId).slice(0, 8) + ' → index ' + index);
        },
        exit(sim) { log('uscita PHASE 3.'); sim.stopBreath(); clearBeats(this); },
    },

    // ── PHASE 4 — COLOR (scelta del colore) ───────────────────────────────────
    // The field holds steady (still white/black). The phone shows a discrete
    // palette; the chosen color is buffered on the host and does NOT reach the
    // screen until the climax.
    {
        id: PHASE.COLOR,
        enter(sim) {
            log('PHASE 4 — COLOR. colore bufferizzato, schermo ancora bianco/nero.');
            this._timers = []; this._cancels = [];
            sim.setColorMode('GRAYSCALE');                        // guarantees no color leak
            sim.setParam('limitAtCenter', true);
            sim.setParam('limitAtCenterRadius', 420);
            narrate(this, 'COLOR', LINES.COLOR, () => sim.next());
        },
        onColorConfirm(sim, spectatorId, color) {
            log('colore confermato — spettatore ' + String(spectatorId).slice(0, 8) + ' → ' + color);
        },
        exit(sim) { log('uscita PHASE 4.'); clearBeats(this); },
    },

    // ── PHASE 5 — HARMONY (climax) ────────────────────────────────────────────
    // Scripted montage between the two surfaces:
    //   dim the white points → brief void (phones cut to black via the step cue)
    //   → reignite a colored, spread field (~35% points take the group's palette)
    //   + the confirmed notes enter as one sustained chord → abstract shapes.
    // Timings are choreographed (not a flat 2 s beat); each beat still narrates.
    {
        id: PHASE.HARMONY,
        enter(sim) {
            log('PHASE 5 — HARMONY. climax scriptato.');
            this._timers = []; this._cancels = [];
            const at = (ms, fn) => this._timers.push(setTimeout(fn, ms));

            // 1) Dim the white points over ~1.6 s.
            say('HARMONY', 'Guardate: la luce si spegne.');
            this._cancels.push(sim.tweenParam('brightness', 0.003, 1_600));

            // 2) ~0.6 s of void — only the phone colors remain in the room.
            at(1_800, () => say('HARMONY', 'Restano solo i vostri colori.'));

            // 3) Reignite: spread the field (invisible while dark), switch to color,
            //    write the confirmed colors, ring the chord.
            at(2_200, () => {
                say('HARMONY', 'Ora. Insieme.');
                sim.reseed();
                sim.setParam('limitAtCenter', true);
                sim.setParam('limitAtCenterRadius', 800);         // wide disc → shapes read across the screen
                sim.setColorMode('NORMAL');
                sim.applyConfirmedColors();
                this._cancels.push(sim.tweenParam('brightness', 0.06, 900));
                sim.climaxChord(7);
            });

            // 4) Abstract shapes revealed by particle avoidance, ~7 s each.
            at(3_800,  () => { say('HARMONY', 'Una forma nasce dal campo.'); sim.loadStaticAvoidMap('shape1.png'); });
            at(10_800, () => { say('HARMONY', 'E si trasforma.');            sim.loadStaticAvoidMap('shape2.png'); });
            at(17_800, () => { say('HARMONY', 'E ancora.');                  sim.loadStaticAvoidMap('shape3.png'); });

            // 5) Clear and move on.
            at(24_800, () => { log('fine forme — avanzamento a CLOSE.'); sim.clearAvoidMap(); sim.next(); });
        },
        exit(sim) { log('uscita PHASE 5.'); clearBeats(this); },
    },

    // ── PHASE 6 — CLOSE (campo cambiato) ──────────────────────────────────────
    // A free, colored, transformed field — like FREE but it carries the group's
    // colors. The phone is black; the voice says the audience can leave.
    // Terminal step — no next().
    {
        id: PHASE.CLOSE,
        enter(sim) {
            log('PHASE 6 — CLOSE. campo libero colorato. fine storia.');
            this._timers = []; this._cancels = [];
            sim.setColorMode('NORMAL');
            sim.setFormulas(FIELD_DIR, FIELD_WIND);
            sim.setParam('windEnabled', true);
            sim.setParam('limitAtCenter', true);
            sim.setParam('limitAtCenterRadius', 550);
            sim.applyConfirmedColors();                           // keep the colors present
            narrate(this, 'CLOSE', LINES.CLOSE, null);            // terminal — no next()
        },
        exit(sim) { clearBeats(this); },
    },
];
