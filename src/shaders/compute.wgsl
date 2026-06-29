// ─── Formula-Driven Particle Compute Shader ───────────────────────────────────
// Two WGSL functions are prepended at compile-time by solo.js:
//   evalDirFormula  — desired heading angle for each particle (radians)
//   evalWindFormula — wind force direction (radians)
//
// SoloParams layout (128 bytes):
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
//   [80] windBiasX      f32   (collective tilt X — added to formula wind)
//   [84] windBiasY      f32   (collective tilt Y — added to formula wind)
//   [88] avoidForceStr  f32   (multiplier for all image-trace avoidance forces)
//   [92] qrMode         u32   (1 = QR active: home captured by rect, not alpha)
//   [96] hasAvoidMap    u32   (1 = avoidance map active)
//   [100] avoidMapScale f32   (map covers this fraction of canvas, centered)
//   [104] bounceEdges   u32   (1 = reflect at canvas edges, 0 = wrap)
//   [108] probeLen          f32   (Physarum sensor cast distance in canvas pixels)
//   [112] probeForceStr     f32   (lateral steering force multiplier)
//   [116] respawnOnCollide  u32   (1 = teleport to edge instead of steering on dense probe)
//   [120] probeSensorAngle  f32   (half-angle between left/right sensors, radians)
//   [124] homingChance      f32   (per-frame probability [0–1] that a newly-eligible agent commits to homing)
//   [128] homingInfluence      f32   (max homing blend weight at dist=0; scales linearly to 0 at dist=canvasW)
//   [132] spectatorCount       u32   (active connected spectators; 0 = collective wind only)
//   [136] spectatorSpawnChance f32   (per-frame probability an assigned agent teleports to the touch point)
//   [140] spectatorAgentShare  f32   (0–1 fraction of agents that follow spectators; rest are sim-only)
//   [144] dotMode              u32   (1 when status = DOT; enables centre-respawn)
//   [148] dotCenterRadius      f32   (px radius around canvas centre; free agents inside are respawned to edges)
//   [152] dotRespawnChance     f32   (per-frame probability [0–1] that a centre-zone agent is respawned)
//   [156] respawnOnQR          u32   (1 = respawn free agents inside the QR rect to a random edge)
//   [160] qrRespawnChance      f32   (per-frame probability [0–1])
//   [164] qrX0                 f32   (QR rect left edge in canvas pixels)
//   [168] qrY0                 f32   (QR rect top edge)
//   [172] qrX1                 f32   (QR rect right edge)
//   [176] qrY1                 f32   (QR rect bottom edge)
//   [180] avoidMapInvert       u32   (1 = invert the avoidance map sample at read time: 1.0 - r)
//   [184] golEnabled           u32
//   [188] golStrength          f32
//   [192] releaseBurstSpeed    f32   (initial speed of the fireworks scatter when a joystick is released; 0 = off)
//   [196] chaos                f32
//   [200] randomTeleportChance f32   (per-frame probability [0–1] that any agent teleports to a random canvas position)
//   [204] chladniActive        u32
//   [208] chladniM             f32
//   [212] chladniN             f32
//   [216] chladniSym           f32
//   [220] chladniBlend         f32
//   [224] spawnFadeRate        f32   (per-frame weight increment for newly-respawned agents; 0 = stay dark)
//   [228] limitAtCenter        u32   (1 = agents outside limitAtCenterRadius are raw-teleported to canvas centre)
//   [232] limitAtCenterRadius  f32   (radius in canvas pixels for the limitAtCenter constraint)

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
    windBiasX:      f32,
    windBiasY:      f32,
    avoidForceStr:  f32,
    qrMode:         u32,
    hasAvoidMap:    u32,
    avoidMapScale:  f32,
    bounceEdges:      u32,
    probeLen:          f32,
    probeForceStr:     f32,
    respawnOnCollide:  u32,
    probeSensorAngle:  f32,
    homingChance:         f32,
    homingInfluence:      f32,
    spectatorCount:       u32,
    spectatorSpawnChance: f32,
    spectatorAgentShare:  f32,
    dotMode:              u32,
    dotCenterRadius:      f32,
    dotRespawnChance:     f32,
    respawnOnQR:          u32,
    qrRespawnChance:      f32,
    qrX0:                 f32,
    qrY0:                 f32,
    qrX1:                 f32,
    qrY1:                 f32,
    avoidMapInvert:       u32,
    golEnabled:           u32,   // 1 = particles are attracted to Game-of-Life live cells
    golStrength:          f32,   // attraction strength toward live cells
    releaseBurstSpeed:    f32,   // fireworks scatter speed on joystick release (0 = disabled)
    chaos:                f32,   // 0 = armonia (no noise), 1 = max random noise (from collective rotation)
    randomTeleportChance: f32,   // per-frame probability that any agent jumps to a random canvas position
    chladniActive:        u32,   // 1 = blend a Chladni perturbation into the direction formula
    chladniM:             f32,   // Chladni mode M
    chladniN:             f32,   // Chladni mode N
    chladniSym:           f32,   // Chladni symmetry factor (±1)
    chladniBlend:         f32,   // 0–1 blend weight; 0 = formula only, 1 = full Chladni
    spawnFadeRate:        f32,
    limitAtCenter:        u32,
    limitAtCenterRadius:  f32,
    _pad2:                u32,
}

