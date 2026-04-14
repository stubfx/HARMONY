struct BP { cutoff: f32, _0: u32, _1: u32, _2: u32 }
@group(0) @binding(0) var<uniform> p: BP;
@group(0) @binding(1) var s: sampler;
@group(0) @binding(2) var t: texture_2d<f32>;
struct V { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
    var pts = array<vec2<f32>,3>(vec2(-1.,3.),vec2(3.,-1.),vec2(-1.,-1.));
    var uvs = array<vec2<f32>,3>(vec2(0.,-1.),vec2(2.,1.),vec2(0.,1.));
    return V(vec4<f32>(pts[i],0.,1.), uvs[i]);
}
@fragment fn fs(v: V) -> @location(0) vec4<f32> {
    let col  = textureSampleLevel(t, s, v.uv, 0.0);
    let luma = dot(col.rgb, vec3<f32>(0.299, 0.587, 0.114));
    if (luma < p.cutoff) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
    return col;
}
