// ─── Champion Lines Pass ────────────────────────────────────────────────────────
// Draws a LINE_STRIP connecting all champion agents (every Nth) in array order.
// Rendered as a final overlay pass onto the swap-chain texture (loadOp:'load').
//
// ChampLinesParams layout (32 bytes):
//   [0]  canvasW    f32
//   [4]  canvasH    f32
//   [8]  agentCount u32
//   [12] champions  u32   (stride — same value as AgentShadowParams.champions)
//   [16] alpha      f32   (GUI-controlled line opacity)

struct ChampLinesParams {
    canvasW:    f32,
    canvasH:    f32,
    agentCount: u32,
    champions:  u32,
    alpha:      f32,
}

struct Agent {
    pos:    vec2<f32>,
    vel:    vec2<f32>,
    home:   vec2<f32>,
    weight: f32,
    primed: f32,
}

@group(0) @binding(0) var<uniform>       p:      ChampLinesParams;
@group(0) @binding(1) var<storage, read> agents: array<Agent>;

@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
    let idx = (vi * p.champions) % p.agentCount;
    let pos = agents[idx].pos;
    let ndc = vec2f(
         pos.x / p.canvasW  * 2.0 - 1.0,
        -pos.y / p.canvasH  * 2.0 + 1.0,
    );
    return vec4f(ndc, 0.0, 1.0);
}

@fragment fn fs() -> @location(0) vec4f {
    return vec4f(1.0, 1.0, 1.0, p.alpha);
}
