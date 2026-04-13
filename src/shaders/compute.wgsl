// ─── Formula-Driven Particle Compute Shader ───────────────────────────────────
// Two WGSL functions are prepended at compile-time by solo.js:
//   evalDirFormula  — desired heading angle for each particle (radians)
//   evalWindFormula — wind force direction (radians)
//
// SoloParams layout (80 bytes):
//   [0]  agentCount     u32
//   [4]  canvasW        f32
//   [8]  canvasH        f32
//   [12] stepLen        f32
//   [16] dt             f32
//   [20] time           f32
//   [24] windStr        f32
//   [28] turnRate       f32
//   [32] maxSpeed       f32
//   [36] minSpeed       f32
//   [40] hasImage       u32
//   [44] magnetStr      f32   (homing speed px/frame)
//   [48] imgX0          f32
//   [52] imgY0          f32
//   [56] imgX1          f32
//   [60] imgY1          f32
//   [64] followFormula  u32
//   [68] alphaThreshold f32   (min image alpha to trigger homing)
//   [72] blackThreshold f32   (luminance below which pixels are transparent)
//   [76] vignetteEdge   f32   (edge fade width in UV units)

struct SoloParams {
    agentCount:     u32,
    canvasW:        f32,
    canvasH:        f32,
    stepLen:        f32,
    dt:             f32,
    time:           f32,
    windStr:        f32,
    turnRate:       f32,
    maxSpeed:       f32,
    minSpeed:       f32,
    hasImage:       u32,
    magnetStr:      f32,
    imgX0:          f32,
    imgY0:          f32,
    imgX1:          f32,
    imgY1:          f32,
    followFormula:  u32,
    alphaThreshold: f32,
    blackThreshold: f32,
    vignetteEdge:   f32,
}

struct Agent {
    pos:    vec2<f32>,
    vel:    vec2<f32>,
    home:   vec2<f32>,
    weight: f32,
    _pad:   f32,
}

@group(0) @binding(0) var<uniform>             params:   SoloParams;
@group(0) @binding(1) var<storage, read_write> agents:   array<Agent>;
@group(0) @binding(2) var                      imageTex: texture_2d<f32>;

const PI:     f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

// Sample effective image alpha at a canvas-pixel position.
// Applies black cutoff (luminance) and rectangular edge fade.
// Returns 0 if outside the image rect or below cutoffs.
fn imgAlphaAt(canvasPx: vec2<f32>, texDims: vec2<u32>) -> f32 {
    let uv = vec2<f32>(
        (canvasPx.x - params.imgX0) / (params.imgX1 - params.imgX0),
        (canvasPx.y - params.imgY0) / (params.imgY1 - params.imgY0),
    );
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 0.0; }
    let tx  = u32(clamp(uv.x, 0.0, 1.0) * f32(texDims.x - 1u));
    let ty  = u32(clamp(uv.y, 0.0, 1.0) * f32(texDims.y - 1u));
    let px  = textureLoad(imageTex, vec2<u32>(tx, ty), 0u);
    // Black cutoff: pixels below this luminance are fully transparent
    let luma = dot(px.rgb, vec3<f32>(0.299, 0.587, 0.114));
    if (luma < params.blackThreshold) { return 0.0; }
    // Rectangular edge fade
    let distEdge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    let vig = smoothstep(0.0, max(params.vignetteEdge, 0.0001), distEdge);
    return px.a * vig;
}

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

    let dirAngle = evalDirFormula(x, y, t, idx, cx, cy);
    let desired  = vec2<f32>(cos(dirAngle), sin(dirAngle));

    let windAngle = evalWindFormula(x, y, t, idx, cx, cy);
    let wind      = vec2<f32>(cos(windAngle), sin(windAngle)) * params.windStr;

    // ── Trace layer: image-alpha-driven homing ─────────────────────────────────
    // An agent homes only when the image pixel at its assigned home position
    // has opacity >= alphaThreshold. Below that threshold the agent is free.
    // Non-homing agents passing through the image are repelled in proportion
    // to the alpha of the pixel they are currently standing on.
    var homeInImg = false;
    var posAlpha  = 0.0;

    if (params.hasImage != 0u) {
        let texDims = textureDimensions(imageTex, 0u);
        let homeAlpha = imgAlphaAt(home, texDims);
        homeInImg     = homeAlpha >= params.alphaThreshold;
        posAlpha      = imgAlphaAt(pos, texDims);
    }

    let imgCentre = vec2<f32>(
        (params.imgX0 + params.imgX1) * 0.5,
        (params.imgY0 + params.imgY1) * 0.5,
    );

    if (homeInImg) {
        let toHome = home - pos;
        let dist   = length(toHome);
        if (dist > 0.5) {
            vel = normalize(toHome) * params.magnetStr;
        } else {
            vel = vec2<f32>(0.0, 0.0);
        }
    } else {
        if (params.followFormula != 0u) {
            vel = mix(vel, desired * (params.stepLen * weight), params.turnRate);
        }
        vel += wind * params.dt * 60.0;

        // Repulsion: strength proportional to alpha at the agent's current position.
        // Opaque areas push hard; transparent areas are ignored.
        if (posAlpha > 0.0) {
            let away = normalize(pos - imgCentre);
            vel += away * params.maxSpeed * posAlpha * params.dt * 60.0;
        }
    }

    let spd = length(vel);
    if (spd > params.maxSpeed)                  { vel = vel * (params.maxSpeed / spd); }
    if (spd < params.minSpeed && spd > 0.00001) { vel = vel * (params.minSpeed / spd); }

    var np = pos + vel * params.dt * 60.0;
    np.x = ((np.x % params.canvasW) + params.canvasW) % params.canvasW;
    np.y = ((np.y % params.canvasH) + params.canvasH) % params.canvasH;

    agents[i].pos = np;
    agents[i].vel = vel;
}
