import { PHASE } from './constants.js';

const _P1_DIR  = 'atan2(cy - y, cx - x) + sin(t * 1.4 + length(vec2(x-cx,y-cy)) * 0.012) * PI * 0.38';
const _P1_WIND = 'atan2(cy - y, cx - x) + PI * 0.46 + sin(t * 0.65 + length(vec2(x-cx,y-cy)) * 0.007) * 0.6';

const _P3_P7 = {
    colorMode:'NORMAL', champLinesAlpha:0.02, limitAtCenter:false, limitAtCenterRadius:100,
    dotRespawnChance:0.002, windEnabled:true, harmonyImages:true, harmonyFallback:null,
    avoidMap:null, fullSynth:true, formulas:[_P1_DIR,_P1_WIND], music:true, blinkersLoop:true,
};

const PHASE_SNAPSHOTS = [
    // P1
    { colorMode:'GRAYSCALE', champLinesAlpha:0, limitAtCenter:true, limitAtCenterRadius:100,
      dotRespawnChance:0, windEnabled:false, harmonyImages:false, harmonyFallback:null,
      avoidMap:null, fullSynth:false, formulas:null, music:false, blinkersLoop:false },
    // P2
    { colorMode:'GRAYSCALE', champLinesAlpha:0, limitAtCenter:false, limitAtCenterRadius:100,
      dotRespawnChance:0, windEnabled:false, harmonyImages:false, harmonyFallback:null,
      avoidMap:'circle.png', fullSynth:true, formulas:[_P1_DIR,_P1_WIND], music:true, blinkersLoop:true },
    // P3
    _P3_P7,
    // P4
    _P3_P7,
    // P5
    _P3_P7,
    // P6
    _P3_P7,
    // P7
    _P3_P7,
    // P8
    { colorMode:'NORMAL', champLinesAlpha:0.02, limitAtCenter:false, limitAtCenterRadius:100,
      dotRespawnChance:0.002, windEnabled:true, harmonyImages:true, harmonyFallback:'aant_logo.png',
      avoidMap:'aant_logo.png', fullSynth:true, formulas:[_P1_DIR,_P1_WIND], music:true, blinkersLoop:true },
    // P9
    { colorMode:'NORMAL', champLinesAlpha:0.02, limitAtCenter:false, limitAtCenterRadius:100,
      dotRespawnChance:0.002, windEnabled:true, harmonyImages:true, harmonyFallback:'aant_logo.png',
      avoidMap:'aant_logo.png', fullSynth:true, formulas:[_P1_DIR,_P1_WIND], music:true, blinkersLoop:true },
    // SHOWCASE
    { colorMode:'NORMAL', champLinesAlpha:0.02, limitAtCenter:false, limitAtCenterRadius:100,
      dotRespawnChance:0.002, windEnabled:true, harmonyImages:true, harmonyFallback:'aant_logo.png',
      avoidMap:'aant_logo.png', fullSynth:true, formulas:[_P1_DIR,_P1_WIND], music:true, blinkersLoop:true },
];

export function applyPhaseSnapshot(sim, idx) {
    const s = PHASE_SNAPSHOTS[idx];
    if (!s) return;
    sim.setColorMode(s.colorMode);
    sim.setParam('champLinesAlpha', s.champLinesAlpha);
    sim.setParam('limitAtCenter', s.limitAtCenter);
    if (s.limitAtCenterRadius !== undefined) sim.setParam('limitAtCenterRadius', s.limitAtCenterRadius);
    sim.setParam('dotRespawnChance', s.dotRespawnChance);
    sim.setParam('windEnabled', s.windEnabled);
    if (s.harmonyImages) sim.enableHarmonyImages(); else sim.disableHarmonyImages();
    if (s.harmonyFallback) sim.setHarmonyFallback(s.harmonyFallback); else sim.clearHarmonyFallback();
    if (s.avoidMap) sim.loadStaticAvoidMap(s.avoidMap); else sim.clearAvoidMap();
    if (s.fullSynth) sim.enableFullSynth();
    if (s.formulas) sim.setFormulas(s.formulas[0], s.formulas[1]);
    if (s.music) sim.startBackgroundMusic();
    if (s.blinkersLoop) sim.startBlinkersLoop();
}

