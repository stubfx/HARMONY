// ─── Solo Particle Render Shader ──────────────────────────────────────────────
// SoloRenderParams layout (84 bytes):
//   [0]  agentCount     u32
//   [4]  canvasW        f32
//   [8]  canvasH        f32
//   [12] pointSize      f32
//   [16] colorR         f32
//   [20] colorG         f32
//   [24] colorB         f32
//   [28] maxSpeed       f32
//   [32] hasImage       u32
//   [36] imgX0          f32
//   [40] imgY0          f32
//   [44] imgX1          f32
//   [48] imgY1          f32
//   [52] speedColorR    f32
//   [56] speedColorG    f32
//   [60] speedColorB    f32
//   [64] brightness     f32
//   [68] alphaThreshold f32
//   [72] blackThreshold f32
//   [76] vignetteEdge   f32
//   [80] qrMode         u32   (1 = QR active: fade free agents near the QR rect)

struct SoloRenderParams {
    agentCount:     u32,
    canvasW:        f32,
    canvasH:        f32,
    pointSize:      f32,
    colorR:         f32,
    colorG:         f32,
    colorB:         f32,
    maxSpeed:       f32,
    hasImage:       u32,
    imgX0:          f32,
    imgY0:          f32,
    imgX1:          f32,
    imgY1:          f32,
    speedColorR:    f32,
    speedColorG:    f32,
    speedColorB:    f32,
    brightness:     f32,
    alphaThreshold: f32,
    blackThreshold: f32,
    vignetteEdge:   f32,
    qrMode:         u32,
}

struct Agent {
    pos:    vec2<f32>,
    vel:    vec2<f32>,
    home:   vec2<f32>,
    weight: f32,
    _pad:   f32,
}

@group(0) @binding(0) var<uniform>       params: SoloRenderParams;
@group(0) @binding(1) var<storage, read> agents: array<Agent>;
@group(0) @binding(2) var               imgSmp: sampler;
@group(0) @binding(3) var               imgTex: texture_2d<f32>;

struct VsOut {
    @builtin(position) pos:      vec4<f32>,
    @location(0)       color:    vec3<f32>,
    @location(1)       agentPos: vec2<f32>,
    @location(2)       bright:   f32,
    @location(3)       homeUV:   vec2<f32>,
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

    let speed      = length(agent.vel);
    let t          = clamp(speed / max(params.maxSpeed, 0.001), 0.0, 1.0);
    let color      = mix(
        vec3<f32>(params.colorR,      params.colorG,      params.colorB),
        vec3<f32>(params.speedColorR, params.speedColorG, params.speedColorB),
        t,
    );
    let homeUV = vec2<f32>(
        (agent.home.x - params.imgX0) / (params.imgX1 - params.imgX0),
        (agent.home.y - params.imgY0) / (params.imgY1 - params.imgY0),
    );

    return VsOut(vec4<f32>(finalNdc, 0.0, 1.0), color, agent.pos, t, homeUV);
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
    if (params.hasImage != 0u) {
        let inRect = in.homeUV.x >= 0.0 && in.homeUV.x <= 1.0 &&
                     in.homeUV.y >= 0.0 && in.homeUV.y <= 1.0;
        if (inRect) {
            let uv = clamp(in.homeUV, vec2<f32>(0.0), vec2<f32>(1.0));

            // In QR mode use textureLoad (nearest-neighbour) to match the compute shader's
            // imgAlphaAt exactly — bilinear bleeding across module boundaries causes a
            // sampler mismatch where compute sees alpha=0 (free) but render sees alpha>0
            // (white), producing phantom white pixels that never home.
            var imgSample: vec4<f32>;
            if (params.qrMode != 0u) {
                let tdims = textureDimensions(imgTex);
                let tx    = u32(uv.x * f32(tdims.x - 1u));
                let ty    = u32(uv.y * f32(tdims.y - 1u));
                imgSample = textureLoad(imgTex, vec2<u32>(tx, ty), 0);
            } else {
                imgSample = textureSampleLevel(imgTex, imgSmp, uv, 0.0);
            }

            // Black cutoff: skip pixels whose luminance is below the threshold.
            let luma = dot(imgSample.rgb, vec3<f32>(0.299, 0.587, 0.114));
            if (luma >= params.blackThreshold && imgSample.a >= params.alphaThreshold) {
                // Edge fade — skipped in QR mode so finder-pattern corners stay at full brightness.
                let distEdge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
                let vig      = select(smoothstep(0.0, max(params.vignetteEdge, 0.0001), distEdge), 1.0, params.qrMode != 0u);
                return vec4<f32>(imgSample.rgb, imgSample.a * vig);
            }
        }
    }
    // QR mode: free agents (home outside QR rect) darken as they approach the QR area.
    // Signed distance to the rect edge → smoothstep over 80px falloff.
    if (params.qrMode != 0u) {
        let dx   = max(max(params.imgX0 - in.agentPos.x, in.agentPos.x - params.imgX1), 0.0);
        let dy   = max(max(params.imgY0 - in.agentPos.y, in.agentPos.y - params.imgY1), 0.0);
        let dist = length(vec2<f32>(dx, dy));
        let fade = smoothstep(0.0, 80.0, dist);
        return vec4<f32>(in.color, params.brightness * fade);
    }
    return vec4<f32>(in.color, params.brightness);
}
