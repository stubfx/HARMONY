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
//   [196] _reservedChaos       f32
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
    _reservedChaos:       f32,   // reserved (formerly chaos); kept to preserve buffer layout
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
// 11 × f32/u32 = 44 bytes per slot; 16 slots = 704 bytes total.
struct SpectatorSlot {
    colorR:               f32,
    colorG:               f32,
    colorB:               f32,
    isActive:             u32,
    spawnerX:             f32,
    spawnerY:             f32,
    spawnerLocationActive: u32,
    formulaIdx:           u32,   // per-spectator direction formula index (picked by that spectator's note)
    burst:                u32,   // 1 for the single frame after the joystick is released — scatter this slot's agents
    burstSeed:            u32,   // per-release random seed so each burst differs (also seeds the blip point)
    blip:                 u32,   // 1 for the single frame after this spectator taps a blip target — teleport their agents
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
@group(0) @binding(3) var<uniform>             contam:           ContamParams;
@group(0) @binding(4) var                      avoidMapTex:      texture_2d<f32>;
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

// Sample avoidance map strength at a canvas-pixel position.
// Contain fit: texture scaled so it fits entirely within the canvas while
// preserving aspect ratio (like object-fit:contain) — the smaller axis
// determines the scale; the other axis has empty margins. avoidMapScale zooms in/out on top.
// Returns red channel [0, 1]; 0 outside the visible texture area.
fn avoidMapStrAt(canvasPx: vec2<f32>) -> f32 {
    let dims  = textureDimensions(avoidMapTex, 0u);
    let texSz = vec2<f32>(f32(dims.x), f32(dims.y));

    let coverScale = min(params.canvasW / texSz.x, params.canvasH / texSz.y)
                   * params.avoidMapScale;

    let center = vec2<f32>(params.canvasW, params.canvasH) * 0.5;
    let uv     = (canvasPx - center) / (texSz * coverScale) + 0.5;

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 0.0; }

    let cx = i32(clamp(uv.x, 0.0, 1.0) * f32(dims.x - 1u));
    let cy = i32(clamp(uv.y, 0.0, 1.0) * f32(dims.y - 1u));

    let r = textureLoad(avoidMapTex, vec2<u32>(u32(cx), u32(cy)), 0u).r;

    return select(r, 1.0 - r, params.avoidMapInvert != 0u);
}

// Sample the Game-of-Life grid at a canvas-pixel position. Returns 1 = live, 0 = dead.
fn golAliveAt(canvasPx: vec2<f32>) -> f32 {
    let dims = textureDimensions(golTex, 0u);
    let tx   = u32(clamp(canvasPx.x / params.canvasW, 0.0, 1.0) * f32(dims.x - 1u));
    let ty   = u32(clamp(canvasPx.y / params.canvasH, 0.0, 1.0) * f32(dims.y - 1u));
    return textureLoad(golTex, vec2<u32>(tx, ty), 0u).r;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.agentCount) { return; }

    var pos    = agents[i].pos;
    var vel    = agents[i].vel;
    var weight = agents[i].weight;

    let x   = pos.x;
    let y   = pos.y;
    let t   = params.time;
    let idx = f32(i);
    let cx  = params.canvasW * 0.5;
    let cy  = params.canvasH * 0.5;

    // Per-spectator movement: agents in the spectator share follow their owning
    // spectator's chosen formula (picked by that spectator's note); everyone else
    // follows the global formula. Same partition as the spawner-teleport below.
    var freeAngle = evalDirFormula(x, y, t, idx, cx, cy);
    if (params.spectatorCount > 0u && i < u32(f32(params.agentCount) * params.spectatorAgentShare)) {
        let dirSlot = spectatorSlots[i % params.spectatorCount];
        if (dirSlot.isActive != 0u) {
            freeAngle = evalDirFormulaBank(dirSlot.formulaIdx, x, y, t, idx, cx, cy);
        }
    }
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

    {
        // ── Free agent: formula steering + wind ───────────────────────────────
        if (params.followFormula != 0u) {
            vel = mix(vel, desired * (params.stepLen * weight), params.turnRate);
        }
        vel += wind * params.dt * 60.0;

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

        // ── Avoidance map ──────────────────────────────────────────────────────
        // Grayscale mask (white = repel, black = pass). Gradient-based deflection:
        // agents push toward lower values and are deflected at edges, scaled by
        // avoidForceStr.
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
    if (spd < params.minSpeed && spd > 0.00001) { vel = vel * (params.minSpeed / spd); }

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
    if (params.dotMode != 0u && params.dotCenterRadius > 0.0) {
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
    if (params.qrMode != 0u && params.respawnOnQR != 0u) {
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
    if (params.spectatorCount > 0u && i < u32(f32(params.agentCount) * params.spectatorAgentShare)) {
        let slot = spectatorSlots[i % params.spectatorCount];
        if (slot.isActive != 0u) {
            if (slot.blip != 0u) {
                // Blip: this spectator tapped their target — teleport most of their
                // own agents to a single shared random point so it reads as the user
                // making the burst themselves. The point is derived from burstSeed so
                // every one of their agents lands together; a per-agent hash keeps a
                // fraction behind so the cluster stays legible against the flow.
                if (hash(i ^ (slot.burstSeed + 101u)) < 0.7) {
                    let bx = hash(slot.burstSeed + 3u);
                    let by = hash(slot.burstSeed + 7u);
                    np = vec2<f32>(bx * params.canvasW, by * params.canvasH);
                    let ang = hash(i ^ slot.burstSeed) * 6.28318530718;
                    vel = vec2<f32>(cos(ang), sin(ang)) * (0.5 + hash(i) * 1.5);
                }
            } else if (slot.burst != 0u && params.releaseBurstSpeed > 0.0) {
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
    // When the avoidMap is active the blip must land OFF its white content — the sampled
    // avoid score (red channel) must stay below a small threshold. Try a few random points
    // and take the first that misses the white dots; if none do, cancel the teleport this
    // frame so blips don't materialise inside the image. Sets weight=0 so fade-in starts next.
    var justTeleported = false;
    if (params.randomTeleportChance > 0.0) {
        let tRng = hash(i ^ (u32(params.time * 1013.0) + 29u));
        if (tRng < params.randomTeleportChance) {
            var candidate = vec2f(0.0, 0.0);
            var placed    = false;
            if (params.hasAvoidMap != 0u) {
                for (var k: u32 = 0u; k < 8u; k = k + 1u) {
                    let rx = hash(i ^ (u32(params.time * 997.0) + 3u  + k * 101u));
                    let ry = hash(i ^ (u32(params.time * 971.0) + 11u + k * 149u));
                    let c  = vec2f(rx * params.canvasW, ry * params.canvasH);
                    if (avoidMapStrAt(c) < 0.05) { candidate = c; placed = true; break; }
                }
            } else {
                let rx = hash(i ^ (u32(params.time * 997.0) + 3u));
                let ry = hash(i ^ (u32(params.time * 971.0) + 11u));
                candidate = vec2f(rx * params.canvasW, ry * params.canvasH);
                placed    = true;
            }
            if (placed) {
                np             = candidate;
                weight         = 0.0;
                justTeleported = true;
            }
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
            if (lacRng < 0.01) {
                np  = vec2f(cx, cy);
                vel = vec2f(0.0, 0.0);
            }
        }
    }

    agents[i].pos    = np;
    agents[i].vel    = vel;
    agents[i].weight = weight;
    agents[i].primed = 0.0;
}