// Per-spectator partition data — color, joystick spawner position, personal wind.
// 12 × f32/u32 = 48 bytes per slot; 16 slots = 768 bytes total.
struct SpectatorSlot {
    colorR:               f32,
    colorG:               f32,
    colorB:               f32,
    isActive:             u32,
    spawnerX:             f32,
    spawnerY:             f32,
    spawnerLocationActive: u32,
    _p0:                  u32,
    burst:                u32,   // 1 for the single frame after the joystick is released — scatter this slot's agents
    burstSeed:            u32,   // per-release random seed so each burst differs
}

struct Agent {
    pos:    vec2<f32>,
    vel:    vec2<f32>,
    home:   vec2<f32>,
    weight: f32,
    primed: f32,   // 1.0 = homing (home pixel passes threshold), 0.0 = free; written each frame
}

// ── Contamination — up to 10 circular eraser zones ───────────────────────────
// Within each circle the trace alpha is zeroed (clean-only — no alpha is added
// where there was none). Applied after black cutoff and vignette.
// Free agents within 1.5× radius are pushed outward when push != 0.
// Layout (176 bytes):
//   [0]  count   u32  — active points (0 = disabled)
//   [4]  radius  f32  — circle radius in canvas pixels
//   [8]  push    u32  — 1 = push free agents outward, 0 = erase only
//   [12] _p0     u32
//   [16..175] points  array<vec4<f32>, 10>  — xy = canvas pixel, zw unused
struct ContamParams {
    count:  u32,
    radius: f32,
    push:   u32,
    _p0:    u32,
    points: array<vec4<f32>, 10>,
}

@group(0) @binding(0) var<uniform>             params:           SoloParams;
@group(0) @binding(1) var<storage, read_write> agents:           array<Agent>;
@group(0) @binding(2) var                      imageTex:         texture_2d<f32>;
@group(0) @binding(3) var<uniform>             contam:           ContamParams;
@group(0) @binding(4) var                      avoidMapTex:      texture_2d<f32>;
@group(0) @binding(5) var                      shadowDensityTex: texture_2d<f32>;
@group(0) @binding(6) var<storage, read>       spectatorSlots:   array<SpectatorSlot, 16>;
@group(0) @binding(7) var                      golTex:           texture_2d<f32>;

const PI:     f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

fn chladniDirAngle(x: f32, y: f32, cx: f32, cy: f32, m: f32, n: f32, sym: f32) -> f32 {
    let xn = x / (2.0 * cx);
    let yn = y / (2.0 * cy);
    let fx = -m * PI * sin(m * PI * xn) * cos(n * PI * yn) - sym * n * PI * sin(n * PI * xn) * cos(m * PI * yn);
    let fy = -n * PI * cos(m * PI * xn) * sin(n * PI * yn) - sym * m * PI * cos(n * PI * xn) * sin(m * PI * yn);
    return atan2(fx, -fy);
}

// Integer hash → uniform float in [0, 1). Used for pseudo-random edge respawn.
// Based on the Murmur3 finalizer — cheap, no texture lookup required.
fn hash(n: u32) -> f32 {
    var x = n;
    x = x ^ (x >> 16u);
    x = x * 0x45d9f3bu;
    x = x ^ (x >> 16u);
    return f32(x) * (1.0 / 4294967296.0);
}

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

