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
// × shadowStr × proximityT, blended with src-alpha / one-minus-src-alpha to darken
// the trail. Shadow strengthens as the agent closes in on its home pixel.
//
// AgentShadowParams layout (32 bytes):
//   [0]  canvasW              f32
//   [4]  canvasH              f32
//   [8]  shadowRadius         f32   (quad half-extent in canvas pixels)
//   [12] shadowStr            f32   (peak shadow opacity, 0–1)
//   [16] hasImage             u32
//   [20] homingProximityRange f32   (canvas px over which shadow fades in)
//   [24] homingMinAlpha       f32   (minimum shadow alpha at max distance)
//   [28] _p2                  u32

struct AgentShadowParams {
    canvasW:              f32,
    canvasH:              f32,
    shadowRadius:         f32,
    shadowStr:            f32,
    hasImage:             u32,
    homingProximityRange: f32,
    homingMinAlpha:       f32,
    _p2:                  u32,
}

struct Agent {
    pos:    vec2<f32>,
    vel:    vec2<f32>,
    home:   vec2<f32>,
    weight: f32,
    primed: f32,   // 1.0 = homing, 0.0 = free — written by compute each frame
}

// Mirrors ContamParams in compute.wgsl — same 176-byte layout.
struct ContamParams {
    count:  u32,
    radius: f32,
    push:   u32,
    _p0:    u32,
    points: array<vec4<f32>, 10>,
}

@group(0) @binding(0) var<uniform>       p:      AgentShadowParams;
@group(0) @binding(1) var<storage, read> agents: array<Agent>;
@group(0) @binding(2) var<uniform>       contam: ContamParams;

struct VsOut {
    @builtin(position) clipPos:    vec4<f32>,
    @location(0)       agentPos:   vec2<f32>,  // agent centre in canvas pixels
    @location(1)       isHoming:   f32,
    @location(2)       proximityT: f32,         // 0 = far from home, 1 = at home
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
    let agentId = vi / 6u;
    let corner  = vi % 6u;

    let corners = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0,  1.0),
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0,  1.0), vec2<f32>(-1.0, 1.0),
    );

    let agent    = agents[agentId];
    var isHoming = agent.primed;   // read flag written by compute — no texture lookup needed

    // Suppress shadow when the agent's current position is inside an eraser circle.
    // compute already zeroes primed for agents whose HOME is contaminated; this covers
    // agents that are passing through the eraser area while homing elsewhere.
    if (isHoming > 0.5 && contam.count > 0u) {
        for (var k = 0u; k < contam.count; k++) {
            if (length(agent.pos - contam.points[k].xy) <= contam.radius) {
                isHoming = 0.0;
                break;
            }
        }
    }

    // Proximity factor: shadow strengthens as the agent closes in on its home pixel.
    let distToHome = length(agent.pos - agent.home);
    let rawT       = 1.0 - clamp(distToHome / max(p.homingProximityRange, 1.0), 0.0, 1.0);
    let proximityT = mix(p.homingMinAlpha, 1.0, rawT);

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

    return VsOut(clipPos, agent.pos, isHoming, proximityT);
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
    if (in.isHoming < 0.5) { return vec4<f32>(0.0); }
    // @builtin(position).xy gives the fragment centre in canvas (framebuffer) pixels,
    // matching the canvas-pixel space of agent.pos — distance is in canvas pixels.
    let dist    = length(in.clipPos.xy - in.agentPos);
    let falloff = 1.0 - smoothstep(0.0, p.shadowRadius, dist);
    return vec4<f32>(0.0, 0.0, 0.0, falloff * p.shadowStr * in.proximityT);
}

// Density pass — renders bright greyscale shadow into the shadow density texture.
// Cleared to black each frame; additive blend makes overlapping agents accumulate.
// Brightness = shadow strength at each fragment; compute probe reads this as a
// continuous deterrent signal (brighter = denser swarm = stronger avoidance).
@fragment fn fs_density(in: VsOut) -> @location(0) vec4<f32> {
    if (in.isHoming < 0.5) { return vec4<f32>(0.0); }
    let dist    = length(in.clipPos.xy - in.agentPos);
    let falloff = 1.0 - smoothstep(0.0, p.shadowRadius, dist);
    let v       = falloff * p.shadowStr * in.proximityT;
    return vec4<f32>(v, v, v, 1.0);
}
