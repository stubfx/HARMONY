// ─── Pixel-grid downsample pass ──────────────────────────────────────────────
// Each fragment of the destination texture (gridTex, sized cellsW × cellsH) is
// one cell. The shader averages an 8×8 tap grid spanning the cell's source
// region in the full-res offscreen texture. The linear sampler bilinearly
// blends ~4 source texels per tap, so the effective coverage is ~256 source
// texels per cell — enough to act as a true area average for typical defaults
// (1920 px canvas at 120 cells → 16×16 source texels per cell, covered).
//
// Runs before the blit. The blit then samples gridTex with nearest filtering,
// producing the chunky look.

struct Params {
    cellsW: f32,
    cellsH: f32,
    _p0:    f32,
    _p1:    f32,
}

@group(0) @binding(0) var<uniform> p:   Params;
@group(0) @binding(1) var          smp: sampler;
@group(0) @binding(2) var          src: texture_2d<f32>;

struct V { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> }

@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
    var pts = array<vec2<f32>,3>(vec2(-1.,3.),vec2(3.,-1.),vec2(-1.,-1.));
    var uvs = array<vec2<f32>,3>(vec2(0.,-1.),vec2(2.,1.),vec2(0.,1.));
    return V(vec4<f32>(pts[i],0.,1.), uvs[i]);
}

@fragment fn fs(v: V) -> @location(0) vec4<f32> {
    let cellSizeUV = vec2<f32>(1.0 / p.cellsW, 1.0 / p.cellsH);
    const TAPS: i32 = 8;
    var sum = vec4<f32>(0.0);
    for (var ty: i32 = 0; ty < TAPS; ty = ty + 1) {
        for (var tx: i32 = 0; tx < TAPS; tx = tx + 1) {
            let offsetNorm = (vec2<f32>(f32(tx), f32(ty)) + 0.5) / f32(TAPS) - 0.5;
            let uv = v.uv + offsetNorm * cellSizeUV;
            sum = sum + textureSampleLevel(src, smp, uv, 0.0);
        }
    }
    return sum / f32(TAPS * TAPS);
}