// Sample avoidance map strength at a canvas-pixel position.
// Cover fit: texture scaled so it fills the entire canvas while preserving its
// aspect ratio (like object-fit:cover) — the larger axis determines the scale,
// the shorter axis overflows and is cropped. avoidMapScale zooms in/out on top.
// Returns red channel [0, 1]; 0 outside the visible texture area.
fn avoidMapStrAt(canvasPx: vec2<f32>) -> f32 {
    let dims  = textureDimensions(avoidMapTex, 0u);
    let texSz = vec2<f32>(f32(dims.x), f32(dims.y));

    let coverScale = max(params.canvasW / texSz.x, params.canvasH / texSz.y)
                   * params.avoidMapScale;

    let center = vec2<f32>(params.canvasW, params.canvasH) * 0.5;
    let uv     = (canvasPx - center) / (texSz * coverScale) + 0.5;

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 0.0; }

    let mx = i32(dims.x) - 1;
    let my = i32(dims.y) - 1;
    let cx = i32(clamp(uv.x, 0.0, 1.0) * f32(dims.x - 1u));
    let cy = i32(clamp(uv.y, 0.0, 1.0) * f32(dims.y - 1u));

    // Chaos-driven blur: 9-tap sparse Gaussian kernel, radius = chaos × 8 texels.
    // At chaos=0 all offsets are 0 → all taps hit the same texel, no blur.
    // At chaos=1 samples spread ±8 texels on axes, ±6 on diagonals.
    let br = params.chaos * 8.0;
    let ra = i32(round(br));          // axis offset
    let rd = i32(round(br * 0.707));  // diagonal offset ≈ br / √2

    let r = (textureLoad(avoidMapTex, vec2<u32>(u32(clamp(cx,      0, mx)), u32(clamp(cy,      0, my))), 0u).r * 4.0
           + textureLoad(avoidMapTex, vec2<u32>(u32(clamp(cx + ra, 0, mx)), u32(clamp(cy,      0, my))), 0u).r * 2.0
           + textureLoad(avoidMapTex, vec2<u32>(u32(clamp(cx - ra, 0, mx)), u32(clamp(cy,      0, my))), 0u).r * 2.0
           + textureLoad(avoidMapTex, vec2<u32>(u32(clamp(cx,      0, mx)), u32(clamp(cy + ra, 0, my))), 0u).r * 2.0
           + textureLoad(avoidMapTex, vec2<u32>(u32(clamp(cx,      0, mx)), u32(clamp(cy - ra, 0, my))), 0u).r * 2.0
           + textureLoad(avoidMapTex, vec2<u32>(u32(clamp(cx + rd, 0, mx)), u32(clamp(cy + rd, 0, my))), 0u).r * 1.0
           + textureLoad(avoidMapTex, vec2<u32>(u32(clamp(cx - rd, 0, mx)), u32(clamp(cy + rd, 0, my))), 0u).r * 1.0
           + textureLoad(avoidMapTex, vec2<u32>(u32(clamp(cx + rd, 0, mx)), u32(clamp(cy - rd, 0, my))), 0u).r * 1.0
           + textureLoad(avoidMapTex, vec2<u32>(u32(clamp(cx - rd, 0, mx)), u32(clamp(cy - rd, 0, my))), 0u).r * 1.0
           ) / 16.0;

    return select(r, 1.0 - r, params.avoidMapInvert != 0u);
}

// Sample shadow density at a canvas-pixel position.
// Returns luminance [0, 1] of the shadow density texture — cleared to black each
// frame and filled additively by the shadow density pass. 0 = no shadow, 1 = saturated
// overlap of many homing agents. Used by the probe to scale avoidance force.
fn shadowDensityAt(canvasPx: vec2<f32>) -> f32 {
    let dims = textureDimensions(shadowDensityTex, 0u);
    let tx   = u32(clamp(canvasPx.x / params.canvasW, 0.0, 1.0) * f32(dims.x - 1u));
    let ty   = u32(clamp(canvasPx.y / params.canvasH, 0.0, 1.0) * f32(dims.y - 1u));
    let px   = textureLoad(shadowDensityTex, vec2<u32>(tx, ty), 0u);
    return dot(px.rgb, vec3<f32>(0.299, 0.587, 0.114));
}

// Sample the Game-of-Life grid at a canvas-pixel position. Returns 1 = live, 0 = dead.
fn golAliveAt(canvasPx: vec2<f32>) -> f32 {
    let dims = textureDimensions(golTex, 0u);
    let tx   = u32(clamp(canvasPx.x / params.canvasW, 0.0, 1.0) * f32(dims.x - 1u));
    let ty   = u32(clamp(canvasPx.y / params.canvasH, 0.0, 1.0) * f32(dims.y - 1u));
    return textureLoad(golTex, vec2<u32>(tx, ty), 0u).r;
}

