// ─── Solo Particle Render Shader ──────────────────────────────────────────────
// Each agent renders as a 2-triangle quad drawn into the offscreen trail texture.
// Brightness is proportional to speed: fast particles glow; slow ones are dim.
// If a magnet image is active and the agent overlaps its canvas region, the image
// colour replaces the sim colour (still modulated by speed).
//
// SoloRenderParams layout (80 bytes):
//   [0]  agentCount  u32
//   [4]  canvasW     f32
//   [8]  canvasH     f32
//   [12] pointSize   f32  (px)
//   [16] colorR      f32  (base sim color — shown at low speed)
//   [20] colorG      f32
//   [24] colorB      f32
//   [28] maxSpeed    f32
//   [32] hasImage    u32
//   [36] imgX0       f32  (left edge of image region, canvas px)
//   [40] imgY0       f32  (top edge)
//   [44] imgX1       f32  (right edge)
//   [48] imgY1       f32  (bottom edge)
//   [52] speedColorR f32  (target color approached at max speed)
//   [56] speedColorG f32
//   [60] speedColorB f32
//   [64] brightness  f32  (per-particle alpha; controls additive accumulation)
//   [68] _p0..2      padding to reach 80 bytes

struct SoloRenderParams {
    agentCount:  u32,
    canvasW:     f32,
    canvasH:     f32,
    pointSize:   f32,
    colorR:      f32,
    colorG:      f32,
    colorB:      f32,
    maxSpeed:    f32,
    hasImage:    u32,
    imgX0:       f32,
    imgY0:       f32,
    imgX1:       f32,
    imgY1:       f32,
    speedColorR: f32,
    speedColorG: f32,
    speedColorB: f32,
    brightness:  f32,
    _p0:         f32,
    _p1:         f32,
    _p2:         f32,
}

struct Agent {
    pos:    vec2<f32>,
    vel:    vec2<f32>,
    weight: f32,   // seeded per-particle; unused here but required for correct stride
    _pad:   f32,
}

@group(0) @binding(0) var<uniform>       params: SoloRenderParams;
@group(0) @binding(1) var<storage, read> agents: array<Agent>;
@group(0) @binding(2) var               imgSmp: sampler;
@group(0) @binding(3) var               imgTex: texture_2d<f32>;

struct VsOut {
    @builtin(position) pos:      vec4<f32>,
    @location(0)       color:    vec3<f32>,   // mix(simColor, speedColor, speedRatio)
    @location(1)       agentPos: vec2<f32>,   // canvas-pixel center of the agent
    @location(2)       bright:   f32,         // speed ratio [0..1], used for image blend
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
    let agentId = vi / 6u;
    let corner  = vi % 6u;

    // Two-triangle quad corners in local [-0.5..0.5] space
    let corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5), vec2<f32>( 0.5, -0.5), vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5, -0.5), vec2<f32>( 0.5,  0.5), vec2<f32>(-0.5,  0.5),
    );

    let agent = agents[agentId];

    // Canvas pixel → NDC (Y-flip because canvas is Y-down, NDC is Y-up)
    let ndc = vec2<f32>(
         agent.pos.x / params.canvasW * 2.0 - 1.0,
        -(agent.pos.y / params.canvasH * 2.0 - 1.0),
    );
    let half = vec2<f32>(
        params.pointSize / params.canvasW,
        params.pointSize / params.canvasH,
    );
    let finalNdc = ndc + corners[corner] * half * 2.0;

    // Speed → color: slow particles keep base sim color, fast ones approach speed color
    let speed      = length(agent.vel);
    let t          = clamp(speed / max(params.maxSpeed, 0.001), 0.0, 1.0);
    let baseColor  = vec3<f32>(params.colorR,      params.colorG,      params.colorB);
    let speedColor = vec3<f32>(params.speedColorR, params.speedColorG, params.speedColorB);
    let color      = mix(baseColor, speedColor, t);

    return VsOut(vec4<f32>(finalNdc, 0.0, 1.0), color, agent.pos, t);
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
    // If this agent's center sits inside the image region, colour it from the image.
    // Near-black image pixels blend back toward the sim colour so black areas are
    // effectively transparent (particles keep their simulation colour there).
    if (params.hasImage != 0u) {
        let u = (in.agentPos.x - params.imgX0) / (params.imgX1 - params.imgX0);
        let v = (in.agentPos.y - params.imgY0) / (params.imgY1 - params.imgY0);
        if (u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= 1.0) {
            let imgColor = textureSampleLevel(imgTex, imgSmp, vec2<f32>(u, v), 0.0).rgb;
            let lum      = dot(imgColor, vec3<f32>(0.299, 0.587, 0.114));
            // smoothstep: lum < 0.1 → 0 (sim color), lum > 0.35 → 1 (image color)
            let blend    = smoothstep(0.1, 0.35, lum);
            let color    = mix(in.color, imgColor * in.bright, blend);
            return vec4<f32>(color, 1.0);
        }
    }
    return vec4<f32>(in.color, params.brightness);
}
