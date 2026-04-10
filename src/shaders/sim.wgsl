// ─── Agent Simulation Compute Shader ─────────────────────────────────────────
// One thread per agent. Reads the pheromone trail (bilinear via sampler),
// steers toward higher density, applies drag + target-speed, integrates position
// with toroidal wrapping.
//
// Struct layout (64 bytes, stride 16):
//   [0] agentCount  u32
//   [4] trailWidth  u32
//   [8] trailHeight u32
//   [12] frameCount u32
//   [16] canvasW    f32
//   [20] canvasH    f32
//   [24] dt         f32
//   [28] time       f32
//   [32] stepLen    f32
//   [36] drag       f32
//   [40] turnJitter f32
//   [44] senseDist  f32
//   [48] senseAngle f32  (radians)
//   [52] turnRate   f32  (radians/sec)
//   [56] _pad0      u32
//   [60] _pad1      u32

struct SimParams {
    agentCount:  u32,
    trailWidth:  u32,
    trailHeight: u32,
    frameCount:  u32,
    canvasW:     f32,
    canvasH:     f32,
    dt:          f32,
    time:        f32,
    stepLen:     f32,
    drag:        f32,
    turnJitter:  f32,
    senseDist:   f32,
    senseAngle:  f32,
    turnRate:    f32,
    _pad0:       u32,
    _pad1:       u32,
}

struct Agent {
    pos: vec2<f32>,
    vel: vec2<f32>,
}

@group(0) @binding(0) var<uniform>             params:    SimParams;
@group(0) @binding(1) var<storage, read_write> agents:    array<Agent>;
@group(0) @binding(2) var                      trailSmp:  sampler;
@group(0) @binding(3) var                      trailTex:  texture_2d<f32>;

// ── PCG hash: high-quality, cheap per-agent randomness ────────────────────────
fn pcg(n: u32) -> u32 {
    var x = n * 747796405u + 2891336453u;
    x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
    return (x >> 22u) ^ x;
}
fn rng(seed: u32) -> f32 {
    return f32(pcg(seed)) / 4294967295.0;
}

// ── 2-D rotation ──────────────────────────────────────────────────────────────
fn rot2(v: vec2<f32>, a: f32) -> vec2<f32> {
    let c = cos(a); let s = sin(a);
    return vec2<f32>(c * v.x - s * v.y, s * v.x + c * v.y);
}

// ── Sample pheromone trail at a world-space position ─────────────────────────
// posWorld is in canvas-pixel space [0..W] × [0..H], Y increases down.
// Trail texture shares the same axis convention — no flip needed in WebGPU.
fn sampleTrail(posWorld: vec2<f32>) -> f32 {
    let uv = fract(posWorld / vec2<f32>(params.canvasW, params.canvasH));
    return textureSampleLevel(trailTex, trailSmp, uv, 0.0).r;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.agentCount) { return; }

    var agent = agents[i];
    var pos   = agent.pos;
    var vel   = agent.vel;

    let spd = length(vel);
    let dir = select(vec2<f32>(1.0, 0.0), vel / spd, spd > 1e-6);

    // ── Tri-sensor pheromone sampling ─────────────────────────────────────────
    let fwd   = sampleTrail(pos + params.senseDist * dir);
    let left  = sampleTrail(pos + params.senseDist * rot2(dir,  params.senseAngle));
    let right = sampleTrail(pos + params.senseDist * rot2(dir, -params.senseAngle));

    // ── Per-agent random noise (unique per agent AND frame) ───────────────────
    let seed  = pcg(i * 2654435761u ^ params.frameCount * 40503u);
    let noise = (rng(seed) * 2.0 - 1.0) * params.turnJitter;

    // ── Steering decision ─────────────────────────────────────────────────────
    var turnUnit: f32;
    if (fwd < left && fwd < right) {
        // lowest forward → wander
        turnUnit = noise;
    } else if (right > left) {
        turnUnit = -1.0 + noise;   // steer right
    } else if (left > right) {
        turnUnit = 1.0 + noise;    // steer left
    } else {
        turnUnit = noise;          // equal → random
    }
    turnUnit = clamp(turnUnit, -1.0, 1.0);

    // ── Rotate velocity ───────────────────────────────────────────────────────
    let dTheta = turnUnit * params.turnRate * params.dt;
    vel = rot2(vel, dTheta);

    // ── Exponential speed smoothing toward target ─────────────────────────────
    let drag    = exp(-params.drag * params.dt);
    let newSpd  = mix(params.stepLen, length(vel), drag);
    vel = select(dir * newSpd, normalize(vel) * newSpd, length(vel) > 1e-6);

    // ── Integrate + toroidal wrap ─────────────────────────────────────────────
    pos = pos + vel * params.dt;
    let canvas = vec2<f32>(params.canvasW, params.canvasH);
    pos = fract(pos / canvas) * canvas;

    agents[i] = Agent(pos, vel);
}
