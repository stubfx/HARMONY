import { PHASE, RESEED } from './constants.js';

// ─── Narrator Audio Map ──────────────────────────────────────────────────────
// All files live in simAss/narrator/. Replace any file to swap the narration.
//
//   audio1.mp3    →  preshow           (FASE 2 — connessione, suona a fine fase)
//   audio2.mp3    →  nota              (FASE 3 — parte subito all'entrata dello step)
//   audio3_1.mp3  →  nota              (FASE 3 — parte 20s dopo la prima nota suonata)
//   audio3.mp3    →  rosso             (FASE 4 — date un colore alla nota)
//   audio4.mp3    →  immagini-cuore    (FASE 5a — "Il primo suono che hai sentito...")
//   audio5.mp3    →  immagini-tempesta (FASE 5b — "Il rombo prima del lampo...")
//   audio6.mp3    →  testo             (FASE 6 — una parola a testa)
//   audio7.mp3    →  chiusura          (FASE 7 — l'armonia non e' la stessa nota)
//
// immagini-bigbang non ha audio (note di regia: "non si commenta").

// ─── Nota sui parametri hardcodati ───────────────────────────────────────────
// Tutti i timer, le soglie e i nomi dei file sono volutamente hardcodati in
// questo file. E' intenzionale: ogni fase ha tempi precisi scelti in fase di
// regia, e avere tutto qui rende facile modificare qualsiasi dettaglio senza
// cercare tra i parametri del sim.

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
//   sim.reseed({ mode })             — full reseed; mode: RESEED.FADE_FROM_EDGES → perimeter spawn at weight=0
//   sim.next()                     — advance to the next step
//   sim.setParam(key, val)         — override a single param
//   sim.suppressImages()           — block loadAvoidMap (images from admin)
//   sim.restoreImages()            — re-enable loadAvoidMap
//   sim.playNarratorAudio(file)    — play simAss/narrator/<file>; auto-next on ended

export const STORY = [

    // ── FASE 2 — CONNESSIONE ─────────────────────────────────────────────────
    // audio1 starts immediately on enter (no users needed).
    // Users connect while the audio plays; each one lights up a chunk of agents.
    // After 10s from the first connection, dotRespawnChance is re-enabled.
    // Step advances when audio1 ends AND at least 1 user is connected.
    // If audio ends before anyone connects, it waits for the first join.
    {
        id: PHASE.PRESHOW,
        _MIN_USERS: 1,
        enter(sim) {
            this._userCount  = 0;
            this._audioEnded = false;
            sim.freezeParams({ spectatorSpawnChance: 0, randomTeleportChance: 0, dotRespawnChance: 0, spawnFadeRate: 0 });
            sim.suppressImages();
            sim.dormantSeed();
            this._audio = sim.playNarratorAudio('audio1.mp3');
            this._audio.addEventListener('ended', () => {
                this._audioEnded = true;
                if (this._userCount >= this._MIN_USERS) sim.next();
            }, { once: true });
        },
        onSpectatorJoined(sim, userCount) {
            this._userCount = userCount;
            sim.activateChunk(1);
            if (userCount === 1) {
                setTimeout(() => sim.setParam('dotRespawnChance', 0.002), 10_000);
            }
            if (this._audioEnded && userCount >= this._MIN_USERS) sim.next();
        },
        exit(sim) {
            this._audio?.pause();
            this._audio = null;
            sim.restoreImages();
            sim.thawParams();
            sim.reseed({ mode: RESEED.FADE_FROM_EDGES });
        },
    },

    // ── FASE 3 — LA NOTA ─────────────────────────────────────────────────────
    // audio2 parte subito all'entrata.
    // Al primo onNote → timer 20s → audio3_1 → timer 10s → sim.next().
    // Il timer da 20s parte una sola volta (prima nota ricevuta).
    {
        id: PHASE.NOTA,
        _noteTimerStarted: false,
        enter(sim) {
            this._noteTimerStarted = false;
            this._audio = sim.playNarratorAudio('audio2.mp3');
        },
        onNote(sim) {
            if (this._noteTimerStarted) return;
            this._noteTimerStarted = true;
            setTimeout(() => {
                this._audio?.pause();
                this._audio = sim.playNarratorAudio('audio3_1.mp3');
                this._audio.addEventListener('ended', () => {
                    setTimeout(() => sim.next(), 10_000);
                }, { once: true });
            }, 20_000);
        },
        exit(sim) {
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── FASE 4 — IL ROSSO ────────────────────────────────────────────────────
    // Narrator speaks; advances automatically when audio ends.
    // File: simAss/narrator/audio3.mp3
    {
        id: PHASE.ROSSO,
        enter(sim) {
            this._audio = sim.playNarratorAudio('audio3.mp3', { autoNext: true });
        },
        exit(sim) {
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── FASE 5a — IMMAGINE: CUORE ────────────────────────────────────────────
    // TODO: implement image appearance logic (how the image fades/arrives on screen).
    // Narrator speaks after silence; advances when audio ends.
    // File: simAss/narrator/audio4.mp3
    {
        id: PHASE.IMMAGINI_CUORE,
        enter(sim) {
            // TODO: load cuore image into avoidmap
            this._audio = sim.playNarratorAudio('audio4.mp3', { autoNext: true });
        },
        exit(sim) {
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── FASE 5b — IMMAGINE: TEMPESTA ─────────────────────────────────────────
    // TODO: implement image appearance logic.
    // Narrator speaks; advances when audio ends.
    // File: simAss/narrator/audio5.mp3
    {
        id: PHASE.IMMAGINI_TEMPESTA,
        enter(sim) {
            // TODO: load tempesta image into avoidmap
            this._audio = sim.playNarratorAudio('audio5.mp3', { autoNext: true });
        },
        exit(sim) {
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── FASE 5c — IMMAGINE: BIG BANG ─────────────────────────────────────────
    // TODO: implement image appearance logic.
    // No narration (script note: "non si commenta").
    // Shown for 5 seconds, then cuts to black and auto-advances.
    {
        id: PHASE.IMMAGINI_BIGBANG,
        enter(sim) {
            // TODO: load bigbang image into avoidmap
            this._timer = setTimeout(() => sim.next(), 5_000);
        },
        exit(sim) {
            clearTimeout(this._timer);
            // TODO: cut to black before advancing
        },
    },

    // ── FASE 6 — IL TESTO ────────────────────────────────────────────────────
    // Narrator speaks; advances automatically when audio ends.
    // File: simAss/narrator/audio6.mp3
    {
        id: PHASE.TESTO,
        enter(sim) {
            this._audio = sim.playNarratorAudio('audio6.mp3', { autoNext: true });
        },
        exit(sim) {
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── FASE 7 — CHIUSURA ────────────────────────────────────────────────────
    // Narrator speaks. Last step — no next().
    // File: simAss/narrator/audio7.mp3
    {
        id: PHASE.CHIUSURA,
        enter(sim) {
            this._audio = sim.playNarratorAudio('audio7.mp3');
        },
        exit(sim) {
            this._audio?.pause();
            this._audio = null;
        },
    },
];
