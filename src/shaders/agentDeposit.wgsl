// ─── Agent → avoid-map deposit ───────────────────────────────────────────────
// One opaque-white quad per agent, sized to params.pointSize on the canvas,
// drawn into the avoidance map texture. The UV-to-canvas mapping mirrors
// avoidMapStrAt in compute.wgsl exactly (cover-fit + avoidMapScale) so a
// particle at canvas position P writes to the same avoid-map texel that
// `avoidMapStrAt(P)` reads back on the following frame. That closes the loop:
// the swarm's trail becomes new avoidance / new sampled colour.
//
// Source-over blend with src×srcAlpha + dst×(1-srcAlpha). With a fully-opaque
// fragment this is just "replace" — fine in rgba8unorm; for partial coverage
// (anti-aliased quad edges) it falls back to a normal alpha composite.

struct Params {
    canvasW:       f32,
    canvasH:       f32,
    texW:          f32,
    texH:          f32,
    avoidMapScale: f32,
    pointSize:     f32,
    _p0:           f32,
    _p1:           f32,
}

struct Agent {
    pos:    vec2<f32>,
    vel:    vec2<f32>,
    home:   vec2<f32>,
    weight: f32,
    primed: f32,
}

@group(0) @binding(0) var<uniform>       params: Params;
@group(0) @binding(1) var<storage, read> agents: array<Agent>;

@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
    let agentId = vi / 6u;
    let corner  = vi % 6u;
    let corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5), vec2<f32>( 0.5, -0.5), vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5, -0.5), vec2<f32>( 0.5,  0.5), vec2<f32>(-0.5,  0.5),
    );
    let agent = agents[agentId];

    // Cover-fit: the larger axis matches the canvas; the shorter overflows.
    // avoidMapScale zooms on top — same logic as avoidMapStrAt.
    let coverScale = max(params.canvasW / max(params.texW, 1.0),
                         params.canvasH / max(params.texH, 1.0))
                   * params.avoidMapScale;
    let scaled  = vec2<f32>(params.texW, params.texH) * coverScale;
    let center  = vec2<f32>(params.canvasW, params.canvasH) * 0.5;
    let uv      = (agent.pos - center) / max(scaled, vec2<f32>(1.0)) + 0.5;

    // NDC of the cell centre, Y flipped because texture space is top-down.
    let ndcCenter = vec2<f32>(uv.x * 2.0 - 1.0, -(uv.y * 2.0 - 1.0));
    // Half-extent in NDC matches pointSize canvas-pixels in each axis.
    let half      = vec2<f32>(params.pointSize / max(scaled.x, 1.0),
                              params.pointSize / max(scaled.y, 1.0));
    let finalNdc  = ndcCenter + corners[corner] * half * 2.0;
    return vec4<f32>(finalNdc, 0.0, 1.0);
}

@fragment fn fs() -> @location(0) vec4<f32> {
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
