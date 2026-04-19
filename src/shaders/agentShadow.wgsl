// ─── Agent Shadow Pass ─────────────────────────────────────────────────────────
// Renders a soft black splatter shadow centred on each homing agent every frame.
// Only agents whose home pixel is "primed" (luma >= blackThreshold AND
// alpha >= alphaThreshold within the trace image rect) cast a shadow.
// Free agents (home outside the image rect or on a transparent/dark pixel) are
// skipped — their quad degenerates to a single out-of-clip-space point.
//
// Each homing agent renders a large quad (diameter = 2 × shadowRadius canvas px).
// The fragment computes the canvas-pixel distance to the agent centre, applies a
// smoothstep falloff from 1.0 (centre) to 0.0 (edge), and outputs black at
// falloff × shadowStr alpha. Blend is src-alpha / one-minus-src-alpha so the
// shadow darkens the trail texture underneath rather than adding brightness.
//
// AgentShadowParams layout (64 bytes):
//   [0]  canvasW        f32
//   [4]  canvasH        f32
//   [8]  agentCount     u32
//   [12] shadowRadius   f32   (quad half-extent in canvas pixels)
//   [16] shadowStr      f32   (peak shadow opacity, 0–1)
//   [20] hasImage       u32
//   [24] imgX0          f32
//   [28] imgY0          f32
//   [32] imgX1          f32
//   [36] imgY1          f32
//   [40] alphaThreshold f32
//   [44] blackThreshold f32
//   [48] vignetteEdge   f32   (matches SoloParams — 0 in QR mode)
//   [52] _p0            u32
//   [56] _p1            u32
//   [60] _p2            u32

struct AgentShadowParams {
    canvasW:        f32,
    canvasH:        f32,
    agentCount:     u32,
    shadowRadius:   f32,
    shadowStr:      f32,
    hasImage:       u32,
    imgX0:          f32,
    imgY0:          f32,
    imgX1:          f32,
    imgY1:          f32,
    alphaThreshold: f32,
    blackThreshold: f32,
    vignetteEdge:   f32,
    _p0:            u32,
    _p1:            u32,
    _p2:            u32,
}

struct Agent {
    pos:    vec2<f32>,
    vel:    vec2<f32>,
    home:   vec2<f32>,
    weight: f32,
    _pad:   f32,
}

@group(0) @binding(0) var<uniform>       p:      AgentShadowParams;
@group(0) @binding(1) var<storage, read> agents: array<Agent>;
@group(0) @binding(2) var               imgSmp: sampler;
@group(0) @binding(3) var               imgTex: texture_2d<f32>;

struct VsOut {
    @builtin(position) clipPos:  vec4<f32>,
    @location(0)       agentPos: vec2<f32>,   // agent centre in canvas pixels
    @location(1)       isHoming: f32,          // 1.0 = homing, 0.0 = skip
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
    let agentId = vi / 6u;
    let corner  = vi % 6u;

    let corners = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0,  1.0),
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0,  1.0), vec2<f32>(-1.0, 1.0),
    );

    let agent = agents[agentId];

    // homeUV: agent home position in image UV space
    let homeUV = vec2<f32>(
        (agent.home.x - p.imgX0) / (p.imgX1 - p.imgX0),
        (agent.home.y - p.imgY0) / (p.imgY1 - p.imgY0),
    );

    // An agent is homing when its home pixel is primed — inside the image rect
    // and passing the SAME vignette-weighted alpha check as imgAlphaAt() in compute.wgsl:
    //   luma >= blackThreshold  AND  s.a × vig >= alphaThreshold
    // Using raw s.a without vig would cast shadows for edge-zone "limbo" agents that
    // compute considers free, breaking the render/shadow/compute consistency.
    var isHoming = 0.0;
    if (p.hasImage != 0u &&
        homeUV.x >= 0.0 && homeUV.x <= 1.0 &&
        homeUV.y >= 0.0 && homeUV.y <= 1.0) {
        let uv       = clamp(homeUV, vec2<f32>(0.0), vec2<f32>(1.0));
        let s        = textureSampleLevel(imgTex, imgSmp, uv, 0.0);
        let luma     = dot(s.rgb, vec3<f32>(0.299, 0.587, 0.114));
        let distEdge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
        let vig      = smoothstep(0.0, max(p.vignetteEdge, 0.0001), distEdge);
        let effAlpha = s.a * vig;
        if (luma >= p.blackThreshold && effAlpha >= p.alphaThreshold) {
            isHoming = 1.0;
        }
    }

    // Agent NDC centre
    let ndc = vec2<f32>(
         agent.pos.x / p.canvasW * 2.0 - 1.0,
        -(agent.pos.y / p.canvasH * 2.0 - 1.0),
    );

    var clipPos: vec4<f32>;
    if (isHoming > 0.5) {
        // Expand quad by shadowRadius canvas pixels → NDC
        let halfW = p.shadowRadius / p.canvasW;
        let halfH = p.shadowRadius / p.canvasH;
        clipPos = vec4<f32>(ndc + corners[corner] * vec2<f32>(halfW, halfH) * 2.0, 0.0, 1.0);
    } else {
        // Degenerate point well outside clip space — rasteriser generates no fragments
        clipPos = vec4<f32>(10.0, 10.0, 0.0, 1.0);
    }

    return VsOut(clipPos, agent.pos, isHoming);
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
    if (in.isHoming < 0.5) { return vec4<f32>(0.0); }
    // @builtin(position).xy gives the fragment centre in framebuffer (canvas) pixels,
    // matching the canvas-pixel space of agent.pos — so distance is in canvas pixels.
    let dist    = length(in.clipPos.xy - in.agentPos);
    let falloff = 1.0 - smoothstep(0.0, p.shadowRadius, dist);
    return vec4<f32>(0.0, 0.0, 0.0, falloff * p.shadowStr);
}
