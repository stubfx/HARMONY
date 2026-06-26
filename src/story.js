// ─── Story Steps ────────────────────────────────────────────────────────────
// Each object is one step. Order matters — the engine runs them in sequence.
// enter(sim)                → called when the step becomes active
// onSpectatorJoined(sim, n) → called each time a spectator connects
// Add new steps below to extend the story.

export const STORY = [
    {
        id: 'preshow',
        enter(sim) {
            sim.enterPreshow();
        },
        onSpectatorJoined(sim, userCount) {
            sim.preshowActivateChunk();
        },
    },
];
