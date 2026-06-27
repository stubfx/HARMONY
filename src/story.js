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

export const STORY = [
    {
        id: 'preshow',
        enter(sim) {
            sim.freezeParams({ spectatorSpawnChance: 0, randomTeleportChance: 0, dotRespawnChance: 0 });
            sim.suppressImages();
            sim.dormantSeed();
        },
        onSpectatorJoined(sim, userCount) {
            sim.activateChunk(0.10);
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
];
