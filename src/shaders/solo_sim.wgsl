// ─── Formula-Driven Particle Compute Shader ───────────────────────────────────
// Two WGSL functions are prepended at compile-time by solo.js:
//   evalDirFormula  — desired heading angle for each particle (radians)
//   evalWindFormula — wind force direction (radians)
//
// Variables usable in both formulas:
//   x, y    — canvas-pixel position of the particle
//   t       — elapsed time in seconds
//   idx     — particle index as f32
//   cx, cy  — canvas centre (canvasW*0.5, canvasH*0.5)
//   PI, TWO_PI
//   Full WGSL built-in set: sin, cos, atan2, sqrt, fract, length, mix, …
//
// SoloParams layout (48 bytes):
//   [0]  agentCount u32
//   [4]  canvasW    f32
//   [8]  canvasH    f32
//   [12] stepLen    f32   (base speed, px per nominal 60-fps frame)
//   [16] dt         f32
//   [20] time       f32
//   [24] windStr    f32   (wind force magnitude per nominal frame)
//   [28] turnRate   f32   (lerp factor toward desired dir, 0..1 per frame)
//   [32] maxSpeed   f32
//   [36] minSpeed   f32
//   [40] _pad0      u32
//   [44] _pad1      u32

struct SoloParams {
    agentCount: u32,
    canvasW:    f32,
    canvasH:    f32,
    stepLen:    f32,
    dt:         f32,
    time:       f32,
    windStr:    f32,
    turnRate:   f32,
    maxSpeed:   f32,
    minSpeed:   f32,
    _pad0:      u32,
    _pad1:      u32,
}

// [pos.xy, vel.xy] — 16 bytes
struct Agent {
    pos: vec2<f32>,
    vel: vec2<f32>,
}

@group(0) @binding(0) var<uniform>             params: SoloParams;
@group(0) @binding(1) var<storage, read_write> agents: array<Agent>;

const PI:     f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.agentCount) { return; }

    var pos = agents[i].pos;
    var vel = agents[i].vel;

    let x   = pos.x;
    let y   = pos.y;
    let t   = params.time;
    let idx = f32(i);
    let cx  = params.canvasW * 0.5;
    let cy  = params.canvasH * 0.5;

    // ── Direction: desired heading from user formula ───────────────────────────
    let dirAngle = evalDirFormula(x, y, t, idx, cx, cy);
    let desired  = vec2<f32>(cos(dirAngle), sin(dirAngle));

    // ── Wind: external force field from user formula ──────────────────────────
    let windAngle = evalWindFormula(x, y, t, idx, cx, cy);
    let wind      = vec2<f32>(cos(windAngle), sin(windAngle)) * params.windStr;

    // ── Velocity update ───────────────────────────────────────────────────────
    // Lerp toward desired direction at base speed, then superimpose wind
    vel  = mix(vel, desired * params.stepLen, params.turnRate);
    vel += wind * params.dt * 60.0;

    // Speed bounds
    let spd = length(vel);
    if (spd > params.maxSpeed)                     { vel = vel * (params.maxSpeed / spd); }
    if (spd < params.minSpeed && spd > 0.00001)    { vel = vel * (params.minSpeed / spd); }

    // ── Position update with toroidal wrap ────────────────────────────────────
    var np = pos + vel * params.dt * 60.0;
    np.x = ((np.x % params.canvasW) + params.canvasW) % params.canvasW;
    np.y = ((np.y % params.canvasH) + params.canvasH) % params.canvasH;

    agents[i].pos = np;
    agents[i].vel = vel;
}
