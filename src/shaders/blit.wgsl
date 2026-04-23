struct BP { cutoff: f32, toneBlack: f32, toneWhite: f32, toneGamma: f32, shadowBoost: f32 }
@group(0) @binding(0) var<uniform> p: BP;
@group(0) @binding(1) var s: sampler;
@group(0) @binding(2) var t: texture_2d<f32>;
@group(0) @binding(3) var primedTex: texture_2d<f32>;
struct V { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
    var pts = array<vec2<f32>,3>(vec2(-1.,3.),vec2(3.,-1.),vec2(-1.,-1.));
    var uvs = array<vec2<f32>,3>(vec2(0.,-1.),vec2(2.,1.),vec2(0.,1.));
    return V(vec4<f32>(pts[i],0.,1.), uvs[i]);
}
@fragment fn fs(v: V) -> @location(0) vec4<f32> {
    // ── Free-agent layer: tone map then apply shadow boost ────────────────────
    let col    = textureSampleLevel(t, s, v.uv, 0.0);
    let range  = max(p.toneWhite - p.toneBlack, 0.001);
    var mapped = pow(clamp((col.rgb - p.toneBlack) / range, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(p.toneGamma));
    // Shadow boost: inverse-brightness weighting — darkest values get most boost,
    // bright values are unaffected. x*(1-x)^6 peaks near x=0.125 and is ~0 at x>0.6.
    let boost  = p.shadowBoost * mapped * pow(vec3<f32>(1.0) - mapped, vec3<f32>(6.0));
    mapped     = clamp(mapped + boost, vec3<f32>(0.0), vec3<f32>(1.0));
    let luma   = dot(mapped, vec3<f32>(0.299, 0.587, 0.114));
    let free   = select(mapped, vec3<f32>(0.0), luma < p.cutoff);

    // ── Primed layer: composited on top without tone mapping ──────────────────
    // Alpha accumulates additively; divide by it to recover the per-agent color.
    let primed_raw   = textureSampleLevel(primedTex, s, v.uv, 0.0);
    let primed_alpha = clamp(primed_raw.a, 0.0, 1.0);
    let primed_color = clamp(primed_raw.rgb / max(primed_raw.a, 0.001), vec3<f32>(0.0), vec3<f32>(1.0));

    return vec4<f32>(mix(free, primed_color, primed_alpha), 1.0);
}
