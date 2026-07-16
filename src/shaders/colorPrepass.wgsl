// ─── Per-Agent Color Prepass ───────────────────────────────────────────────────
// Compute shader that runs once per agent per frame and writes a packed RGBA8
// color into colorBuf[i].  The render vertex shader reads this value instead of
// recomputing the same color six times (once per quad vertex).
//
// Bindings mirror the relevant subset of the render shader's bind group:
//   0  renderUB       — SoloRenderParams (color, spectator, avoidmap flags)
//   1  agents         — agent buffer (read-only: primed flag + position)
//   2  spectatorSlots — per-spectator colors (read-only)
//   3  avoidMapTex    — avoidance map texture (optional; uses textureLoad)
//   4  colorBuf       — output: one packed u32 per agent (rgba8unorm)

struct SoloRenderParams {
    agentCount:           u32,
    canvasW:              f32,
    canvasH:              f32,
    pointSize:            f32,
    color1R:              f32,
    color1G:              f32,
    color1B:              f32,
    maxSpeed:             f32,
    hasImage:             u32,
    imgX0:                f32,
    imgY0:                f32,
    imgX1:                f32,
    imgY1:                f32,
    color2R:              f32,
    color2G:              f32,
    color2B:              f32,
    brightness:           f32,
    alphaThreshold:       f32,
    blackThreshold:       f32,
    vignetteEdge:         f32,
    qrMode:               u32,
    homingProximityRange: f32,
    homingMinAlpha:       f32,
    spectatorCount:       u32,
    additiveBlend:        u32,
    spectatorAgentShare:  f32,
    pixelMode:            u32,
    cellsW:               f32,
    cellsH:               f32,
    blendAmount:          f32,
    hasAvoidMap:          u32,
    avoidMapScale:        f32,
    avoidMapInvert:       u32,
    avoidMapSampleColor:  u32,
    avoidMapFixedColor:   u32,
    avoidMapBlackCutoff:  f32,
    champions:            u32,
    championSize:         f32,
    color2Mix:            f32,
    _reserved0:           f32,
    _reserved1:           f32,
    _reserved2:           f32,
    _reserved3:           f32,
    _reserved4:           f32,
    idleColorR:           f32,
    idleColorG:           f32,
    idleColorB:           f32,
    idleColorFraction:    f32,
    debugHoming:          u32,
    _pad0:                u32,
    _pad1:                u32,
    _pad2:                u32,
}

struct Agent {
    pos:    vec2<f32>,
    vel:    vec2<f32>,
    home:   vec2<f32>,
    weight: f32,
    primed: f32,
}

// Only colorR/G/B + isActive are read here; the rest is padding to match the
// 11-field / 44-byte stride of the compute shader's SpectatorSlot layout.
struct SpectatorSlot {
    colorR:     f32,
    colorG:     f32,
    colorB:     f32,
    isActive:   u32,
    touchX:     f32,
    touchY:     f32,
    isTouching: u32,
    _p0:        u32,
    _p1:        u32,
    _p2:        u32,
    _p3:        u32,
}

@group(0) @binding(0) var<uniform>       params:         SoloRenderParams;
@group(0) @binding(1) var<storage, read> agents:         array<Agent>;
@group(0) @binding(2) var<storage, read> spectatorSlots: array<SpectatorSlot, 16>;
@group(0) @binding(3) var                avoidMapTex:    texture_2d<f32>;
@group(0) @binding(4) var<storage, read_write> colorBuf: array<u32>;

fn hash(n: u32) -> f32 {
    var x = n;
    x = x ^ (x >> 16u);
    x = x * 0x45d9f3bu;
    x = x ^ (x >> 16u);
    return f32(x) * (1.0 / 4294967296.0);
}

fn avoidMapColorAt(canvasPx: vec2<f32>) -> vec4<f32> {
    let dims  = textureDimensions(avoidMapTex, 0u);
    let texSz = vec2<f32>(f32(dims.x), f32(dims.y));
    let coverScale = max(params.canvasW / texSz.x, params.canvasH / texSz.y)
                   * params.avoidMapScale;
    let center = vec2<f32>(params.canvasW, params.canvasH) * 0.5;
    let uv     = (canvasPx - center) / (texSz * coverScale) + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return vec4<f32>(0.0); }
    let tx  = u32(clamp(uv.x, 0.0, 1.0) * f32(dims.x - 1u));
    let ty  = u32(clamp(uv.y, 0.0, 1.0) * f32(dims.y - 1u));
    let s   = textureLoad(avoidMapTex, vec2<u32>(tx, ty), 0u);
    let rgb = select(s.rgb, vec3<f32>(1.0) - s.rgb, params.avoidMapInvert != 0u);
    let luma  = dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
    let valid = select(0.0, 1.0, luma > params.avoidMapBlackCutoff);
    return vec4<f32>(rgb, valid);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.agentCount) { return; }

    let agent   = agents[i];
    let agentId = i;

    let color1 = vec3f(params.color1R, params.color1G, params.color1B);
    let color2 = vec3f(params.color2R, params.color2G, params.color2B);

    var defaultColor = select(color1, color2, (agentId % 2u) == 1u);
    defaultColor = mix(defaultColor, color2, clamp(params.color2Mix, 0.0, 1.0));

    let inSpectatorRange = params.spectatorCount > 0u
        && agentId < u32(f32(params.agentCount) * params.spectatorAgentShare);
    var slotIsActive = false;
    var slotColor    = defaultColor;
    if (inSpectatorRange) {
        let slot = spectatorSlots[agentId % params.spectatorCount];
        if (slot.isActive != 0u) {
            slotIsActive = true;
            let rnd = hash(agentId) * 0.6 + 0.7;
            slotColor = clamp(vec3f(slot.colorR, slot.colorG, slot.colorB) * rnd,
                              vec3f(0.0), vec3f(1.0));
        }
    }

    if (!inSpectatorRange && params.avoidMapSampleColor != 0u
            && params.hasAvoidMap != 0u) {
        let sampleProb = 0.30;
        if (hash(agentId ^ 0xdeadbeefu) < sampleProb) {
            let s = avoidMapColorAt(agent.pos);
            if (s.a > 0.5) { defaultColor = s.rgb; }
        }
    }

    var color = select(defaultColor, slotColor, slotIsActive);

    if (hash(agentId ^ 0xd1e0c01au) < params.idleColorFraction) {
        color = vec3f(params.idleColorR, params.idleColorG, params.idleColorB);
    }

    colorBuf[i] = pack4x8unorm(vec4(color, 1.0));
}
