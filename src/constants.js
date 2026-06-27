// ─── Shared constants ────────────────────────────────────────────────────────

// Story phase IDs — must match the `id` fields in story.js.
export const PHASE = Object.freeze({
    PRESHOW:           'preshow',
    NOTA:              'nota',
    ROSSO:             'rosso',
    IMMAGINI_CUORE:    'immagini-cuore',
    IMMAGINI_TEMPESTA: 'immagini-tempesta',
    IMMAGINI_BIGBANG:  'immagini-bigbang',
    TESTO:             'testo',
    CHIUSURA:          'chiusura',
});

// Reseed modes passed to sim.reseed() / seedAgents().
export const RESEED = Object.freeze({
    // Random interior positions, weight = full. Default behaviour.
    NORMAL:          'normal',
    // Perimeter spawn, weight = 0 → spawnFadeRate fades agents in from the edges.
    // Used at the end of PHASE.PRESHOW so the transition is gradual, not a snap.
    FADE_FROM_EDGES: 'fadeFromEdges',
});
