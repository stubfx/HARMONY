// ─── Solo Particle Render Shader ──────────────────────────────────────────────
// SoloRenderParams layout (96 bytes):
//   [0]  agentCount          u32
//   [4]  canvasW             f32
//   [8]  canvasH             f32
//   [12] pointSize           f32
//   [16] colorR              f32
//   [20] colorG              f32
//   [24] colorB              f32
//   [28] maxSpeed            f32
//   [32] hasImage            u32
//   [36] imgX0               f32
//   [40] imgY0               f32
//   [44] imgX1               f32
//   [48] imgY1               f32
//   [52] speedColorR         f32
//   [56] speedColorG         f32
//   [60] speedColorB         f32
//   [64] brightness          f32
//   [68] alphaThreshold      f32
//   [72] blackThreshold      f32
//   [76] vignetteEdge        f32
//   [80] qrMode              u32   (1 = QR active)
//   [84] qrFadeZone          u32   (1 = fade free agents near the QR rect)
//   [88] homingProximityRange f32  (canvas px over which homing agents fade in)
//   [92] homingMinAlpha       f32  (minimum alpha for a homing agent at max distance)
//   [96] spectatorCount       u32  (active spectators; 0 = use global params.color)

struct SoloRenderParams {
    agentCount:           u32,
    canvasW:              f32,
    canvasH:              f32,
    pointSize:            f32,
    colorR:               f32,
    colorG:               f32,
    colorB:               f32,
    maxSpeed:             f32,
    hasImage:             u32,
    imgX0:                f32,
    imgY0:                f32,
    imgX1:                f32,
    imgY1:                f32,
    speedColorR:          f32,
    speedColorG:          f32,
    speedColorB:          f32,
    brightness:           f32,
    alphaThreshold:       f32,
    blackThreshold:       f32,
    vignetteEdge:         f32,
    qrMode:               u32,
    qrFadeZone:           u32,
    homingProximityRange: f32,
    homingMinAlpha:       f32,
    spectatorCount:       u32,
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

struct VsOut {
    @builtin(position) pos:        vec4<f32>,
    @location(0)       color:      vec3<f32>,
    @location(1)       agentPos:   vec2<f32>,
    @location(2)       bright:     f32,
    @location(3)       homeUV:     vec2<f32>,
    @location(4)       primed:     f32,
    @location(5)       proximityT: f32,  // 0 = far from home, 1 = at home
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
    let agentId = vi / 6u;
    let corner  = vi % 6u;

    let corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5), vec2<f32>( 0.5, -0.5), vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5, -0.5), vec2<f32>( 0.5,  0.5), vec2<f32>(-0.5,  0.5),
    );

    let agent    = agents[agentId];
    let ndc      = vec2<f32>(
         agent.pos.x / params.canvasW * 2.0 - 1.0,
        -(agent.pos.y / params.canvasH * 2.0 - 1.0),
    );
    let half     = vec2<f32>(params.pointSize / params.canvasW, params.pointSize / params.canvasH);
    let finalNdc = ndc + corners[corner] * half * 2.0;

    let speed = length(agent.vel);
    let t     = clamp(speed / max(params.maxSpeed, 0.001), 0.0, 1.0);
    var baseColor = vec3f(params.colorR, params.colorG, params.colorB);
    if (params.spectatorCount > 0u) {
        let slot = spectatorSlots[agentId % params.spectatorCount];
        if (slot.isActive != 0u) {
            baseColor = vec3f(slot.colorR, slot.colorG, slot.colorB);
        }
    }
    let color = mix(baseColor, vec3f(params.speedColorR, params.speedColorG, params.speedColorB), t);
    let homeUV = vec2<f32>(
        (agent.home.x - params.imgX0) / (params.imgX1 - params.imgX0),
        (agent.home.y - params.imgY0) / (params.imgY1 - params.imgY0),
    );

    // Proximity factor: 1.0 when agent is at its home pixel, homingMinAlpha when
    // at or beyond homingProximityRange. Only meaningful for homing agents.
    let distToHome = length(agent.pos - agent.home);
    let rawT       = 1.0 - clamp(distToHome / max(params.homingProximityRange, 1.0), 0.0, 1.0);
    let proximityT = mix(params.homingMinAlpha, 1.0, rawT);

    return VsOut(vec4<f32>(finalNdc, 0.0, 1.0), color, agent.pos, t, homeUV, agent.primed, proximityT);
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
        return vec4<f32>(imgSample.rgb, imgSample.a * vig * in.proximityT);
    }
    // QR mode: optionally fade free agents near the QR rect to keep it scannable.
    // Signed distance to the rect edge → smoothstep over 80px falloff.
    if (params.qrMode != 0u && params.qrFadeZone != 0u) {
        let dx   = max(max(params.imgX0 - in.agentPos.x, in.agentPos.x - params.imgX1), 0.0);
        let dy   = max(max(params.imgY0 - in.agentPos.y, in.agentPos.y - params.imgY1), 0.0);
        let dist = length(vec2<f32>(dx, dy));
        let fade = smoothstep(0.0, 80.0, dist);
        return vec4<f32>(in.color, params.brightness * fade);
    }
    return vec4<f32>(in.color, params.brightness);
}
