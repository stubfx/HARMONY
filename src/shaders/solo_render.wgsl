// ─── Solo Particle Render Shader ──────────────────────────────────────────────
// Each agent renders as a 2-triangle quad drawn into the offscreen trail texture.
// Brightness is proportional to speed: fast particles glow; slow ones are dim.
//
// SoloRenderParams layout (32 bytes):
//   [0]  agentCount u32
//   [4]  canvasW    f32
//   [8]  canvasH    f32
//   [12] pointSize  f32  (px)
//   [16] colorR     f32
//   [20] colorG     f32
//   [24] colorB     f32
//   [28] maxSpeed   f32  (speed at which brightness reaches 1.0)

struct SoloRenderParams {
    agentCount: u32,
    canvasW:    f32,
    canvasH:    f32,
    pointSize:  f32,
    colorR:     f32,
    colorG:     f32,
    colorB:     f32,
    maxSpeed:   f32,
}

struct Agent {
    pos: vec2<f32>,
    vel: vec2<f32>,
}

@group(0) @binding(0) var<uniform>       params: SoloRenderParams;
@group(0) @binding(1) var<storage, read> agents: array<Agent>;

struct VsOut {
    @builtin(position) pos:   vec4<f32>,
    @location(0)       color: vec3<f32>,
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

    // Speed → brightness: still = near invisible, fast = full glow
    let speed  = length(agent.vel);
    let bright = clamp(speed / max(params.maxSpeed, 0.001), 0.08, 1.0);
    let color  = vec3<f32>(params.colorR, params.colorG, params.colorB) * bright;

    return VsOut(vec4<f32>(finalNdc, 0.0, 1.0), color);
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color, 1.0);
}
