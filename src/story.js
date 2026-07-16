import { PHASE, RESEED } from './constants.js';

// ─── Narrator Audio Map ──────────────────────────────────────────────────────
// All files live in simAss/narrator/. Replace any file to swap the narration.
//
//   audio1.mp3  →  PHASE 1 — starts immediately; stops on first connection
//   audio2.mp3  →  PHASE 1 — starts on first connection; 10s later → PHASE 2
//   audio3.mp3  →  PHASE 2 — starts immediately on enter
//   audio4.mp3  →  PHASE 3 — give a color to the note
//   audio5.mp3  →  PHASE 5 — "Il rombo prima del lampo..."
//   audio6.mp3  →  PHASE 7 — one word each
//   audio7.mp3  →  PHASE 8 — harmony is not the same note
//
// PHASE 6 has no audio (director's note: "no commentary needed").

// ─── Note on hardcoded parameters ────────────────────────────────────────────
// All timers, thresholds and filenames are intentionally hardcoded in this file.
// Each phase has precise timings chosen during direction, and keeping everything
// here makes it easy to tweak any detail without hunting through sim params.

// ─── Story Steps ────────────────────────────────────────────────────────────
// Each object is one step. Order matters — the engine runs them in sequence.
//
// Hooks available on each step:
//   enter(sim)                — called when the step becomes active
//   exit(sim)                 — called before moving to the next step
//   onSpectatorJoined(sim, n) — called each time a spectator connects
//   onNote(sim, noteIndex)    — called each time any spectator plays a note
//
// sim primitives:
//   sim.dormantSeed()              — seed all agents invisible (weight=0)
//   sim.activateChunk(fraction)    — light up next N% of agents from center
//   sim.freezeParams(overrides)    — save + override named params
//   sim.thawParams()               — restore params saved by freezeParams
//   sim.reseed({ mode })           — full reseed; mode: RESEED.FADE_FROM_EDGES → perimeter spawn at weight=0
//   sim.next()                     — advance to the next step
//   sim.setParam(key, val)         — override a single param
//   sim.suppressImages()           — block loadAvoidMap (images from admin)
//   sim.restoreImages()            — re-enable loadAvoidMap
//   sim.enableHarmonyImages()      — allow harmony to show its avoidmap image (off by default)
//   sim.disableHarmonyImages()     — hide harmony image; blocks future ones until re-enabled
//   sim.playNarratorAudio(file)    — play simAss/narrator/<file>; auto-next on ended
//   sim.setTraceText(text)         — set the trace text input and re-render the avoidmap

const log = (msg) => console.log(`[story] ${msg}`);

// PHASE 3 riser build-up length (ms). The generative drop's impact and the red
// colour reveal both fire when this timer elapses, so they land perfectly synced.
const RISER_MS = 4000;

