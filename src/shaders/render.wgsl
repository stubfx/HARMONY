// ─── Solo Particle Render Shader ──────────────────────────────────────────────
// SoloRenderParams layout (116 bytes, padded to 128 in uniform block):
//   [0]   agentCount           u32
//   [4]   canvasW              f32
//   [8]   canvasH              f32
//   [12]  pointSize            f32
//   [16]  color1R              f32
//   [20]  color1G              f32
//   [24]  color1B              f32
//   [28]  maxSpeed             f32
//   [32]  hasImage             u32
//   [36]  imgX0                f32
//   [40]  imgY0                f32
//   [44]  imgX1                f32
//   [48]  imgY1                f32
//   [52]  color2R              f32
//   [56]  color2G              f32
//   [60]  color2B              f32
//   [64]  brightness           f32
//   [68]  alphaThreshold       f32
//   [72]  blackThreshold       f32
//   [76]  vignetteEdge         f32
//   [80]  qrMode               u32   (1 = QR active)
//   [84]  homingProximityRange f32   (canvas px over which homing agents fade in)
//   [88]  homingMinAlpha       f32   (minimum alpha for a homing agent at max distance)
//   [92]  spectatorCount       u32   (active spectators; 0 = use the global palette)
//   [96]  additiveBlend        u32   (1 = additive; 0 = max blend with pre-multiplied alpha)
//   [100] spectatorAgentShare  f32   (0–1 fraction of agents assigned to spectators)
//   [104] pixelMode            u32   (1 = snap to cell-grid and draw 1-cell quads into gridTex)
//   [108] cellsW               f32   (gridTex width in cells; only meaningful when pixelMode=1)
//   [112] cellsH               f32   (gridTex height in cells; only meaningful when pixelMode=1)
//   [116] blendAmount          f32   (0–1 multiplier on fragment output; lowers per-particle contribution)
//   [120] hasAvoidMap          u32   (mirrors the global flag — short-circuits the avoid-map color sample)
//   [124] avoidMapScale        f32   (cover-fit scale for avoidMapTex; matches the compute shader's sampling)
//   [128] avoidMapInvert       u32   (1 = sample as vec3(1 - r, 1 - g, 1 - b))
//   [132] avoidMapSampleColor  u32   (1 = non-homing particles take their base color from the avoid-map sample)
//   [136] avoidMapFixedColor   u32   (paired with sampleColor: 1 = use the exact pixel, 0 = use it as base then mix with speed color)
//   [140] avoidMapBlackCutoff  f32   (luminance floor on the sample: below this the sample is skipped, particle keeps base color)
//   [144] champions            u32   (every Nth agent is a champion; 0 = off — mirrors the shadow pass)
//   [148] championSize         f32   (point size for a FREE champion; ignored while homing)

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
}

struct Agent {
    pos:    vec2<f32>,
    vel:    vec2<f32>,
    home:   vec2<f32>,
    weight: f32,
    primed: f32,   // written by compute each frame: 1.0 = homing, 0.0 = free
}

struct SpectatorSlot {
    colorR:     f32,
    colorG:     f32,
    colorB:     f32,
    isActive:   u32,
    touchX:     f32,
    touchY:     f32,
    isTouching: u32,
    _p0:        u32,
    windX:      f32,
    windY:      f32,
    _p1:        u32,
    _p2:        u32,
}

@group(0) @binding(0) var<uniform>       params:         SoloRenderParams;
@group(0) @binding(1) var<storage, read> agents:         array<Agent>;
@group(0) @binding(2) var                imgSmp:         sampler;
@group(0) @binding(3) var                imgTex:         texture_2d<f32>;
@group(0) @binding(4) var<storage, read> spectatorSlots: array<SpectatorSlot, 16>;
@group(0) @binding(5) var                avoidMapTex:    texture_2d<f32>;

struct VsOut {
    @builtin(position) pos:        vec4<f32>,
    @location(0)       color:      vec3<f32>,
    @location(1)       agentPos:   vec2<f32>,
    @location(2)       bright:     f32,
    @location(3)       homeUV:     vec2<f32>,
    @location(4)       primed:     f32,
    @location(5)       proximityT: f32,  // 0 = far from home, 1 = at home
}

