struct FP { alpha: f32, _0: u32, _1: u32, _2: u32 }
@group(0) @binding(0) var<uniform> p: FP;
struct V { @builtin(position) pos: vec4<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
    var pts = array<vec2<f32>,3>(vec2(-1.,3.),vec2(3.,-1.),vec2(-1.,-1.));
    return V(vec4<f32>(pts[i], 0., 1.));
}
@fragment fn fs(v: V) -> @location(0) vec4<f32> { return vec4(0.,0.,0.,p.alpha); }
