import { PHASE } from './constants.js';

// ─── HARMONY — two parallel arcs synced by the voice ─────────────────────────
// Big screen (the collective):
//   NERO → PUNTI CONFINATI → PUNTI LIBERI → CAMPO REATTIVO → HARMONY → CAMPO CAMBIATO
// Phone (the individual):
//   NERO → PUNTO → NOTA → COLORE → NERO
// The audience contributes exactly two decisions: one note and one color.
//
// ─── Audio is king ───────────────────────────────────────────────────────────
// The narrator MP3s drive progression: a phase advances only when its audio
// ENDS — never while a voice is still playing. The single exceptions are:
//   • ENTER, which also waits for the first spectator connection; and
//   • FREE, a short scripted transition with no narration (timer-gated by design).
// The printed say() lines are kept as console fallback logging only — they no
// longer drive timing.
//
// ─── Narrator Audio Map (simAss/narrator/) ───────────────────────────────────
//   audio1.mp3  → ENTER    plays immediately; screen stays black, joins queue
//   audio2.mp3  → ENTER    starts on first connection; on end → FREE
//   audio3.mp3  → TUNE     invites playing; on end notes "count", field breathes
//   audio4.mp3  → COLOR    invites the color choice; on end → HARMONY
//   audio5.mp3  → HARMONY  narrates over the scripted climax; gates exit to CLOSE
//   audio7.mp3  → CLOSE    terminal — no next()
//   (audio6.mp3 is intentionally unused in this six-phase cut.)

// One field language throughout — "il punto". Agents spiral toward the centre
// (dir) with a tangential offset (wind) so the cloud orbits instead of collapsing.
// Confinement radius and speed do the storytelling, not a second formula set.
const FIELD_DIR  = 'atan2(cy - y, cx - x) + sin(t * 1.4 + length(vec2(x-cx,y-cy)) * 0.012) * PI * 0.38';
const FIELD_WIND = 'atan2(cy - y, cx - x) + PI * 0.46 + sin(t * 0.65 + length(vec2(x-cx,y-cy)) * 0.007) * 0.6';

// The lines the voice should say, per phase. First-person collective/entity tone.
// Printed to the console as a fallback narration; the audio files are authoritative.
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

const log = (msg)         => console.log(`[story] ${msg}`);
const say = (phase, line) => console.log(`[voce·${phase}] ${line}`);

// Cancel a step's pending timers/tweens and stop any audio it started.
function clearBeats(step) {
    step._timers?.forEach(clearTimeout);
    step._cancels?.forEach(fn => fn?.());
    step._audio?.pause();
    step._timers  = [];
    step._cancels = [];
    step._audio   = null;
}

// "Audio is king": play a narrator file and advance only when it ends.
// autoNext also fires on load error, so a missing file never stalls the show.
function playThenNext(step, sim, file) {
    step._audio = sim.playNarratorAudio(file, { autoNext: true });
    return step._audio;
}

// Run cb once when an audio element finishes — on normal end OR load error, so a
// missing file never stalls a phase that gates on its own 'ended' event.
function whenAudioDone(audio, cb) {
    let done = false;
    const fire = () => { if (!done) { done = true; cb(); } };
    audio.addEventListener('ended', fire, { once: true });
    audio.addEventListener('error', fire, { once: true });
}