fn hash(n: u32) -> f32 {
    var x = n;
    x = x ^ (x >> 16u);
    x = x * 0x45d9f3bu;
    x = x ^ (x >> 16u);
    return f32(x) * (1.0 / 4294967296.0);
}

// Sample RGB from the avoidance map at a canvas-pixel position, using the same
// cover-fit + scale mapping as the compute shader's avoidMapStrAt so positions
// stay aligned between the avoidance force and the color sample.
// Returns vec4(rgb, validFlag); validFlag is 0 when the sample lands outside
// the texture's visible area (caller falls back to the default base color).
fn avoidMapColorAt(canvasPx: vec2<f32>) -> vec4<f32> {
    let dims  = textureDimensions(avoidMapTex, 0u);
    let texSz = vec2<f32>(f32(dims.x), f32(dims.y));
    let coverScale = max(params.canvasW / texSz.x, params.canvasH / texSz.y)
                   * params.avoidMapScale;
    let center = vec2<f32>(params.canvasW, params.canvasH) * 0.5;
    let uv     = (canvasPx - center) / (texSz * coverScale) + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return vec4<f32>(0.0); }
    let tx = u32(clamp(uv.x, 0.0, 1.0) * f32(dims.x - 1u));
    let ty = u32(clamp(uv.y, 0.0, 1.0) * f32(dims.y - 1u));
    let s   = textureLoad(avoidMapTex, vec2<u32>(tx, ty), 0u);
    let rgb = select(s.rgb, vec3<f32>(1.0) - s.rgb, params.avoidMapInvert != 0u);
    // Skip samples darker than the cutoff so near-black pixels don't paint
    // particles invisible; caller falls back to the default base color. Rec. 601
    // luma — same weighting the blit shader uses for grayscale.
    let luma = dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
    let valid = select(0.0, 1.0, luma > params.avoidMapBlackCutoff);
    return vec4<f32>(rgb, valid);
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
    let agentId = vi / 6u;
    let corner  = vi % 6u;

    let corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5), vec2<f32>( 0.5, -0.5), vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5, -0.5), vec2<f32>( 0.5,  0.5), vec2<f32>(-0.5,  0.5),
    );

    let agent    = agents[agentId];
    var ndc:  vec2<f32>;
    var half: vec2<f32>;
    if (params.pixelMode != 0u) {
        // Snap the agent's continuous position to the centre of the grid cell it
        // falls in, and size the quad to cover exactly one cell. The render target
        // is the low-res gridTex (cellsW × cellsH), so each particle becomes one
        // hard pixel — and movement appears as discrete cell-to-cell jumps.
        let cellX = floor(clamp(agent.pos.x / params.canvasW, 0.0, 0.99999) * params.cellsW);
        let cellY = floor(clamp(agent.pos.y / params.canvasH, 0.0, 0.99999) * params.cellsH);
        let cu    = (cellX + 0.5) / params.cellsW;
        let cv    = (cellY + 0.5) / params.cellsH;
        ndc  = vec2<f32>(cu * 2.0 - 1.0, -(cv * 2.0 - 1.0));
        half = vec2<f32>(1.0 / params.cellsW, 1.0 / params.cellsH);
    } else {
        ndc  = vec2<f32>(
             agent.pos.x / params.canvasW * 2.0 - 1.0,
            -(agent.pos.y / params.canvasH * 2.0 - 1.0),
        );
        // Champions render larger, but ONLY while free — a homing champion falls
        // back to the normal agent size like everyone else.
        let isChampion = params.champions != 0u && (agentId % params.champions) == 0u;
        let homingNow  = params.hasImage != 0u && agent.primed > 0.5;
        let sz = select(params.pointSize, params.championSize, isChampion && !homingNow);
        half = vec2<f32>(sz / params.canvasW, sz / params.canvasH);
    }
    let finalNdc = ndc + corners[corner] * half * 2.0;

    // Two-colour palette assigned by agent index, no velocity interpolation.
    // Conceptually colors[agentId % N]; currently two colours.
    let color1 = vec3f(params.color1R, params.color1G, params.color1B);
    let color2 = vec3f(params.color2R, params.color2G, params.color2B);

    // Optionally replaced by an avoid-map sample for non-homing agents (homing
    // agents are skipped — the fragment shader overrides with the trace image).
    let isHoming = params.hasImage != 0u && agent.primed > 0.5;
    var defaultColor = select(color1, color2, (agentId % 2u) == 1u);
    if (params.avoidMapSampleColor != 0u && params.hasAvoidMap != 0u && !isHoming) {
        let s = avoidMapColorAt(agent.pos);
        if (s.a > 0.5) {
            defaultColor = s.rgb;
        }
    }

    var color: vec3f;
    if (params.spectatorCount > 0u && agentId < u32(f32(params.agentCount) * params.spectatorAgentShare)) {
        let slot = spectatorSlots[agentId % params.spectatorCount];
        if (slot.isActive != 0u) {
            // Assigned agents: fixed hue from the user's chosen color, no speed blend.
            // Each agent gets a random brightness multiplier in [0.7, 1.3].
            let rnd = hash(agentId) * 0.6 + 0.7;
            color = clamp(vec3f(slot.colorR, slot.colorG, slot.colorB) * rnd, vec3f(0.0), vec3f(1.0));
        } else {
            color = defaultColor;
        }
    } else {
        color = defaultColor;
    }
    let homeUV = vec2<f32>(
        (agent.home.x - params.imgX0) / (params.imgX1 - params.imgX0),
        (agent.home.y - params.imgY0) / (params.imgY1 - params.imgY0),
    );

    // Proximity factor: 1.0 when agent is at its home pixel, homingMinAlpha when
    // at or beyond homingProximityRange. Only meaningful for homing agents.
    let distToHome = length(agent.pos - agent.home);
    let rawT       = 1.0 - clamp(distToHome / max(params.homingProximityRange, 1.0), 0.0, 1.0);
    let proximityT = mix(params.homingMinAlpha, 1.0, rawT);

    return VsOut(vec4<f32>(finalNdc, 0.0, 1.0), color, agent.pos, 0.0, homeUV, agent.primed, proximityT);
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
    // agent.primed is written by the compute shader each frame (1.0 = homing, 0.0 = free).
    // Using it as the sole gate guarantees render, shadow, and compute always agree —
    // no independent texture re-sampling means no bilinear/nearest-neighbour mismatch.
    if (params.hasImage != 0u && in.primed > 0.5) {
        let uv = clamp(in.homeUV, vec2<f32>(0.0), vec2<f32>(1.0));

        // Sample image for actual RGB colour. QR mode uses nearest-neighbour to keep
        // module boundaries crisp; non-QR uses bilinear for smooth colour blending.
        var imgSample: vec4<f32>;
        if (params.qrMode != 0u) {
            let tdims = textureDimensions(imgTex);
            let tx    = u32(uv.x * f32(tdims.x - 1u));
            let ty    = u32(uv.y * f32(tdims.y - 1u));
            imgSample = textureLoad(imgTex, vec2<u32>(tx, ty), 0);
        } else {
            imgSample = textureSampleLevel(imgTex, imgSmp, uv, 0.0);
        }

        // Vignette for output alpha — purely visual, the primed gate already accounts for it.
        // Proximity factor fades the agent in as it closes in on its home pixel.
        let distEdge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
        let vig      = select(smoothstep(0.0, max(params.vignetteEdge, 0.0001), distEdge), 1.0, params.qrMode != 0u);
        let a        = imgSample.a * vig * in.proximityT;
        // Max blend (operation:'max', factors:'one') ignores alpha — pre-multiply so the
        // max comparison sees distance-scaled colours instead of raw image values.
        // blendAmount scales the contribution in both modes: alpha for additive
        // (less accumulation), rgb for max (dimmer source in the per-channel max).
        let b = params.blendAmount;
        if (params.additiveBlend == 0u) { return vec4<f32>(imgSample.rgb * a * b, a * b); }
        return vec4<f32>(imgSample.rgb * b, a * b);
    }
    let b = params.blendAmount;
    return vec4<f32>(in.color * b, params.brightness * b);
}