// Returns true when pt falls inside any active contamination circle.
fn isContaminated(pt: vec2<f32>) -> bool {
    for (var k = 0u; k < contam.count; k++) {
        if (length(pt - contam.points[k].xy) <= contam.radius) { return true; }
    }
    return false;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.agentCount) { return; }

    var pos    = agents[i].pos;
    var vel    = agents[i].vel;
    let home   = agents[i].home;
    var weight = agents[i].weight;

    let x   = pos.x;
    let y   = pos.y;
    let t   = params.time;
    let idx = f32(i);
    let cx  = params.canvasW * 0.5;
    let cy  = params.canvasH * 0.5;

    let freeAngle = evalDirFormula(x, y, t, idx, cx, cy);
    var dirAngle  = freeAngle;
    if (params.chladniActive != 0u && params.chladniBlend > 0.0) {
        let chAngle  = chladniDirAngle(x, y, cx, cy, params.chladniM, params.chladniN, params.chladniSym);
        let freeVec  = vec2f(cos(freeAngle), sin(freeAngle));
        let chVec    = vec2f(cos(chAngle),   sin(chAngle));
        let blended  = normalize(mix(freeVec, chVec, params.chladniBlend));
        dirAngle     = atan2(blended.y, blended.x);
    }
    let desired  = vec2<f32>(cos(dirAngle), sin(dirAngle));

    let windAngle = evalWindFormula(x, y, t, idx, cx, cy);
    var wind = vec2<f32>(cos(windAngle), sin(windAngle)) * params.windStr
             + vec2<f32>(params.windBiasX, params.windBiasY);

    // ── Trace layer: image-alpha-driven homing ─────────────────────────────────
    // homeInImg true  → agent drives toward its fixed home position (homing mode)
    // homeInImg false → agent follows formula/wind (free mode)
    var homeInImg = false;
    var posAlpha  = 0.0;
    var texDims   = vec2<u32>(1u, 1u);

    if (params.hasImage != 0u) {
        texDims = textureDimensions(imageTex, 0u);
        var homeAlpha   = imgAlphaAt(home, texDims);
        var rawPosAlpha = imgAlphaAt(pos,  texDims);

        // Contamination — clean-only erase within circles.
        // Opaque pixels (>= threshold) → alpha zeroed. Transparent pixels unchanged.
        if (contam.count > 0u) {
            if (isContaminated(home)) {
                homeAlpha = select(homeAlpha, 0.0, homeAlpha >= params.alphaThreshold);
            }
            if (isContaminated(pos)) {
                rawPosAlpha = select(rawPosAlpha, 0.0, rawPosAlpha >= params.alphaThreshold);
            }
        }

        // Probabilistic homing gate: per-frame probability scaled by (1 - chaos).
        // At chaos=0 (armonia): wasHoming agents always stay, new agents get homingChance.
        // At chaos=1 (max caos): no agent homes — probability collapses to 0.
        let homeQualifies = homeAlpha >= params.alphaThreshold;
        let wasHoming     = agents[i].primed > 0.5;
        if (homeQualifies) {
            let rng        = hash(i ^ (u32(params.time * 73.0) + 5u));
            let baseChance = select(params.homingChance, 1.0, wasHoming);
            homeInImg      = rng < baseChance * (1.0 - params.chaos);
        }
        posAlpha = rawPosAlpha;
    }

    let imgCentre = vec2<f32>(
        (params.imgX0 + params.imgX1) * 0.5,
        (params.imgY0 + params.imgY1) * 0.5,
    );

    if (homeInImg) {
        // ── Homing agent ───────────────────────────────────────────────────────
        // Formula + wind still apply, but are blended against the homing direction.
        // Blend weight falls linearly with distance: at dist=0 → homingInfluence,
        // at dist=canvasW → 0 (pure free forces). No obstacle avoidance while homing.
        let toHome = home - pos;
        let dist   = length(toHome);

        var freeVel = vel;
        if (params.followFormula != 0u) {
            freeVel = mix(freeVel, desired * (params.stepLen * weight), params.turnRate);
        }
        freeVel += wind * params.dt * 60.0;

        // Speed capped at magnetStr; also capped at dist so the agent can't overshoot.
        // Using dist/dist (not normalize) to avoid division by zero at dist ≈ 0.
        var homingVel = vec2<f32>(0.0, 0.0);
        if (dist > 0.001) {
            homingVel = (toHome / dist) * min(dist, params.magnetStr);
        }

        let blendT = clamp(1.0 - dist / params.canvasW, 0.0, 1.0) * params.homingInfluence;
        vel = mix(freeVel, homingVel, blendT);
    } else {
        // ── Free agent: formula steering + wind ───────────────────────────────
        // chaos=1 → freeFactor=0 → agents ignore formula/wind and go straight.
        // chaos=0 → freeFactor=1 → normal steering.
        let freeFactor = 1.0 - params.chaos;
        if (params.followFormula != 0u) {
            vel = mix(vel, desired * (params.stepLen * weight), params.turnRate * freeFactor);
        }
        vel += wind * params.dt * 60.0 * freeFactor;

        // ── Game of Life attraction ────────────────────────────────────────────
        // Steer up the gradient of the live-cell grid, so the swarm gathers on and
        // follows the evolving Game-of-Life patterns.
        if (params.golEnabled != 0u) {
            let cellW = params.canvasW / f32(textureDimensions(golTex, 0u).x);
            let e2    = max(cellW, 1.0);
            let aR    = golAliveAt(pos + vec2<f32>( e2, 0.0));
            let aL    = golAliveAt(pos + vec2<f32>(-e2, 0.0));
            let aD    = golAliveAt(pos + vec2<f32>(0.0,  e2));
            let aU    = golAliveAt(pos + vec2<f32>(0.0, -e2));
            let gg    = vec2<f32>(aR - aL, aD - aU);
            if (length(gg) > 0.0001) {
                vel += normalize(gg) * params.golStrength * params.maxSpeed * params.dt * 60.0;
            }
        }

        // ── Image trace avoidance ──────────────────────────────────────────────
        // Replaces the old push-from-centre with content-aware deflection:
        //
        //   Case A — already inside opaque area (posAlpha > 0):
        //     Compute local alpha gradient via 4-sample central differences.
        //     Push along −∇α (toward lower alpha = toward the nearest boundary gap).
        //     Fallback to rect-centre push only when gradient is zero (flat uniform fill).
        //
        //   Case B — transparent now but heading into opacity (posAlpha = 0):
        //     Gradient from current pos reveals nearby boundary direction.
        //     Lookahead confirms opacity at next few steps.
        //     Remove the inward velocity component — agent slides along the edge.
        //
        // Gradient epsilon: 4 canvas pixels — coarse enough to span sub-pixel
        // boundaries, fine enough not to smear across separate regions.
        if (params.hasImage != 0u) {
            let EPS = 4.0;
            let gx = imgAlphaAt(vec2<f32>(pos.x + EPS, pos.y), texDims)
                   - imgAlphaAt(vec2<f32>(pos.x - EPS, pos.y), texDims);
            let gy = imgAlphaAt(vec2<f32>(pos.x, pos.y + EPS), texDims)
                   - imgAlphaAt(vec2<f32>(pos.x, pos.y - EPS), texDims);
            let grad    = vec2<f32>(gx, gy);
            let gradLen = length(grad);

            if (posAlpha > 0.0) {
                // Case A: inside opaque — push toward lower alpha
                if (gradLen > 0.001) {
                    vel += -normalize(grad) * params.maxSpeed * posAlpha * params.dt * 60.0
                         * params.avoidForceStr;
                } else {
                    // Zero gradient (flat uniform fill) — fall back to rect-centre push
                    let away = pos - imgCentre;
                    if (length(away) > 0.001) {
                        vel += normalize(away) * params.maxSpeed * posAlpha * params.dt * 60.0
                             * params.avoidForceStr;
                    }
                }
            } else if (gradLen > 0.001) {
                // Case B: transparent but near a boundary — check if heading in
                let velLen = length(vel);
                if (velLen > 0.001) {
                    let gradDir     = normalize(grad);
                    let inwardSpeed = dot(gradDir, vel);
                    if (inwardSpeed > 0.0) {
                        // Lookahead: confirm opacity several steps ahead
                        let futurePos = pos + normalize(vel) * (params.stepLen * 4.0);
                        let lookAlpha = imgAlphaAt(futurePos, texDims);
                        if (lookAlpha > params.alphaThreshold) {
                            // Remove the inward velocity component proportionally
                            let strength = smoothstep(params.alphaThreshold, 1.0, lookAlpha);
                            vel -= gradDir * inwardSpeed * strength * params.avoidForceStr;
                        }
                    }
                }
            }
        }

        // ── Contamination circle avoidance ─────────────────────────────────────
        // Soft outward push within 1.5× contamination radius for all free agents.
        // Linear falloff: full force at circle centre, zero at the influence edge.
        // Gated by contam.push — erase-only mode leaves agent velocity untouched.
        if (contam.push != 0u) {
            let INFLUENCE = 1.5;
            for (var k = 0u; k < contam.count; k++) {
                let cp        = contam.points[k].xy;
                let diff      = pos - cp;
                let dist      = length(diff);
                let influence = contam.radius * INFLUENCE;
                if (dist < influence && dist > 0.001) {
                    let t = 1.0 - dist / influence;
                    vel += normalize(diff) * t * params.maxSpeed * params.dt * 60.0;
                }
            }
        }

        // ── Shadow density probe (3-sensor Physarum) ─────────────────────────
        // Left, center, right sensors cast at probeSensorAngle from forward direction.
        // Agent steers laterally away from the denser side (dR - dL).
        // Uses 3 texture samples; no gradient needed.
        if (params.hasImage != 0u && params.probeForceStr > 0.001 && params.probeLen > 0.1) {
            let velLen = length(vel);
            if (velLen > 0.001) {
                let fwdDir   = normalize(vel);
                let cosA     = cos(params.probeSensorAngle);
                let sinA     = sin(params.probeSensorAngle);
                let leftDir  = vec2f( fwdDir.x*cosA - fwdDir.y*sinA,  fwdDir.x*sinA + fwdDir.y*cosA);
                let rightDir = vec2f( fwdDir.x*cosA + fwdDir.y*sinA, -fwdDir.x*sinA + fwdDir.y*cosA);
                let dC = shadowDensityAt(pos + fwdDir   * params.probeLen);
                let dL = shadowDensityAt(pos + leftDir  * params.probeLen);
                let dR = shadowDensityAt(pos + rightDir * params.probeLen);
                let maxDensity = max(dC, max(dL, dR));
                if (maxDensity > 0.005) {
                    if (params.respawnOnCollide != 0u && maxDensity > 0.3) {
                        let rng   = hash(i ^ (u32(params.time * 137.0) + 1u));
                        let perim = 2.0 * (params.canvasW + params.canvasH);
                        let t     = rng * perim;
                        var cp    = vec2<f32>(0.0, 0.0);
                        if (t < params.canvasW) {
                            cp = vec2<f32>(t, 0.0);
                        } else if (t < params.canvasW + params.canvasH) {
                            cp = vec2<f32>(params.canvasW, t - params.canvasW);
                        } else if (t < 2.0 * params.canvasW + params.canvasH) {
                            cp = vec2<f32>(t - params.canvasW - params.canvasH, params.canvasH);
                        } else {
                            cp = vec2<f32>(0.0, t - 2.0 * params.canvasW - params.canvasH);
                        }
                        agents[i].pos    = cp;
                        agents[i].vel    = vec2<f32>(0.0, 0.0);
                        agents[i].primed = 0.0;
                        return;
                    } else {
                        // Perpendicular turn: positive = left. Turn away from denser side.
                        let perpDir = vec2f(-fwdDir.y, fwdDir.x);
                        let steer   = (dR - dL) * params.maxSpeed * params.probeForceStr
                                    * maxDensity * params.dt * 60.0;
                        vel += perpDir * steer;
                    }
                }
            }
        }

        // ── Avoidance map ──────────────────────────────────────────────────────
        // Grayscale mask (white = repel, black = pass). Gradient-based deflection
        // mirrors the image-trace avoidance: agents push toward lower values and
        // are deflected at edges. Uses the same avoidForceStr multiplier.
        if (params.hasAvoidMap != 0u) {
            let EPS    = 4.0;
            let mapStr = avoidMapStrAt(pos);
            let gx     = avoidMapStrAt(vec2<f32>(pos.x + EPS, pos.y))
                       - avoidMapStrAt(vec2<f32>(pos.x - EPS, pos.y));
            let gy     = avoidMapStrAt(vec2<f32>(pos.x, pos.y + EPS))
                       - avoidMapStrAt(vec2<f32>(pos.x, pos.y - EPS));
            let grad    = vec2<f32>(gx, gy);
            let gradLen = length(grad);

            if (mapStr > 0.05) {
                // Inside a white zone — push toward lower values (toward black)
                if (gradLen > 0.001) {
                    vel += -normalize(grad) * params.maxSpeed * mapStr
                         * params.dt * 60.0 * params.avoidForceStr;
                } else {
                    // Flat fill — push outward from map centre
                    let away = pos - vec2<f32>(params.canvasW * 0.5, params.canvasH * 0.5);
                    if (length(away) > 0.001) {
                        vel += normalize(away) * params.maxSpeed * mapStr
                             * params.dt * 60.0 * params.avoidForceStr;
                    }
                }
            } else if (gradLen > 0.001) {
                // Near an edge — deflect if heading inward
                let velLen = length(vel);
                if (velLen > 0.001) {
                    let gradDir     = normalize(grad);
                    let inwardSpeed = dot(gradDir, vel);
                    if (inwardSpeed > 0.0) {
                        let futurePos = pos + normalize(vel) * (params.stepLen * 4.0);
                        let lookStr   = avoidMapStrAt(futurePos);
                        if (lookStr > 0.05) {
                            let strength = smoothstep(0.05, 1.0, lookStr);
                            vel -= gradDir * inwardSpeed * strength * params.avoidForceStr;
                        }
                    }
                }
            }
        }
    }

    let spd = length(vel);
    if (spd > params.maxSpeed) { vel = vel * (params.maxSpeed / spd); }
    // minSpeed only enforced for free agents — homing agents must be able to rest at home.
    if (!homeInImg && spd < params.minSpeed && spd > 0.00001) { vel = vel * (params.minSpeed / spd); }

    var np = pos + vel * params.dt * 60.0;
    if (params.bounceEdges != 0u) {
        if (np.x < 0.0)              { np.x =  -np.x;                      vel.x =  abs(vel.x); }
        else if (np.x > params.canvasW) { np.x = 2.0 * params.canvasW - np.x; vel.x = -abs(vel.x); }
        if (np.y < 0.0)              { np.y =  -np.y;                      vel.y =  abs(vel.y); }
        else if (np.y > params.canvasH) { np.y = 2.0 * params.canvasH - np.y; vel.y = -abs(vel.y); }
        np.x = clamp(np.x, 0.0, params.canvasW);
        np.y = clamp(np.y, 0.0, params.canvasH);
    } else {
        np.x = ((np.x % params.canvasW) + params.canvasW) % params.canvasW;
        np.y = ((np.y % params.canvasH) + params.canvasH) % params.canvasH;
    }

    // DOT mode centre-respawn — two-frame process to avoid edge-flash artefacts:
    //   Frame A: agent selected → weight set to -1 (invisible, stays at current pos)
    //   Frame B: weight < 0 detected → teleport to random edge, weight reset to 0
    //   Frame C+: spawnFadeRate increments weight 0→1 (fade-in)

    // Frame B: complete a pending respawn flagged last frame.
    if (weight < 0.0) {
        let posRng = hash(i ^ (u32(params.time * 97.0) + 71u));
        let perim_ = 2.0 * (params.canvasW + params.canvasH);
        let t_     = posRng * perim_;
        var ep     = vec2<f32>(0.0, 0.0);
        if (t_ < params.canvasW) {
            ep = vec2<f32>(t_, 0.0);
        } else if (t_ < params.canvasW + params.canvasH) {
            ep = vec2<f32>(params.canvasW, t_ - params.canvasW);
        } else if (t_ < 2.0 * params.canvasW + params.canvasH) {
            ep = vec2<f32>(t_ - params.canvasW - params.canvasH, params.canvasH);
        } else {
            ep = vec2<f32>(0.0, t_ - 2.0 * params.canvasW - params.canvasH);
        }
        agents[i].pos    = ep;
        agents[i].vel    = vec2<f32>(0.0, 0.0);
        agents[i].primed = 0.0;
        agents[i].weight = 0.0;
        return;
    }

    // Frame A: select agent for respawn — flag it, stay invisible at current pos.
    if (params.dotMode != 0u && params.dotCenterRadius > 0.0 && !homeInImg) {
        let cx = params.canvasW * 0.5;
        let cy = params.canvasH * 0.5;
        if (length(np - vec2<f32>(cx, cy)) < params.dotCenterRadius) {
            let rng_ = hash(i ^ (u32(params.time * 137.0) + 53u));
            if (rng_ < params.dotRespawnChance) {
                agents[i].weight = -1.0;
                return;
            }
        }
    }

    // QR respawn: free agents inside the QR rect are stochastically scattered to edges.
    if (params.qrMode != 0u && params.respawnOnQR != 0u && !homeInImg) {
        if (np.x >= params.qrX0 && np.x <= params.qrX1 &&
            np.y >= params.qrY0 && np.y <= params.qrY1) {
            let rng_ = hash(i ^ (u32(params.time * 173.0) + 91u));
            if (rng_ < params.qrRespawnChance) {
                let posRng = hash(i ^ (u32(params.time * 113.0) + 83u));
                let perim_ = 2.0 * (params.canvasW + params.canvasH);
                let t_     = posRng * perim_;
                var ep     = vec2<f32>(0.0, 0.0);
                if (t_ < params.canvasW) {
                    ep = vec2<f32>(t_, 0.0);
                } else if (t_ < params.canvasW + params.canvasH) {
                    ep = vec2<f32>(params.canvasW, t_ - params.canvasW);
                } else if (t_ < 2.0 * params.canvasW + params.canvasH) {
                    ep = vec2<f32>(t_ - params.canvasW - params.canvasH, params.canvasH);
                } else {
                    ep = vec2<f32>(0.0, t_ - 2.0 * params.canvasW - params.canvasH);
                }
                agents[i].pos    = ep;
                agents[i].vel    = vec2<f32>(0.0, 0.0);
                agents[i].primed = 0.0;
                return;
            }
        }
    }

    // Spawner-teleport: move a fraction of the spectator's partition to the joystick spawner each frame.
    // Primed (homing) agents are never interrupted — they must finish homing.
    if (!homeInImg && params.spectatorCount > 0u && i < u32(f32(params.agentCount) * params.spectatorAgentShare)) {
        let slot = spectatorSlots[i % params.spectatorCount];
        if (slot.isActive != 0u) {
            if (slot.burst != 0u && params.releaseBurstSpeed > 0.0) {
                // Fireworks: the joystick was just released — fling this slot's agents
                // outward in random directions. The normal max-speed clamp reins them
                // back in over the next frames, so they scatter then rejoin the flow.
                let ang = hash(i ^ slot.burstSeed) * 6.28318530718;
                vel = vec2<f32>(cos(ang), sin(ang)) * params.releaseBurstSpeed;
            } else if (slot.spawnerLocationActive != 0u) {
                let rng = hash(i ^ (u32(params.time * 137.0) + 17u));
                if (rng < params.spectatorSpawnChance) {
                    np = vec2<f32>(slot.spawnerX * params.canvasW, slot.spawnerY * params.canvasH);
                }
            }
        }
    }

    // Random global teleport: any agent has a per-frame chance to jump to a random position.
    // Sets weight=0 so the agent is invisible this frame; fade-in starts next frame.
    var justTeleported = false;
    if (params.randomTeleportChance > 0.0) {
        let tRng = hash(i ^ (u32(params.time * 1013.0) + 29u));
        if (tRng < params.randomTeleportChance) {
            let rx = hash(i ^ (u32(params.time * 997.0)  + 3u));
            let ry = hash(i ^ (u32(params.time * 971.0)  + 11u));
            np             = vec2f(rx * params.canvasW, ry * params.canvasH);
            weight         = 0.0;
            justTeleported = true;
        }
    }

    // Fade-in: spawnFadeRate is per-second; scaled by dt for framerate independence.
    // Skip if weight<0 (pending dot-respawn) or agent just teleported this frame.
    if (params.spawnFadeRate > 0.0 && weight >= 0.0 && weight < 1.0 && !justTeleported) {
        weight = min(weight + params.spawnFadeRate * params.dt, 1.0);
    }

    // Limit-at-center: agents outside the radius have a 5% per-frame chance
    // of being raw-teleported to the canvas centre.
    if (params.limitAtCenter != 0u) {
        let cx = params.canvasW * 0.5;
        let cy = params.canvasH * 0.5;
        let dx = np.x - cx;
        let dy = np.y - cy;
        if (dx * dx + dy * dy > params.limitAtCenterRadius * params.limitAtCenterRadius) {
            let lacRng = hash(i ^ (u32(params.time * 1031.0) + 17u));
            if (lacRng < 0.003) {
                np  = vec2f(cx, cy);
                vel = vec2f(0.0, 0.0);
            }
        }
    }

    agents[i].pos    = np;
    agents[i].vel    = vel;
    agents[i].weight = weight;
    agents[i].primed = select(0.0, 1.0, homeInImg);
}
