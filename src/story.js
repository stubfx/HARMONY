// ─── Narrator Audio Map ──────────────────────────────────────────────────────
// All files live in simAss/narrator/. Replace any file to swap the narration.
//
//   audio1.mp3  →  preshow         (FASE 2 — connessione, suona a fine fase)
//   audio2.mp3  →  nota            (FASE 3 — trovate la vostra nota)
//   audio3.mp3  →  rosso           (FASE 4 — date un colore alla nota)
//   audio4.mp3  →  immagini-cuore  (FASE 5a — "Il primo suono che hai sentito…")
//   audio5.mp3  →  immagini-tempesta (FASE 5b — "Il rombo prima del lampo…")
//   audio6.mp3  →  testo           (FASE 6 — una parola a testa)
//   audio7.mp3  →  chiusura        (FASE 7 — l'armonia non è la stessa nota)
//
// immagini-bigbang non ha audio (note di regia: "non si commenta").

// ─── Story Steps ────────────────────────────────────────────────────────────
// Each object is one step. Order matters — the engine runs them in sequence.
//
// Hooks available on each step:
//   enter(sim)                — called when the step becomes active
//   exit(sim)                 — called before moving to the next step
//   onSpectatorJoined(sim, n) — called each time a spectator connects
//
// sim primitives:
//   sim.dormantSeed()              — seed all agents invisible (weight=0)
//   sim.activateChunk(fraction)    — light up next N% of agents from center
//   sim.freezeParams(overrides)    — save + override named params
//   sim.thawParams()               — restore params saved by freezeParams
//   sim.reseed()                   — full normal reseed, exits dormant mode
//   sim.next()                     — advance to the next step
//   sim.setParam(key, val)         — override a single param
//   sim.suppressImages()           — block loadAvoidMap (images from admin)
//   sim.restoreImages()            — re-enable loadAvoidMap
//   sim.playNarratorAudio(file)    — play simAss/narrator/<file>; auto-next on ended

export const STORY = [

    // ── FASE 2 — CONNESSIONE ─────────────────────────────────────────────────
    // Users connect one by one; each one lights up a chunk of agents.
    // After 10s from the first connection, dotRespawnChance is re-enabled.
    {
        id: 'preshow',
        enter(sim) {
            sim.freezeParams({ spectatorSpawnChance: 0, randomTeleportChance: 0, dotRespawnChance: 0 });
            sim.suppressImages();
            sim.dormantSeed();
        },
        onSpectatorJoined(sim, userCount) {
            sim.activateChunk(1);
            if (userCount === 1) {
                setTimeout(() => sim.setParam('dotRespawnChance', 0.002), 10_000);
            }
        },
        exit(sim) {
            sim.restoreImages();
            sim.thawParams();
            sim.reseed();
        },
    },

    // ── FASE 3 — LA NOTA ─────────────────────────────────────────────────────
    // Narrator speaks; advances automatically when audio ends.
    // File: simAss/narrator/audio2.mp3
    {
        id: 'nota',
        enter(sim) {
            this._audio = sim.playNarratorAudio('audio2.mp3');
        },
        exit(sim) {
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── FASE 4 — IL ROSSO ────────────────────────────────────────────────────
    // Users assign a color (Y axis on remote → hue) to their note.
    // Advance manually via sim.next().
    {
        id: 'rosso',
        enter(sim) {},
        exit(sim)  {},
    },

    // ── FASE 5a — IMMAGINE: CUORE ────────────────────────────────────────────
    // TODO: implement image appearance logic (how the image fades/arrives on screen).
    // Shown for 10 seconds in total silence, then auto-advances.
    {
        id: 'immagini-cuore',
        enter(sim) {
            // TODO: load cuore image into avoidmap
            setTimeout(() => sim.next(), 10_000);
        },
        exit(sim) {},
    },

    // ── FASE 5b — IMMAGINE: TEMPESTA ─────────────────────────────────────────
    // TODO: implement image appearance logic.
    // Shown for 7 seconds, then auto-advances.
    {
        id: 'immagini-tempesta',
        enter(sim) {
            // TODO: load tempesta image into avoidmap
            setTimeout(() => sim.next(), 7_000);
        },
        exit(sim) {},
    },

    // ── FASE 5c — IMMAGINE: BIG BANG ─────────────────────────────────────────
    // TODO: implement image appearance logic.
    // Shown for 5 seconds, then cuts to black and auto-advances.
    {
        id: 'immagini-bigbang',
        enter(sim) {
            // TODO: load bigbang image into avoidmap
            setTimeout(() => sim.next(), 5_000);
        },
        exit(sim) {
            // TODO: cut to black before advancing
        },
    },

    // ── FASE 6 — IL TESTO ────────────────────────────────────────────────────
    // Users type one word each; the text forms on screen via avoidmap.
    // Advance manually via sim.next() when the text has formed.
    {
        id: 'testo',
        enter(sim) {},
        exit(sim)  {},
    },

    // ── FASE 7 — CHIUSURA ────────────────────────────────────────────────────
    // All notes play together; audio grows. Final monologue.
    // Last step — no next().
    {
        id: 'chiusura',
        enter(sim) {},
        exit(sim)  {},
    },
];
