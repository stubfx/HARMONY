// ─── Final Blit / Composite Render Shader ────────────────────────────────────
// Fullscreen triangle that additively composites the scene texture with the
// bloom texture, then applies simple gamma correction before writing to the
// swap-chain surface.
//
// BlitParams layout (16 bytes):
//   [0]  bloomStrength f32   (0 = no bloom, 0.5 = subtle glow)
//   [4]  gamma         f32   (typical 2.2)
//   [8]  _pad0         u32
//   [12] _pad1         u32

struct BlitParams {
    bloomStrength: f32,
    gamma:         f32,
    _pad0:         u32,
    _pad1:         u32,
}

@group(0) @binding(0) var<uniform> params:     BlitParams;
@group(0) @binding(1) var          screenSmp:  sampler;
@group(0) @binding(2) var          sceneTex:   texture_2d<f32>;
@group(0) @binding(3) var          bloomTex:   texture_2d<f32>;

struct VsOut {
    @builtin(position) pos: vec4<f32>,
    @location(0)       uv:  vec2<f32>,
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
    var pos = array<vec2<f32>, 3>(
        vec2<f32>(-1.0,  3.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0, -1.0),
    );
    var uv = array<vec2<f32>, 3>(
        vec2<f32>(0.0, -1.0),
        vec2<f32>(2.0,  1.0),
        vec2<f32>(0.0,  1.0),
    );
    return VsOut(vec4<f32>(pos[vi], 0.0, 1.0), uv[vi]);
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let scene = textureSampleLevel(sceneTex,  screenSmp, in.uv, 0.0).rgb;
    let bloom = textureSampleLevel(bloomTex,  screenSmp, in.uv, 0.0).rgb;
    var color = scene + bloom * params.bloomStrength;

    // Gamma correction
    let g = max(params.gamma, 0.01);
    color = pow(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / g));

    return vec4<f32>(color, 1.0);
}