export const STORY = [

    // ── PHASE 1 — CONNECTION ──────────────────────────────────────────────────
    // audio1 starts immediately on enter.
    // Spectator joins are ignored visually during audio1 (queued).
    // audio1 ends → if queued users exist, activate their chunks and start audio2;
    //               otherwise wait for the first user normally.
    // audio2 ends → immediate sim.next() (HARMONY text + 10s wait in PHASE 2).
    {
        id: PHASE.P1,
        enter(sim) {
            this._audio2Started = false;
            this._audio1Playing = true;
            this._pendingJoins  = 0;

            log('PHASE 1 — fade out, tutto nero. audio1 in partenza.');
            sim.clearAvoidMap();
            sim.setColorMode('GRAYSCALE');
            sim.freezeParams({ spectatorSpawnChance: 0, randomTeleportChance: 0, dotRespawnChance: 0, spawnFadeRate: 0 });
            sim.setParam('champLinesAlpha', 0);
            sim.setParam('limitAtCenter', true);
            sim.setParam('limitAtCenterRadius', 100);
            sim.suppressImages();
            sim.dormantSeed();
            this._audio = sim.playNarratorAudio('audio1.mp3');
            this._audio.addEventListener('ended', () => {
                this._audio1Playing = false;
                log('audio1 terminato.');
                if (this._pendingJoins > 0) {
                    log(this._pendingJoins + ' utenti in attesa — attivazione chunk e avvio audio2.');
                    for (let i = 0; i < this._pendingJoins; i++) sim.activateChunk(1);
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
                log('audio2 terminato — avanzamento immediato a PHASE 2.');
                sim.next();
            }, { once: true });
        },
        onSpectatorJoined(sim, userCount) {
            log('utente connesso — totale: ' + userCount);
            if (this._audio1Playing) {
                this._pendingJoins++;
                log('audio1 in corso — join ignorato graficamente (pending: ' + this._pendingJoins + ').');
                return;
            }
            sim.activateChunk(1);
            if (userCount === 1) {
                log('primo utente — avvio audio2.');
                this._startAudio2(sim);
            }
        },
        exit(sim) {
            log('uscita PHASE 1 — formule aggiornate, respawn random già attivo.');
            this._audio?.pause();
            this._audio = null;
            sim.restoreImages();
            sim.thawParams();
            sim.setFormulas(
                'atan2(cy - y, cx - x) + sin(t * 1.4 + length(vec2(x-cx,y-cy)) * 0.012) * PI * 0.38',
                'atan2(cy - y, cx - x) + PI * 0.46 + sin(t * 0.65 + length(vec2(x-cx,y-cy)) * 0.007) * 0.6',
            );
        },
    },

    // ── PHASE 2 — THE NOTE ────────────────────────────────────────────────────
    // Enters immediately from PHASE 1. Waits 10s, then audio3.
    // Notes are ignored until audio3 finishes (prevents notes sent during audio2
    // or audio3 from triggering the timer early).
    // First note after audio3 → wind on → 20s timer → sim.next().
    {
        id: PHASE.P2,
        _noteTimerStarted: false,
        _notesEnabled: false,
        enter(sim) {
            this._noteTimerStarted = false;
            this._notesEnabled = false;
            sim.setParam('limitAtCenter', false);
            sim.freezeParams({ windEnabled: false });
            sim.loadStaticAvoidMap('circle.png');
            sim.startBackgroundMusic();
            sim.startBlinkersLoop();
            sim.enableFullSynth();
            log('PHASE 2 — nota. note disabilitate fino a fine audio3. audio3 parte tra 10s.');
            setTimeout(() => {
                log('10s scaduti — audio3 in partenza.');
                this._audio = sim.playNarratorAudio('audio3.mp3');
                this._audio.addEventListener('ended', () => {
                    log('audio3 terminato — note abilitate.');
                    this._notesEnabled = true;
                }, { once: true });
            }, 10_000);
        },
        onNote(sim, noteIndex) {
            if (!this._notesEnabled || this._noteTimerStarted) return;
            this._noteTimerStarted = true;
            sim.setParam('windEnabled', true);
            log('prima nota ricevuta (index ' + noteIndex + '). wind abilitato. timer 20s avviato → PHASE 3.');
            setTimeout(() => {
                log('20s scaduti — avanzamento a PHASE 3.');
                sim.next();
            }, 20_000);
        },
        exit(sim) {
            log('uscita PHASE 2.');
            sim.thawParams();
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 3 ───────────────────────────────────────────────────────────────
    // NORMAL color → HARMONY text immediately → 10s timer → harmony images → audio4.
    // After audio4 ends: a RISER_MS build-up (riser) resolves into a synced drop —
    // impact + red colour reveal fire together → PHASE 4.
    // File: simAss/narrator/audio4.mp3
    {
        id: PHASE.P3,
        enter(sim) {
            sim.setColorMode('NORMAL');
            sim.setParam('champLinesAlpha', 0.02);
            // HARMONY text fades in only after a 7–10s timer, like the harmony images.
            const textDelay = 7000 + Math.random() * 3000;
            this._textTimer = setTimeout(() => sim.setTraceText('HARMONY'), textDelay);
            log(`PHASE 3. testo HARMONY tra ${Math.round(textDelay / 1000)}s. immagini e audio tra 10s.`);
            this._respawnTimer = setTimeout(() => {
                log('10s scaduti — immagini harmony abilitate. dotRespawnChance abilitato (0.002). audio4 in partenza.');
                sim.enableHarmonyImages();
                sim.setParam('dotRespawnChance', 0.002);
                this._audio = sim.playNarratorAudio('audio4.mp3');
                this._audio.addEventListener('ended', () => {
                    log(`audio4 terminato. riser ${Math.round(RISER_MS / 1000)}s → drop → PHASE 4.`);
                    sim.playRiser(RISER_MS);
                    this._riserTimer = setTimeout(() => {
                        log('drop — impact + color1=#ff0000 color2=#ff0000. avanzamento a PHASE 4.');
                        sim.triggerImpact();
                        sim.freezeParams({ color1: '#ff0000', color2: '#ff0000' });
                        sim.next();
                    }, RISER_MS);
                }, { once: true });
            }, 10_000);
        },
        exit(sim) {
            log('uscita PHASE 3.');
            clearTimeout(this._textTimer);
            clearTimeout(this._respawnTimer);
            clearTimeout(this._riserTimer);
            // Harmony images stay enabled from here on (intentionally not disabled).
            sim.thawParams();
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 4 — IMAGE: HEART ────────────────────────────────────────────────
    // TODO: implement image appearance logic (how the image fades/arrives on screen).
    // Narrator speaks after silence; advances when audio ends.
    // File: simAss/narrator/audio4.mp3
    {
        id: PHASE.P4,
        enter(sim) {
            // Hold 5s after the drop so its energetic body is audible before audio4
            // narration ducks the bed, then start audio4.
            log('PHASE 4 — cuore. audio4 tra 5s (il drop resta udibile prima del ducking).');
            // TODO: load heart image into avoidmap
            this._audioTimer = setTimeout(() => {
                log('5s scaduti — audio4 in partenza.');
                this._audio = sim.playNarratorAudio('audio4.mp3', { autoNext: true });
            }, 5_000);
        },
        exit(sim) {
            log('uscita PHASE 4.');
            clearTimeout(this._audioTimer);
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 5 — IMAGE: STORM ────────────────────────────────────────────────
    // TODO: implement image appearance logic.
    // Narrator speaks; advances when audio ends.
    // File: simAss/narrator/audio5.mp3
    {
        id: PHASE.P5,
        enter(sim) {
            log('PHASE 5 — tempesta. audio5 in partenza.');
            // TODO: load storm image into avoidmap
            this._audio = sim.playNarratorAudio('audio5.mp3', { autoNext: true });
        },
        exit(sim) {
            log('uscita PHASE 5.');
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 6 — IMAGE: BIG BANG ─────────────────────────────────────────────
    // TODO: implement image appearance logic.
    // No narration (director's note: "no commentary needed").
    // Shown for 5 seconds, then cuts to black and auto-advances.
    {
        id: PHASE.P6,
        enter(sim) {
            log('PHASE 6 — bigbang. timer 5s avviato (no audio).');
            // TODO: load big bang image into avoidmap
            this._timer = setTimeout(() => {
                log('5s scaduti — avanzamento a PHASE 7.');
                sim.next();
            }, 5_000);
        },
        exit(sim) {
            log('uscita PHASE 6.');
            clearTimeout(this._timer);
            // TODO: cut to black before advancing
        },
    },

    // ── PHASE 7 — TEXT ────────────────────────────────────────────────────────
    // Narrator speaks; advances automatically when audio ends.
    // File: simAss/narrator/audio6.mp3
    {
        id: PHASE.P7,
        enter(sim) {
            log('PHASE 7 — testo. audio6 in partenza.');
            this._audio = sim.playNarratorAudio('audio6.mp3', { autoNext: true });
        },
        exit(sim) {
            log('uscita PHASE 7.');
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 8 — CLOSING ─────────────────────────────────────────────────────
    // Narrator speaks. Last step — no next().
    // The AANT logo replaces the HARMONY text as the avoid map: harmony images are
    // disabled first so a note change can't overwrite it, the text input is cleared,
    // then the static logo is loaded (it owns the avoid map and won't be cleared).
    // File: simAss/narrator/audio7.mp3
    {
        id: PHASE.P8,
        enter(sim) {
            log('PHASE 8 — chiusura. logo AANT come avoid map. audio7 in partenza. fine storia.');
            sim.disableHarmonyImages();
            sim.setTraceText('');
            sim.loadStaticAvoidMap('aant_logo.png');
            this._audio = sim.playNarratorAudio('audio7.mp3');
        },
        exit(sim) {
            this._audio?.pause();
            this._audio = null;
        },
    },
];
