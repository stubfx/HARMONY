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
    home:   vec2<f32>,  // assigned grid-cell centre; used for image colour sampling
    weight: f32,        // unused here; present for correct stride
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
    @location(2)       bright:   f32,         // speed ratio [0..1]
    @location(3)       homeUV:   vec2<f32>,   // home position in image UV space
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

    // Home position in image UV space — used in fragment to colour home-agents
    // from the image at their assigned pixel rather than their current position.
    let homeUV = vec2<f32>(
        (agent.home.x - params.imgX0) / (params.imgX1 - params.imgX0),
        (agent.home.y - params.imgY0) / (params.imgY1 - params.imgY0),
    );

    return VsOut(vec4<f32>(finalNdc, 0.0, 1.0), color, agent.pos, t, homeUV);
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
    if (params.hasImage != 0u) {
        let homeInImg = in.homeUV.x >= 0.0 && in.homeUV.x <= 1.0 &&
                        in.homeUV.y >= 0.0 && in.homeUV.y <= 1.0;
        if (homeInImg) {
            // This agent's home is inside the image: always show the image colour
            // at the home UV, regardless of where the agent currently is on screen.
            let imgColor = textureSampleLevel(imgTex, imgSmp, in.homeUV, 0.0).rgb;
            return vec4<f32>(imgColor, params.brightness);
        }
    }
    return vec4<f32>(in.color, params.brightness);
}
