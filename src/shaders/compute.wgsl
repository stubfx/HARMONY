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
// SoloParams layout (80 bytes):
//   [0]  agentCount    u32
//   [4]  canvasW       f32
//   [8]  canvasH       f32
//   [12] stepLen       f32   (base speed, px per nominal 60-fps frame)
//   [16] dt            f32
//   [20] time          f32
//   [24] windStr       f32   (wind force magnitude per nominal frame)
//   [28] turnRate      f32   (lerp factor toward desired dir, 0..1 per frame)
//   [32] maxSpeed      f32
//   [36] minSpeed      f32
//   [40] hasImage      u32   (1 when a magnet image is bound)
//   [44] magnetStr     f32   (image gradient force multiplier)
//   [48] imgX0         f32   (left edge of image region, canvas px)
//   [52] imgY0         f32   (top edge)
//   [56] imgX1         f32   (right edge)
//   [60] imgY1         f32   (bottom edge)
//   [64] followFormula u32   (1 = steer toward direction formula; 0 = free drift)
//   [68..79] padding

struct SoloParams {
    agentCount:    u32,
    canvasW:       f32,
    canvasH:       f32,
    stepLen:       f32,
    dt:            f32,
    time:          f32,
    windStr:       f32,
    turnRate:      f32,
    maxSpeed:      f32,
    minSpeed:      f32,
    hasImage:      u32,
    magnetStr:     f32,
    imgX0:         f32,
    imgY0:         f32,
    imgX1:         f32,
    imgY1:         f32,
    followFormula: u32,
    _pad0:         u32,
    _pad1:         u32,
    _pad2:         u32,
}

// [pos.xy, vel.xy, home.xy, weight, _pad] — 32 bytes
// home is assigned once at seed time (grid cell centre) and never mutated by GPU.
// weight scales each particle's desired speed.
struct Agent {
    pos:    vec2<f32>,
    vel:    vec2<f32>,
    home:   vec2<f32>,
    weight: f32,
    _pad:   f32,
}

@group(0) @binding(0) var<uniform>             params:   SoloParams;
@group(0) @binding(1) var<storage, read_write> agents:   array<Agent>;

const PI:     f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.agentCount) { return; }

    var pos    = agents[i].pos;
    var vel    = agents[i].vel;
    let home   = agents[i].home;
    let weight = agents[i].weight;

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

    // ── Image: home-based attraction / repulsion ──────────────────────────────
    // homeInImg: this agent's assigned home pixel falls inside the image region
    // posInImg:  this agent is currently drifting through the image region
    var homeInImg = false;
    var posInImg  = false;
    if (params.hasImage != 0u) {
        homeInImg = home.x >= params.imgX0 && home.x <= params.imgX1 &&
                    home.y >= params.imgY0 && home.y <= params.imgY1;
        posInImg  = pos.x  >= params.imgX0 && pos.x  <= params.imgX1 &&
                    pos.y  >= params.imgY0 && pos.y  <= params.imgY1;
    }

    if (homeInImg) {
        // This agent belongs in the image: override all other forces and
        // return to home at max speed. Stop when close enough.
        let toHome = home - pos;
        let dist   = length(toHome);
        if (dist > 0.5) {
            vel = normalize(toHome) * params.maxSpeed;
        } else {
            vel = vec2<f32>(0.0, 0.0);
        }
    } else {
        // Normal physics: direction formula + wind
        if (params.followFormula != 0u) {
            vel = mix(vel, desired * (params.stepLen * weight), params.turnRate);
        }
        vel += wind * params.dt * 60.0;

        // Repulsion: agent is passing through an image region it doesn't belong
        // to — steer it away from the image centre.
        if (posInImg) {
            let imgCx = (params.imgX0 + params.imgX1) * 0.5;
            let imgCy = (params.imgY0 + params.imgY1) * 0.5;
            let away  = normalize(pos - vec2<f32>(imgCx, imgCy));
            vel += away * params.magnetStr * params.dt * 60.0 * 5.0;
        }
    }

    // Speed bounds
    let spd = length(vel);
    if (spd > params.maxSpeed)                  { vel = vel * (params.maxSpeed / spd); }
    if (spd < params.minSpeed && spd > 0.00001) { vel = vel * (params.minSpeed / spd); }

    // ── Position update with toroidal wrap ────────────────────────────────────
    var np = pos + vel * params.dt * 60.0;
    np.x = ((np.x % params.canvasW) + params.canvasW) % params.canvasW;
    np.y = ((np.y % params.canvasH) + params.canvasH) % params.canvasH;

    agents[i].pos = np;
    agents[i].vel = vel;
}