// ─── Phase audio ─────────────────────────────────────────────────────────────
// No phase uses recorded narration any more. Every phase announces itself by
// having the simulation "speak" its own phase number as a short binary tone
// sequence (sim.speakPhase(this.id)) at the point its narration used to start.
// PHASE 6 stays silent (director's note: "no commentary needed").

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
//   sim.setTraceText(text)         — set the trace text input and re-render the avoidmap

const log = (msg) => console.log(`[story] ${msg}`);

// PHASE 3 riser build-up length (ms). The generative drop's impact and the red
// colour reveal both fire when this timer elapses, so they land perfectly synced.
const RISER_MS = 4000;

// Total play window for PHASE 3 (ms). Harmony + colors are shown for this long
// so users can play out before the drop advances the story. The riser fires at
// PHASE3_PLAY_MS − RISER_MS so the drop lands exactly at the 2-minute mark.
const PHASE3_PLAY_MS = 120_000;

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
        label: 'CONNECTION',
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
            // If spectators are already connected when P1 enters (e.g. show restart),
            // onSpectatorJoined(userCount=1) will never fire — start the timer now.
            if (sim.getUserCount() > 0) {
                sim.startBlinkersLoop();
                log('utenti già connessi al restart — hold 40s avviato immediatamente.');
                this._timer = setTimeout(() => {
                    log('hold 40s scaduto — accensione completa + avanzamento a PHASE 2.');
                    sim.activateChunk(1);
                    sim.next();
                }, 40_000);
            }
        },
        onSpectatorJoined(sim, userCount) {
            log('utente connesso — totale: ' + userCount);
            // Each user lights up 5% of the field. At the 20th user the field is
            // full (20 × 5% = 100%), so from there activate everything that remains.
            if (userCount >= 20) sim.activateChunk(1);
            else                 sim.activateChunk(0.05);
            if (userCount === 1) {
                // Start both ambient blinkers and user blip events immediately so
                // the room feels alive during the 40 s hold before the story moves.
                sim.startBlinkersLoop();
                log('primo utente — blip avviati. hold 40s → PHASE 2.');
                this._timer = setTimeout(() => {
                    log('hold 40s scaduto — accensione completa + avanzamento a PHASE 2.');
                    // Countdown over: light up any agents not yet activated.
                    sim.activateChunk(1);
                    sim.next();
                }, 40_000);
            }
        },
        exit(sim) {
            log('uscita PHASE 1 — formule aggiornate, respawn random già attivo.');
            clearTimeout(this._timer);
            sim.restoreImages();
            sim.thawParams();
            sim.setFormulas(_P1_DIR, _P1_WIND);
        },
    },

    // ── PHASE 2 — THE NOTE ────────────────────────────────────────────────────
    // Enters immediately from PHASE 1. Waits 10s, then binary cue 2.
    // Notes are ignored until PHASE_CUE_HOLD_MS after the cue (prevents notes sent
    // during the intro from triggering the timer early).
    // First note after that → wind on → 20s timer → sim.next().
    {
        id: PHASE.P2,
        label: 'THE NOTE',
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
                    // Fallback: if no chirp/note arrives within 30s, advance anyway.
                    // Ensures the show is never blocked by a silent crowd.
                    this._fallbackTimer = setTimeout(() => {
                        if (!this._noteTimerStarted) {
                            this._noteTimerStarted = true;
                            log('30s senza note — avanzamento automatico a PHASE 3.');
                            sim.setParam('windEnabled', true);
                            setTimeout(() => sim.next(), 20_000);
                        }
                    }, 30_000);
                }, PHASE_CUE_HOLD_MS);
            }, 10_000);
        },
        onNote(sim, noteIndex) {
            if (!this._notesEnabled || this._noteTimerStarted) return;
            this._noteTimerStarted = true;
            clearTimeout(this._fallbackTimer);
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
            clearTimeout(this._fallbackTimer);
            sim.thawParams();
        },
    },

    // ── PHASE 3 ───────────────────────────────────────────────────────────────
    // Colors revealed + HARMONY text immediately → 10s → harmony images + binary
    // cue 3. Users play freely for the rest of the PHASE3_PLAY_MS window (1 min
    // from enter). Riser fires at minute − RISER_MS so the drop lands exactly at
    // 60 s → red reveal + PHASE 4.
    {
        id: PHASE.P3,
        label: 'HARMONY',
        enter(sim) {
            sim.setColorMode('NORMAL');
            sim.setParam('champLinesAlpha', 0.02);
            const textDelay = 7000 + Math.random() * 3000;
            this._textTimer = setTimeout(() => sim.setTraceText('HARMONY'), textDelay);
            log(`PHASE 3. testo HARMONY tra ${Math.round(textDelay / 1000)}s. immagini e cue tra 10s. riser tra ${Math.round((PHASE3_PLAY_MS - RISER_MS) / 1000)}s. drop a ${Math.round(PHASE3_PLAY_MS / 1000)}s.`);
            // At 10 s: open harmony images and speak cue 3
            this._cueTimer = setTimeout(() => {
                log('10s scaduti — immagini harmony abilitate. dotRespawnChance abilitato (0.002). cue binario 3.');
                sim.enableHarmonyImages();
                sim.setParam('dotRespawnChance', 0.002);
                sim.speakPhase(this.id);
            }, 10_000);
            // At 60 s − RISER_MS: start the riser
            this._riserTimer = setTimeout(() => {
                log(`riser ${Math.round(RISER_MS / 1000)}s avviato.`);
                sim.playRiser(RISER_MS);
            }, PHASE3_PLAY_MS - RISER_MS);
            // At 60 s: drop → red reveal → PHASE 4
            this._dropTimer = setTimeout(() => {
                log('drop — impact + color1=#ff0000 color2=#ff0000. avanzamento a PHASE 4.');
                sim.triggerImpact();
                sim.freezeParams({ color1: '#ff0000', color2: '#ff0000' });
                sim.next();
            }, PHASE3_PLAY_MS);
        },
        exit(sim) {
            log('uscita PHASE 3.');
            clearTimeout(this._textTimer);
            clearTimeout(this._cueTimer);
            clearTimeout(this._riserTimer);
            clearTimeout(this._dropTimer);
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
        label: 'HEART',
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
        label: 'STORM',
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
        label: 'BIG BANG',
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
        label: 'TEXT',
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
    // AANT logo shown as default avoidmap; harmony images stay enabled so note
    // combinations can pop images over the logo. When an image exits, the fallback
    // restores aant_logo automatically (via _exitHarmony → setHarmonyFallback).
    // Binary cue 8, then PHASE_CUE_HOLD_MS hold → PHASE 9 (ambient finale).
    {
        id: PHASE.P8,
        label: 'CLOSING',
        enter(sim) {
            log('PHASE 8 — chiusura. logo AANT + immagini harmony abilitate. cue binario 8. → PHASE 9 tra 5s.');
            sim.setTraceText('');
            sim.enableHarmonyImages();
            sim.setHarmonyFallback('aant_logo.png');
            sim.loadStaticAvoidMap('aant_logo.png');
            sim.speakPhase(this.id);
            this._timer = setTimeout(() => {
                log('hold PHASE 8 scaduto — avanzamento a PHASE 9.');
                sim.next();
            }, PHASE_CUE_HOLD_MS);
        },
        exit(sim) {
            log('uscita PHASE 8.');
            clearTimeout(this._timer);
            // Fallback stays active into PHASE 9 — cleared only when PHASE 9 exits (restart).
        },
    },

    // ── PHASE 9 — AMBIENT FINALE ──────────────────────────────────────────────
    // True final step — no next(). Inherits harmony images + aant_logo fallback
    // from PHASE 8. A random riser plays every ~40 s (36–44 s jitter), each time
    // picking a random variant. When a harmony combination is hit, _enterHarmony
    // plays its own riser and calls back here to reset the P9 timer so they never
    // fire simultaneously.
    {
        id: PHASE.P9,
        label: 'AMBIENT FINALE',
        enter(sim) {
            log('PHASE 9 — finale ambientale. riser ogni ~40s. nessun avanzamento.');
            sim.setHarmonyRiserResetCallback(() => this._rescheduleRiser(sim));
            this._scheduleRiser(sim);
        },
        _scheduleRiser(sim) {
            const ms = 36_000 + Math.random() * 8_000;  // 36–44 s
            this._riserTimer = setTimeout(() => {
                const dur = 3500 + Math.random() * 1500; // 3.5–5 s
                log(`PHASE 9 — freeroam + riser variante casuale (${(dur / 1000).toFixed(1)}s).`);
                sim.setStatus('FREEROAM');
                sim.playRiser(dur);
                this._restoreTimer = setTimeout(() => {
                    sim.setStatus('NORMAL');
                    sim.resolveRiser();
                    log('PHASE 9 — riser terminato, ritorno a NORMAL.');
                }, dur);
                this._scheduleRiser(sim);
            }, ms);
        },
        // Called by the harmony reset callback — clears the pending timer and
        // starts a fresh 36–44 s countdown so the next P9 riser doesn't overlap
        // with the harmony riser that just fired.
        _rescheduleRiser(sim) {
            clearTimeout(this._riserTimer);
            this._scheduleRiser(sim);
        },
        exit(sim) {
            log('uscita PHASE 9 (restart).');
            clearTimeout(this._riserTimer);
            clearTimeout(this._restoreTimer);
            sim.setStatus('NORMAL');
            sim.setHarmonyRiserResetCallback(null);
            sim.clearHarmonyFallback();
        },
    },

    // ── SHOWCASE — ambient exhibition loop ────────────────────────────────────
    // Self-contained clone of PHASE 9: sets up all state in enter() so it can
    // be jumped to directly from the admin at any time without relying on P8.
    // No next() — runs indefinitely until the operator navigates away.
    {
        id: PHASE.SHOWCASE,
        label: 'SHOWCASE',
        enter(sim) {
            log('SHOWCASE — modalità esposizione. impostazione stato completo. riser ogni ~40s.');
            sim.setColorMode('NORMAL');
            sim.setParam('champLinesAlpha', 0.02);
            sim.setParam('limitAtCenter', false);
            sim.setParam('dotRespawnChance', 0.002);
            sim.setParam('windEnabled', true);
            sim.enableFullSynth();
            sim.setFormulas(_P1_DIR, _P1_WIND);
            sim.enableHarmonyImages();
            sim.setHarmonyFallback('aant_logo.png');
            sim.loadStaticAvoidMap('aant_logo.png');
            sim.startBackgroundMusic();
            sim.startBlinkersLoop();
            sim.setHarmonyRiserResetCallback(() => this._rescheduleRiser(sim));
            this._scheduleRiser(sim);
        },
        _scheduleRiser(sim) {
            const ms = 36_000 + Math.random() * 8_000;
            this._riserTimer = setTimeout(() => {
                const dur = 3500 + Math.random() * 1500;
                log(`SHOWCASE — freeroam + riser (${(dur / 1000).toFixed(1)}s).`);
                sim.setStatus('FREEROAM');
                sim.playRiser(dur);
                this._restoreTimer = setTimeout(() => {
                    sim.setStatus('NORMAL');
                    sim.resolveRiser();
                    log('SHOWCASE — riser terminato, ritorno a NORMAL.');
                }, dur);
                this._scheduleRiser(sim);
            }, ms);
        },
        _rescheduleRiser(sim) {
            clearTimeout(this._riserTimer);
            this._scheduleRiser(sim);
        },
        exit(sim) {
            log('uscita SHOWCASE.');
            clearTimeout(this._riserTimer);
            clearTimeout(this._restoreTimer);
            sim.setStatus('NORMAL');
            sim.setHarmonyRiserResetCallback(null);
            sim.clearHarmonyFallback();
        },
    },
];
