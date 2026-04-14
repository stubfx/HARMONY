// Image debug: grayscale overlay of the image region with the vignette circle applied.
// DP layout (32 bytes): canvasW, canvasH, x0, y0, x1, y1, _p0, _p1
struct DP { canvasW:f32, canvasH:f32, x0:f32, y0:f32, x1:f32, y1:f32, _p0:u32, _p1:u32 }
@group(0) @binding(0) var<uniform> p: DP;
@group(0) @binding(1) var s: sampler;
@group(0) @binding(2) var t: texture_2d<f32>;
struct V { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
    var lo = array<vec2<f32>,6>(
        vec2(0.,0.), vec2(1.,0.), vec2(1.,1.),
        vec2(0.,0.), vec2(1.,1.), vec2(0.,1.),
    );
    let lp  = lo[i];
    let px  = p.x0 + lp.x * (p.x1 - p.x0);
    let py  = p.y0 + lp.y * (p.y1 - p.y0);
    let ndc = vec2<f32>(px / p.canvasW * 2.0 - 1.0, -(py / p.canvasH * 2.0 - 1.0));
    return V(vec4<f32>(ndc, 0., 1.), lp);
}
@fragment fn fs(v: V) -> @location(0) vec4<f32> {
    let c = textureSampleLevel(t, s, v.uv, 0.0);
    let luma = dot(c.rgb, vec3<f32>(0.299, 0.587, 0.114));
    return vec4<f32>(luma, luma, luma, c.a * 0.6);
}
