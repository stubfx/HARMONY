import { PHASE, RESEED } from './constants.js';

// ─── Phase audio ─────────────────────────────────────────────────────────────
// No phase uses recorded narration any more. Every phase announces itself by
// having the simulation "speak" its own phase number as a short binary tone
// sequence (sim.speakPhase(this.id)) at the point its narration used to start.
// PHASE 6 stays silent (director's note: "no commentary needed").
// (sim.playNarratorAudio is still available as a primitive but is now unused.)

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

// How long a narration-free phase holds after its binary cue before it acts
// (advances, or — where a phase used to wait on an audio 'ended' event — proceeds
// to its next step). The cue plays near the start of this window. Matches PHASE 6's
// silent hold.
const PHASE_CUE_HOLD_MS = 5000;

export const STORY = [

    // ── PHASE 1 — CONNECTION ──────────────────────────────────────────────────
    // Binary cue 1 plays immediately on enter. Each spectator that joins lights up
    // their chunk. The first connection starts a PHASE_CUE_HOLD_MS hold → PHASE 2.
    {
        id: PHASE.P1,
        enter(sim) {
            sim.setSynthEnergy(0, 0); // calm bed — reset any post-drop energy on restart
            log('PHASE 1 — fade out, tutto nero. cue binario 1.');
            sim.clearAvoidMap();
            sim.setColorMode('GRAYSCALE');
            sim.freezeParams({ spectatorSpawnChance: 0, randomTeleportChance: 0, dotRespawnChance: 0, spawnFadeRate: 0 });
            sim.setParam('champLinesAlpha', 0);
            sim.setParam('limitAtCenter', true);
            sim.setParam('limitAtCenterRadius', 100);
            sim.suppressImages();
            sim.dormantSeed();
            sim.speakPhase(this.id);
        },
        onSpectatorJoined(sim, userCount) {
            log('utente connesso — totale: ' + userCount);
            sim.activateChunk(1);
            if (userCount === 1) {
                log(`primo utente — hold ${Math.round(PHASE_CUE_HOLD_MS / 1000)}s → PHASE 2.`);
                this._timer = setTimeout(() => {
                    log('hold scaduto — avanzamento a PHASE 2.');
                    sim.next();
                }, PHASE_CUE_HOLD_MS);
            }
        },
        exit(sim) {
            log('uscita PHASE 1 — formule aggiornate, respawn random già attivo.');
            clearTimeout(this._timer);
            sim.restoreImages();
            sim.thawParams();
            sim.setFormulas(
                'atan2(cy - y, cx - x) + sin(t * 1.4 + length(vec2(x-cx,y-cy)) * 0.012) * PI * 0.38',
                'atan2(cy - y, cx - x) + PI * 0.46 + sin(t * 0.65 + length(vec2(x-cx,y-cy)) * 0.007) * 0.6',
            );
        },
    },

    // ── PHASE 2 — THE NOTE ────────────────────────────────────────────────────
    // Enters immediately from PHASE 1. Waits 10s, then binary cue 2.
    // Notes are ignored until PHASE_CUE_HOLD_MS after the cue (prevents notes sent
    // during the intro from triggering the timer early).
    // First note after that → wind on → 20s timer → sim.next().
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
            sim.setSynthEnergy(0, 0); // calm bed — reset any post-drop energy on restart
            log('PHASE 2 — nota. note disabilitate fino a fine cue. cue binario 2 tra 10s.');
            this._cueTimer = setTimeout(() => {
                log('10s scaduti — cue binario 2.');
                sim.speakPhase(this.id);
                this._enableTimer = setTimeout(() => {
                    log('cue terminato — note abilitate.');
                    this._notesEnabled = true;
                }, PHASE_CUE_HOLD_MS);
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
            clearTimeout(this._cueTimer);
            clearTimeout(this._enableTimer);
            sim.thawParams();
        },
    },

    // ── PHASE 3 ───────────────────────────────────────────────────────────────
    // NORMAL color → HARMONY text immediately → 10s timer → harmony images → binary cue 3.
    // After a PHASE_CUE_HOLD_MS hold: a RISER_MS build-up (riser) resolves into a
    // synced drop — impact + red colour reveal fire together → PHASE 4.
    {
        id: PHASE.P3,
        enter(sim) {
            sim.setColorMode('NORMAL');
            sim.setParam('champLinesAlpha', 0.02);
            // HARMONY text fades in only after a 7–10s timer, like the harmony images.
            const textDelay = 7000 + Math.random() * 3000;
            this._textTimer = setTimeout(() => sim.setTraceText('HARMONY'), textDelay);
            log(`PHASE 3. testo HARMONY tra ${Math.round(textDelay / 1000)}s. immagini e cue tra 10s.`);
            this._respawnTimer = setTimeout(() => {
                log('10s scaduti — immagini harmony abilitate. dotRespawnChance abilitato (0.002). cue binario 3.');
                sim.enableHarmonyImages();
                sim.setParam('dotRespawnChance', 0.002);
                sim.speakPhase(this.id);
                this._cueHoldTimer = setTimeout(() => {
                    log(`cue terminato. riser ${Math.round(RISER_MS / 1000)}s → drop → PHASE 4.`);
                    sim.playRiser(RISER_MS);
                    this._riserTimer = setTimeout(() => {
                        log('drop — impact + color1=#ff0000 color2=#ff0000. avanzamento a PHASE 4.');
                        sim.triggerImpact();
                        sim.freezeParams({ color1: '#ff0000', color2: '#ff0000' });
                        sim.next();
                    }, RISER_MS);
                }, PHASE_CUE_HOLD_MS);
            }, 10_000);
        },
        exit(sim) {
            log('uscita PHASE 3.');
            clearTimeout(this._textTimer);
            clearTimeout(this._respawnTimer);
            clearTimeout(this._cueHoldTimer);
            clearTimeout(this._riserTimer);
            // Harmony images stay enabled from here on (intentionally not disabled).
            sim.thawParams();
        },
    },

    // ── PHASE 4 — IMAGE: HEART ────────────────────────────────────────────────
    // TODO: implement image appearance logic (how the image fades/arrives on screen).
    // No narration — the sim speaks its phase number as a binary cue, then the
    // phase holds for PHASE_CUE_HOLD_MS before auto-advancing.
    {
        id: PHASE.P4,
        enter(sim) {
            log(`PHASE 4 — cuore. cue binario ${this.id}. avanzamento tra ${Math.round(PHASE_CUE_HOLD_MS / 1000)}s.`);
            // TODO: load heart image into avoidmap
            sim.speakPhase(this.id);
            this._timer = setTimeout(() => {
                log('hold scaduto — avanzamento a PHASE 5.');
                sim.next();
            }, PHASE_CUE_HOLD_MS);
        },
        exit(sim) {
            log('uscita PHASE 4.');
            clearTimeout(this._timer);
        },
    },

    // ── PHASE 5 — IMAGE: STORM ────────────────────────────────────────────────
    // TODO: implement image appearance logic.
    // No narration — the sim speaks its phase number as a binary cue, then the
    // phase holds for PHASE_CUE_HOLD_MS before auto-advancing.
    {
        id: PHASE.P5,
        enter(sim) {
            log(`PHASE 5 — tempesta. cue binario ${this.id}. avanzamento tra ${Math.round(PHASE_CUE_HOLD_MS / 1000)}s.`);
            // TODO: load storm image into avoidmap
            sim.speakPhase(this.id);
            this._timer = setTimeout(() => {
                log('hold scaduto — avanzamento a PHASE 6.');
                sim.next();
            }, PHASE_CUE_HOLD_MS);
        },
        exit(sim) {
            log('uscita PHASE 5.');
            clearTimeout(this._timer);
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
    // No narration — the sim speaks its phase number as a binary cue, then the
    // phase holds for PHASE_CUE_HOLD_MS before auto-advancing.
    {
        id: PHASE.P7,
        enter(sim) {
            log(`PHASE 7 — testo. cue binario ${this.id}. avanzamento tra ${Math.round(PHASE_CUE_HOLD_MS / 1000)}s.`);
            sim.speakPhase(this.id);
            this._timer = setTimeout(() => {
                log('hold scaduto — avanzamento a PHASE 8.');
                sim.next();
            }, PHASE_CUE_HOLD_MS);
        },
        exit(sim) {
            log('uscita PHASE 7.');
            clearTimeout(this._timer);
        },
    },

    // ── PHASE 8 — CLOSING ─────────────────────────────────────────────────────
    // Last step — no next(). No narration; the sim speaks its phase number as a
    // binary cue over the closing.
    // The AANT logo replaces the HARMONY text as the avoid map: harmony images are
    // disabled first so a note change can't overwrite it, the text input is cleared,
    // then the static logo is loaded (it owns the avoid map and won't be cleared).
    {
        id: PHASE.P8,
        enter(sim) {
            log('PHASE 8 — chiusura. logo AANT come avoid map. cue binario 8. fine storia.');
            sim.disableHarmonyImages();
            sim.setTraceText('');
            sim.loadStaticAvoidMap('aant_logo.png');
            sim.speakPhase(this.id);
        },
        exit(sim) {},
    },
];
