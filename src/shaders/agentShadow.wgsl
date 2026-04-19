// ─── Agent Shadow Pass ─────────────────────────────────────────────────────────
// Renders a soft black splatter shadow centred on each homing agent every frame.
//
// The compute shader writes agent.primed = 1.0 (homing) or 0.0 (free) each frame,
// using the same vignette-weighted alpha check as imgAlphaAt(). This shader reads
// that flag directly — no independent texture sampling — so it is always consistent
// with compute and render. Non-homing agents degenerate to a single out-of-clip-space
// point and generate zero fragments.
//
// Each homing agent renders a quad of side 2×shadowRadius canvas pixels centred on
// its current position. The fragment outputs black at (1 − smoothstep(dist/radius))
// × shadowStr, blended with src-alpha / one-minus-src-alpha to darken the trail.
//
// AgentShadowParams layout (32 bytes):
//   [0]  canvasW      f32
//   [4]  canvasH      f32
//   [8]  shadowRadius f32   (quad half-extent in canvas pixels)
//   [12] shadowStr    f32   (peak shadow opacity, 0–1)
//   [16] hasImage     u32
//   [20] _p0          u32
//   [24] _p1          u32
//   [28] _p2          u32

struct AgentShadowParams {
    canvasW:      f32,
    canvasH:      f32,
    shadowRadius: f32,
    shadowStr:    f32,
    hasImage:     u32,
    _p0:          u32,
    _p1:          u32,
    _p2:          u32,
}

struct Agent {
    pos:    vec2<f32>,
    vel:    vec2<f32>,
    home:   vec2<f32>,
    weight: f32,
    primed: f32,   // 1.0 = homing, 0.0 = free — written by compute each frame
}

@group(0) @binding(0) var<uniform>       p:      AgentShadowParams;
@group(0) @binding(1) var<storage, read> agents: array<Agent>;

struct VsOut {
    @builtin(position) clipPos:  vec4<f32>,
    @location(0)       agentPos: vec2<f32>,   // agent centre in canvas pixels
    @location(1)       isHoming: f32,
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
    let agentId = vi / 6u;
    let corner  = vi % 6u;

    let corners = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0,  1.0),
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0,  1.0), vec2<f32>(-1.0, 1.0),
    );

    let agent    = agents[agentId];
    let isHoming = agent.primed;   // read flag written by compute — no texture lookup needed

    let ndc = vec2<f32>(
         agent.pos.x / p.canvasW * 2.0 - 1.0,
        -(agent.pos.y / p.canvasH * 2.0 - 1.0),
    );

    var clipPos: vec4<f32>;
    if (isHoming > 0.5 && p.hasImage != 0u) {
        let halfW = p.shadowRadius / p.canvasW;
        let halfH = p.shadowRadius / p.canvasH;
        clipPos = vec4<f32>(ndc + corners[corner] * vec2<f32>(halfW, halfH) * 2.0, 0.0, 1.0);
    } else {
        // Degenerate point outside clip space — rasteriser generates no fragments
        clipPos = vec4<f32>(10.0, 10.0, 0.0, 1.0);
    }

    return VsOut(clipPos, agent.pos, isHoming);
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
    if (in.isHoming < 0.5) { return vec4<f32>(0.0); }
    // @builtin(position).xy gives the fragment centre in canvas (framebuffer) pixels,
    // matching the canvas-pixel space of agent.pos — distance is in canvas pixels.
    let dist    = length(in.clipPos.xy - in.agentPos);
    let falloff = 1.0 - smoothstep(0.0, p.shadowRadius, dist);
    return vec4<f32>(0.0, 0.0, 0.0, falloff * p.shadowStr);
}
