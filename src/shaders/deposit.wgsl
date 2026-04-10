// ─── Trail Deposit Compute Shader ────────────────────────────────────────────
// One thread per agent. Atomically accumulates a gaussian pheromone splat into
// an integer buffer (accum). A separate normalize pass converts it to float.
//
// Struct layout (48 bytes):
//   [0]  agentCount      u32
//   [4]  trailWidth      u32
//   [8]  trailHeight     u32
//   [12] champInterval   u32   (every Nth agent is a champion; 0 = disabled)
//   [16] canvasW         f32
//   [20] canvasH         f32
//   [24] depositSize     f32   (splat radius in trail-texture pixels)
//   [28] depositStrength f32
//   [32] depositEdgeSoft f32   (0=hard 1=very soft gaussian edge)
//   [36] champMultiplier f32   (strength multiplier for champions)
//   [40] dt              f32
//   [44] _pad            u32

struct DepositParams {
    agentCount:      u32,
    trailWidth:      u32,
    trailHeight:     u32,
    champInterval:   u32,
    canvasW:         f32,
    canvasH:         f32,
    depositSize:     f32,
    depositStrength: f32,
    depositEdgeSoft: f32,
    champMultiplier: f32,
    dt:              f32,
    _pad:            u32,
}

struct Agent {
    pos: vec2<f32>,
    vel: vec2<f32>,
}

@group(0) @binding(0) var<uniform>             params: DepositParams;
@group(0) @binding(1) var<storage, read>       agents: array<Agent>;
@group(0) @binding(2) var<storage, read_write> accum:  array<atomic<i32>>;

// Fixed-point scale: 1024 → ~3 decimal digits of float precision.
// Overflow check: max deposit ≈ strength(20) * dt(0.05) * champ(5000) * scale(1024)
// = 20 * 0.05 * 5000 * 1024 = 5,120,000 << i32_max(2.1B). Safe.
const SCALE: f32 = 1024.0;

// Champion agents use 20× the radius (matching original gl_PointSize *= 20)
const CHAMP_RADIUS_MULT: f32 = 20.0;

// Hard cap on splat loop radius for performance.
// At radius 4 the inner loop is 9×9 = 81 iterations per agent.
const MAX_RADIUS: f32 = 4.0;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.agentCount) { return; }

    let agent = agents[i];

    // ── Convert world-space position → trail-texture pixel coordinates ────────
    let trailPos = agent.pos
        / vec2<f32>(params.canvasW, params.canvasH)
        * vec2<f32>(f32(params.trailWidth), f32(params.trailHeight));

    // ── Champion determination ────────────────────────────────────────────────
    let isChamp = (params.champInterval > 0u) && (i % params.champInterval == 0u);

    var radius   = params.depositSize;
    var strength = params.depositStrength * params.dt;
    if (isChamp) {
        radius   = min(radius * CHAMP_RADIUS_MULT, MAX_RADIUS * CHAMP_RADIUS_MULT);
        strength = strength * params.champMultiplier;
    }

    let clampedRadius = min(radius, MAX_RADIUS);
    let iRadius = i32(ceil(clampedRadius));
    let cx = i32(trailPos.x);
    let cy = i32(trailPos.y);
    let TW = i32(params.trailWidth);
    let TH = i32(params.trailHeight);

    // ── Gaussian splat ────────────────────────────────────────────────────────
    for (var dy = -iRadius; dy <= iRadius; dy++) {
        for (var dx = -iRadius; dx <= iRadius; dx++) {
            let d = length(vec2<f32>(f32(dx), f32(dy)));
            if (d > clampedRadius) { continue; }

            let soft = max(0.0, clampedRadius * (1.0 - params.depositEdgeSoft));
            let m    = smoothstep(clampedRadius, soft, d);
            if (m <= 0.0) { continue; }

            // Toroidal wrap for trail coordinates
            let tx  = ((cx + dx) % TW + TW) % TW;
            let ty  = ((cy + dy) % TH + TH) % TH;
            let idx = u32(ty * TW + tx);

            atomicAdd(&accum[idx], i32(m * strength * SCALE));
        }
    }
}
