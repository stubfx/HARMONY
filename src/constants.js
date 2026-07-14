// ─── Shared constants ────────────────────────────────────────────────────────

// Story phase IDs — must match the `id` fields in story.js.
// Two parallel arcs synced by the voice:
//   Big screen (collective): NERO → PUNTI CONFINATI → PUNTI LIBERI → CAMPO REATTIVO → HARMONY → CAMPO CAMBIATO
//   Phone (individual):      NERO → PUNTO → NOTA → COLORE → NERO
export const PHASE = Object.freeze({
    ENTER:   'enter',    // connessione — punti confinati al centro, vibrazione
    FREE:    'free',     // punti liberi — rimozione del constraint, distensione
    TUNE:    'tune',     // campo reattivo — le note fanno "respirare" il campo
    COLOR:   'color',    // scelta del colore (bufferizzato, non ancora sullo schermo)
    HARMONY: 'harmony',  // climax — spegnimento, riaccensione colorata, accordo, forme
    CLOSE:   'close',    // campo libero colorato, telefono nero → "puoi chiudere"
});

// Reseed modes passed to sim.reseed() / seedAgents().
export const RESEED = Object.freeze({
    // Random interior positions, weight = full. Default behaviour.
    NORMAL:          'normal',
    // Perimeter spawn, weight = 0 → spawnFadeRate fades agents in from the edges.
    // Used for gradual field entrances (avoids a hard snap to full).
    FADE_FROM_EDGES: 'fadeFromEdges',
});