export const STORY = [

    // ── PHASE 1 — ENTER (connessione) ─────────────────────────────────────────
    // Truly black + connection-gated. All agents seeded dormant (weight=0) so the
    // screen shows nothing until the flow lights them. audio1 plays immediately;
    // spectator joins during audio1 are queued, not drawn. On audio1 end: if joins
    // are queued, light them all and start audio2; otherwise wait for the first
    // connection to start audio2. audio2 end → FREE.
    {
        id: PHASE.ENTER,
        enter(sim) {
            log('PHASE 1 — ENTER. nero assoluto, punti confinati e invisibili. audio1 in partenza.');
            this._timers = []; this._cancels = [];
            this._audio1Playing = true;
            this._audio2Started = false;
            this._pendingJoins  = 0;

            sim.resetStoryChoices();
            sim.setColorMode('GRAYSCALE');
            sim.clearAvoidMap();                 // remove the boot placeholder square
            sim.setParam('autoDir',  false);     // no random formula cycling during the show
            sim.setParam('autoWind', false);
            sim.setFormulas(FIELD_DIR, FIELD_WIND);
            sim.setParam('windEnabled', true);
            sim.setParam('champLinesAlpha', 0);
            sim.setParam('limitAtCenter', true);
            sim.setParam('limitAtCenterRadius', 110);
            sim.freezeParams({ spectatorSpawnChance: 0, randomTeleportChance: 0, dotRespawnChance: 0, spawnFadeRate: 0 });
            sim.suppressImages();
            sim.dormantSeed();                   // all agents weight=0 → the screen is truly black

            say('ENTER', LINES.ENTER[0]);
            this._audio = sim.playNarratorAudio('audio1.mp3');
            whenAudioDone(this._audio, () => {
                this._audio1Playing = false;
                log('audio1 terminato.');
                if (this._pendingJoins > 0) {
                    log(this._pendingJoins + ' utenti in attesa — accendo i punti e parte audio2.');
                    for (let i = 0; i < this._pendingJoins; i++) sim.activateChunk(1);
                    this._startAudio2(sim);
                }
                // else: no one connected yet — wait for the first onSpectatorJoined.
            });
        },
        _startAudio2(sim) {
            if (this._audio2Started) return;
            this._audio2Started = true;
            say('ENTER', LINES.ENTER[1]);
            log('audio2 in partenza.');
            this._audio = sim.playNarratorAudio('audio2.mp3');
            whenAudioDone(this._audio, () => {
                log('audio2 terminato — avanzamento a FREE.');
                sim.next();
            });
        },
        onSpectatorJoined(sim, userCount) {
            log('utente connesso — totale: ' + userCount);
            if (this._audio1Playing) {
                this._pendingJoins++;
                log('audio1 in corso — join in coda (pending: ' + this._pendingJoins + ').');
                return;
            }
            sim.activateChunk(1);
            if (!this._audio2Started) this._startAudio2(sim);
        },
        exit(sim) {
            log('uscita PHASE 1 — ENTER.');
            clearBeats(this);
            sim.restoreImages();
            sim.thawParams();
        },
    },

    // ── PHASE 2 — FREE (punti liberi) ─────────────────────────────────────────
    // Short SCRIPTED transition — the one phase with no narration. Light any
    // remaining points, then grow the confinement radius over ~7 s so the cloud
    // distends. Timer-gated by design (no audio to wait on).
    {
        id: PHASE.FREE,
        enter(sim) {
            log('PHASE 2 — FREE. distensione progressiva (transizione scriptata, senza voce).');
            this._timers = []; this._cancels = []; this._audio = null;
            sim.setColorMode('GRAYSCALE');
            sim.setFormulas(FIELD_DIR, FIELD_WIND);
            sim.setParam('windEnabled', true);
            sim.setParam('limitAtCenter', true);
            sim.activateChunk(1);                                 // light the remainder
            say('FREE', LINES.FREE[0]);
            say('FREE', LINES.FREE[1]);
            this._cancels.push(sim.tweenParam('limitAtCenterRadius', 450, 7_000));
            this._timers.push(setTimeout(() => {
                log('distensione completata — avanzamento a TUNE.');
                sim.next();
            }, 7_500));
        },
        exit(sim) { log('uscita PHASE 2 — FREE.'); clearBeats(this); },
    },

    // ── PHASE 3 — TUNE (campo reattivo) ───────────────────────────────────────
    // Live notes make the field breathe (sim.breathImpulse): low notes gather/slow
    // it, high notes open/speed it — the crowd acting as one body. audio3 invites
    // playing; only after it ends do confirmed notes "count". Advance to COLOR once
    // audio3 has ended AND at least one note is confirmed.
    {
        id: PHASE.TUNE,
        enter(sim) {
            log('PHASE 3 — TUNE. il campo respira con le note. audio3 in partenza.');
            this._timers = []; this._cancels = [];
            this._notesEnabled  = false;
            this._noteConfirmed = false;
            sim.setColorMode('GRAYSCALE');
            sim.setFormulas(FIELD_DIR, FIELD_WIND);
            sim.setParam('windEnabled', true);
            sim.setParam('limitAtCenter', true);
            sim.setParam('limitAtCenterRadius', 420);
            sim.setParam('maxSpeed', 4.0);
            sim.setParam('stepLen',  2.0);
            sim.startBreath();                                    // captures the base motion params

            say('TUNE', LINES.TUNE[0]);
            say('TUNE', LINES.TUNE[1]);
            this._audio = sim.playNarratorAudio('audio3.mp3');
            whenAudioDone(this._audio, () => {
                log('audio3 terminato — note abilitate; attendo una nota confermata.');
                this._notesEnabled = true;
                say('TUNE', LINES.TUNE[2]);
                this._advanceIfReady(sim);
            });
        },
        _advanceIfReady(sim) {
            if (this._notesEnabled && this._noteConfirmed) {
                log('audio finito + nota confermata — avanzamento a COLOR.');
                sim.next();
            }
        },
        onNoteConfirm(sim, spectatorId, index) {
            log('nota confermata — spettatore ' + String(spectatorId).slice(0, 8) + ' → index ' + index);
            this._noteConfirmed = true;
            this._advanceIfReady(sim);
        },
        exit(sim) { log('uscita PHASE 3 — TUNE.'); sim.stopBreath(); clearBeats(this); },
    },

    // ── PHASE 4 — COLOR (scelta del colore) ───────────────────────────────────
    // The field holds steady and GRAYSCALE — the chosen color is buffered on the
    // host and does NOT reach the screen until the climax. audio4 invites the
    // choice; the phone shows the picker (server-driven). Advance on audio4 end.
    {
        id: PHASE.COLOR,
        enter(sim) {
            log('PHASE 4 — COLOR. colore bufferizzato, schermo ancora grigio. audio4 in partenza.');
            this._timers = []; this._cancels = [];
            sim.setColorMode('GRAYSCALE');                        // guard: no color leak yet
            sim.setParam('limitAtCenter', true);
            sim.setParam('limitAtCenterRadius', 420);
            say('COLOR', LINES.COLOR[0]);
            say('COLOR', LINES.COLOR[1]);
            playThenNext(this, sim, 'audio4.mp3');                // advance when audio4 ends
        },
        onColorConfirm(sim, spectatorId, color) {
            log('colore confermato — spettatore ' + String(spectatorId).slice(0, 8) + ' → ' + color);
        },
        exit(sim) { log('uscita PHASE 4 — COLOR.'); clearBeats(this); },
    },

    // ── PHASE 5 — HARMONY (climax) ────────────────────────────────────────────
    // Scripted montage, audio5 narrating over it:
    //   dim the white points → brief void → reseed + spread the field → switch to
    //   color and HARD-reveal the audience palette across the WHOLE field →
    //   ring the confirmed chord → the particles spell HARMONY → the word gives way
    //   to abstract shapes (they share one avoidmap, so they take turns).
    // Internal beats are choreographed, not audio-gated — but the phase will not
    // advance to CLOSE until BOTH the shapes finish AND audio5 has ended.
    {
        id: PHASE.HARMONY,
        enter(sim) {
            log('PHASE 5 — HARMONY. climax scriptato. audio5 in partenza.');
            this._timers = []; this._cancels = [];
            this._shapesDone = false;
            this._audioEnded = false;
            const at = (ms, fn) => this._timers.push(setTimeout(fn, ms));

            this._audio = sim.playNarratorAudio('audio5.mp3');
            whenAudioDone(this._audio, () => {
                this._audioEnded = true;
                this._advanceWhenAudioDone(sim);
            });

            // 1) Dim the white points over ~1.6 s.
            say('HARMONY', 'Guardate: la luce si spegne.');
            this._cancels.push(sim.tweenParam('brightness', 0.003, 1_600));

            // 2) ~0.6 s of void — only the phones hold color in the room.
            at(1_800, () => say('HARMONY', 'Restano solo i vostri colori.'));

            // 3) Reignite: spread the field (invisible while dark), switch to color,
            //    HARD-reveal from the palette (whole field), ring the chord.
            at(2_200, () => {
                say('HARMONY', 'Ora. Insieme.');
                sim.reseed();
                sim.setParam('limitAtCenter', true);
                sim.setParam('limitAtCenterRadius', 800);         // wide disc → word/shapes read across the screen
                sim.setColorMode('NORMAL');
                sim.applyPaletteToField();                        // base gradient + slots take the audience palette
                this._cancels.push(sim.tweenParam('brightness', 0.06, 900));
                sim.climaxChord(7);
            });

            // 4) The particles spell HARMONY, held a few seconds.
            at(3_800, () => { say('HARMONY', 'Una parola nasce dal campo.'); sim.setTraceText('HARMONY'); });

            // 5) The word gives way to abstract shapes, ~6 s each.
            at(9_800,  () => { say('HARMONY', 'E si trasforma.'); sim.setTraceText(''); sim.loadStaticAvoidMap('shape1.png'); });
            at(15_800, () => { say('HARMONY', 'E ancora.');       sim.loadStaticAvoidMap('shape2.png'); });
            at(21_800, () => { sim.loadStaticAvoidMap('shape3.png'); });

            // 6) Clear, then advance — but only once audio5 has finished ("audio is king").
            at(27_800, () => {
                log('fine forme.');
                sim.clearAvoidMap();
                this._shapesDone = true;
                this._advanceWhenAudioDone(sim);
            });
        },
        _advanceWhenAudioDone(sim) {
            if (this._shapesDone && this._audioEnded) {
                log('forme finite + audio5 finito — avanzamento a CLOSE.');
                sim.next();
            }
        },
        exit(sim) {
            log('uscita PHASE 5 — HARMONY.');
            clearBeats(this);
            sim.setTraceText('');
        },
    },

    // ── PHASE 6 — CLOSE (campo cambiato) ──────────────────────────────────────
    // A free, colored, transformed field — like FREE but carrying the group's
    // palette. audio7 tells the audience they can leave. Terminal step — no next().
    {
        id: PHASE.CLOSE,
        enter(sim) {
            log('PHASE 6 — CLOSE. campo libero colorato. audio7 in partenza. fine storia.');
            this._timers = []; this._cancels = [];
            sim.setColorMode('NORMAL');
            sim.setFormulas(FIELD_DIR, FIELD_WIND);
            sim.setParam('windEnabled', true);
            sim.setParam('limitAtCenter', true);
            sim.setParam('limitAtCenterRadius', 550);
            sim.applyPaletteToField();                            // keep the palette present
            say('CLOSE', LINES.CLOSE[0]);
            say('CLOSE', LINES.CLOSE[1]);
            this._audio = sim.playNarratorAudio('audio7.mp3');    // terminal — no next()
        },
        exit(sim) { clearBeats(this); },
    },
];
