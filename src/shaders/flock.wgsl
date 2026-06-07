// ─── Flock Field Pass ─────────────────────────────────────────────────────────
// Renders a soft splat per agent into a low-res velocity+density field. Additive
// blend accumulates, per texel:
//   R = Σ w·vel.x   G = Σ w·vel.y   B = Σ w (density)   A = Σ w
// The compute shader reads this to derive the local average velocity (alignment)
// and the density gradient (cohesion / separation), without any neighbour search.
// This is a field-based approximation of Boids that fits the GPGPU pipeline.
//
// FlockParams layout (16 bytes):
//   [0]  canvasW  f32
//   [4]  canvasH  f32
//   [8]  radius   f32  (splat half-extent in canvas pixels)
//   [12] _pad     f32

struct FlockParams {
    canvasW: f32,
    canvasH: f32,
    radius:  f32,
    _pad:    f32,
}

struct Agent {
    pos:    vec2<f32>,
    vel:    vec2<f32>,
    home:   vec2<f32>,
    weight: f32,
    primed: f32,
}

@group(0) @binding(0) var<uniform>       p:      FlockParams;
@group(0) @binding(1) var<storage, read> agents: array<Agent>;

struct VsOut {
    @builtin(position) clipPos: vec4<f32>,
    @location(0)       local:   vec2<f32>,   // quad-local coord in [-1, 1]
    @location(1)       vel:     vec2<f32>,
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
    let agentId = vi / 6u;
    let corner  = vi % 6u;

    let corners = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0,  1.0),
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0,  1.0), vec2<f32>(-1.0, 1.0),
    );

    let a = agents[agentId];
    let c = corners[corner];

    let ndc = vec2<f32>(
         a.pos.x / p.canvasW * 2.0 - 1.0,
        -(a.pos.y / p.canvasH * 2.0 - 1.0),
    );
    let halfW = p.radius / p.canvasW;
    let halfH = p.radius / p.canvasH;
    let clip  = vec4<f32>(ndc + c * vec2<f32>(halfW, halfH) * 2.0, 0.0, 1.0);

    return VsOut(clip, c, a.vel);
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
    // Radial falloff from the quad-local coordinate — resolution-independent,
    // so the field texture can be rendered at any (low) resolution.
    let d       = length(in.local);
    let falloff = 1.0 - smoothstep(0.0, 1.0, d);
    if (falloff <= 0.0) { return vec4<f32>(0.0); }
    return vec4<f32>(in.vel * falloff, falloff, falloff);
}
