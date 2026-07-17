// ─── Shared constants ────────────────────────────────────────────────────────

// Story phase IDs — must match the `id` fields in story.js.
// Phases are just numbered (1–8); the engine runs them in array order.
export const PHASE = Object.freeze({
    P1: 1,
    P2: 2,
    P3: 3,
    P4: 4,
    P5: 5,
    P6: 6,
    P7: 7,
    P8: 8,
    P9: 9,
});

// Reseed modes passed to sim.reseed() / seedAgents().
export const RESEED = Object.freeze({
    // Random interior positions, weight = full. Default behaviour.
    NORMAL:          'normal',
    // Perimeter spawn, weight = 0 → spawnFadeRate fades agents in from the edges.
    // Used at the end of PHASE.P1 so the transition is gradual, not a snap.
    FADE_FROM_EDGES: 'fadeFromEdges',
});
