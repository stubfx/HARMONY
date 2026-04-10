// ─── Agent Render Shader ───────────────────────────────────────────────────────
// Entry points: agentVs / agentFs
//
// Bindings are at @group(0) (this module is separate from render.wgsl so
// Chrome's auto-layout doesn't merge the trail and agent resource sets).
//
// AgentRenderParams layout (64 bytes):
//   [0]  agentCount      u32
//   [4]  canvasW         f32
//   [8]  canvasH         f32
//   [12] pointSize       f32   (pixels)
//   [16] primaryR        f32
//   [20] primaryG        f32
//   [24] primaryB        f32
//   [28] secondaryAmount u32   (first N out of every 100 agents → secondary colour)
//   [32] secondaryR      f32
//   [36] secondaryG      f32
//   [40] secondaryB      f32
//   [44] tertiaryAmount  u32
//   [48] tertiaryR       f32
//   [52] tertiaryG       f32
//   [56] tertiaryB       f32
//   [60] _pad            u32

struct AgentRenderParams {
    agentCount:      u32,
    canvasW:         f32,
    canvasH:         f32,
    pointSize:       f32,
    primaryR:        f32,
    primaryG:        f32,
    primaryB:        f32,
    secondaryAmount: u32,
    secondaryR:      f32,
    secondaryG:      f32,
    secondaryB:      f32,
    tertiaryAmount:  u32,
    tertiaryR:       f32,
    tertiaryG:       f32,
    tertiaryB:       f32,
    _pad:            u32,
}

struct Agent {
    pos: vec2<f32>,
    vel: vec2<f32>,
}

@group(0) @binding(0) var<uniform>       agentParams: AgentRenderParams;
@group(0) @binding(1) var<storage, read> agents:      array<Agent>;

struct AgentVsOut {
    @builtin(position) pos:   vec4<f32>,
    @location(0)       color: vec3<f32>,
}

// Each agent is 6 vertices (2 triangles forming a quad).
// Quad corners in local [-0.5..0.5] space:
//   0:(-0.5,-0.5)  1:(0.5,-0.5)  2:(0.5,0.5)
//   3:(-0.5,-0.5)  4:(0.5,0.5)   5:(-0.5,0.5)
@vertex fn agentVs(@builtin(vertex_index) vi: u32) -> AgentVsOut {
    let agentId = vi / 6u;
    let corner  = vi % 6u;

    let corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, -0.5), vec2<f32>(0.5,  0.5),
        vec2<f32>(-0.5, -0.5), vec2<f32>(0.5,  0.5), vec2<f32>(-0.5, 0.5),
    );

    let agent = agents[agentId];

    // Canvas pixel → NDC (Y-flip because canvas Y-down, NDC Y-up)
    let ndcBase = vec2<f32>(
         agent.pos.x / agentParams.canvasW * 2.0 - 1.0,
        -(agent.pos.y / agentParams.canvasH * 2.0 - 1.0),
    );

    // Half-pixel size in NDC space
    let hpx = vec2<f32>(
        agentParams.pointSize / agentParams.canvasW,
        agentParams.pointSize / agentParams.canvasH,
    );
    let ndc = ndcBase + corners[corner] * hpx * 2.0;

    // ── Colour selection ──────────────────────────────────────────────────────
    // First secondaryAmount agents out of every 100 → secondary colour
    // Next  tertiaryAmount  agents out of every 100 → tertiary  colour
    let mod100 = agentId % 100u;
    var color  = vec3<f32>(agentParams.primaryR,   agentParams.primaryG,   agentParams.primaryB);
    if (mod100 < agentParams.tertiaryAmount) {
        color  = vec3<f32>(agentParams.tertiaryR,  agentParams.tertiaryG,  agentParams.tertiaryB);
    }
    if (mod100 < agentParams.secondaryAmount) {
        color  = vec3<f32>(agentParams.secondaryR, agentParams.secondaryG, agentParams.secondaryB);
    }

    return AgentVsOut(vec4<f32>(ndc, 0.0, 1.0), color);
}

@fragment fn agentFs(in: AgentVsOut) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color, 1.0);
}
