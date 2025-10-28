import {baseParams} from '/tunables.js';
// feelings: { arousal, valence, dominance, cohesion, novelty, focus, tension } ∈ [0,1]
// base: baseParam (unchanged)
export function mapFeelings(feelings) {
    const base = baseParams;
    const f = feelings;
    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    const lerp  = (a, b, t) => a + (b - a) * t;

    // quick composites that match your narrative
    const chaos   = clamp(0.55*f.tension + 0.35*f.novelty + 0.10*(1-f.focus), 0, 1); // “angry but composed” rises with tension but is tamed by focus
    const calm    = clamp((1 - f.arousal)*0.6 + f.focus*0.4, 0, 1);                  // relaxed state
    const compose = clamp(0.6*f.focus + 0.4*f.cohesion, 0, 1);                        // “composed anger” lens

    // --- Simulation -----------------------------------------------------------
    // Faster for anger (arousal+tension). Harder to fetch (ok for “angry”).
    const STEP_LEN = clamp(
        base.STEP_LEN * lerp(0.75, 1.75, 0.65*f.arousal + 0.35*f.tension + 0.6*f.valence),
        0, 200
    );

    // Relaxation tool: higher DRAG when calm; dominance eases it slightly.
    const DRAG = clamp(
        base.DRAG *
            lerp(0.80, 1.30, calm) *
            lerp(1.05, 0.95, f.dominance),
        0, 5
    );

    // “Golden” knob: chaotic-but-controlled lines
    // up with anger (tension) & novelty; down with focus/cohesion to keep it composed.
    const TURN_JITTER = clamp(
        base.TURN_JITTER * lerp(0.70, 2.10, 0.55*f.tension + 0.30*f.novelty + 0.15*(1 - compose)),
        0.05, 2
    );

    // Higher = smoother lines → use cohesion/focus; small lift with dominance.
    const SENSE_DIST = clamp(
        base.SENSE_DIST *
            lerp(0.85, 1.55,0.6*f.arousal + 0.55*f.cohesion + 0.35*f.focus + 0.10*f.dominance),
        1, 200
    );

    // Wider angle builds spiky/grid structures → push with tension/novelty;
    // composure narrows it.
    const SENSE_ANGLE = clamp(
        base.SENSE_ANGLE *
            lerp(0.75, 1.40, 0.60*f.tension + 0.40*f.novelty) *
            lerp(1.20, 0.70, compose),
        0, 1
    );

    // Dreamy on-the-spot turning; can blur when paired with anger.
    // Up with focus (dreamy) and a touch with arousal; capped by extreme chaos.
    const TURN_RATE = clamp(
        base.TURN_RATE *
            lerp(0.80, 1.80, 0.60*f.focus + 0.40*f.arousal) *
            lerp(1.00, 0.90, chaos), // don’t over-spin when already chaotic
        0, 100
    );

    // --- Trail Deposit --------------------------------------------------------
    // Strength: “less particles moving around” → pin them more when composed/calm.
    // Reduce during hot chaotic states to keep motion alive.
    const DEPOSIT_STRENGTH = clamp(
        base.DEPOSIT_STRENGTH *
            lerp(0.60, 1.70, 0.50*compose + 0.30*calm + 0.20*f.valence) *
            lerp(1.10, 0.90, chaos),
        0, 20
    );

    // Size: supports the above; slightly larger with arousal (bolder marks),
    // but trimmed by high chaos to avoid blobs.
    const DEPOSIT_SIZE = clamp(
        base.DEPOSIT_SIZE *
            lerp(0.85, 1.60, 0.60*f.arousal + 0.40*f.dominance) *
            lerp(1.00, 0.90, chaos),
        0.5, 40
    );

    // Edge softness: calm → smoother transitions; tension → crisper/spikier.
    const DEPOSIT_EDGE_SOFT = clamp(
        base.DEPOSIT_EDGE_SOFT *
            lerp(0.70, 1.20, calm) *        // calm ↑ softness
            lerp(1.10, 0.90, f.tension),    // tension ↓ softness
        0, 1
    );

    // Champs: higher interval = fewer champs (more dots when chaos & twirls)
    const CHAMP_SAMPLE_INTERVAL = Math.max(
        1,
        Math.round(
            clamp(
                base.CHAMP_SAMPLE_INTERVAL *
                    lerp(0.70, 1.40, 0.55*chaos + 0.30*f.arousal + 0.15*f.tension) * // more chaos ⇒ fewer champs
                    lerp(1.20, 0.80, compose),                                        // composure ⇒ allow more champs
                1, 1_000_000
            )
        )
    );

    // Grid following the champs: dominance+cohesion+focus ↑; chaos ↓.
    const CHAMP_IMP_MULTIPLIER = clamp(
        base.CHAMP_IMP_MULTIPLIER *
            lerp(0.70, 2.10, 0.45*f.dominance + 0.30*f.cohesion + 0.25*f.focus) *
            lerp(1.10, 0.85, chaos),
        1, 5000
    );

    // --- Trail Decay ----------------------------------------------------------
    // Lower decay = stronger following of champs, but too low + angry ⇒ entropy.
    // So: decrease with composure (to follow champs), increase with anger/chaos,
    // add a cleanliness bias from valence.
    const TRAIL_DECAY = clamp(
        base.TRAIL_DECAY +
            (-0.020 * compose) +          // more composed ⇒ lower decay (follow champs)
            (+0.018 * chaos) +            // angry/chaotic ⇒ raise decay to avoid muddy entropy
            (+0.010 * f.valence),
        0, 1
    );

    return {
        STEP_LEN,
        DRAG,
        TURN_JITTER,
        SENSE_DIST,
        SENSE_ANGLE,
        TURN_RATE,
        DEPOSIT_SIZE,
        DEPOSIT_STRENGTH,
        DEPOSIT_EDGE_SOFT,
        CHAMP_SAMPLE_INTERVAL,
        CHAMP_IMP_MULTIPLIER,
        TRAIL_DECAY
    };
}

