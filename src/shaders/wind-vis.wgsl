// Wind visualisation: red arrows drawn on the canvas at a ~100px grid.
// NOTE: evalWindFormula() must be prepended at pipeline build time (same as compute.wgsl).
struct WP { canvasW:f32, canvasH:f32, time:f32, gridStep:f32, arrowLen:f32, gridW:u32, _p0:u32, _p1:u32 }
@group(0) @binding(0) var<uniform> p: WP;
struct V { @builtin(position) pos: vec4<f32>, @location(0) bright: f32 }
const PI:f32 = 3.14159265358979; const TWO_PI:f32 = 6.28318530717959;
@vertex fn vs(@builtin(vertex_index) vi: u32) -> V {
    let ai  = vi / 6u;
    let seg = (vi % 6u) / 2u;
    let isB = (vi % 2u) == 1u;
    let gx  = ai % p.gridW;
    let gy  = ai / p.gridW;
    let cx  = p.canvasW * 0.5;  let cy = p.canvasH * 0.5;
    let px  = (f32(gx) + 0.5) * p.gridStep;
    let py  = (f32(gy) + 0.5) * p.gridStep;
    let angle = evalWindFormula(px, py, p.time, f32(ai), cx, cy);
    let dir   = vec2<f32>(cos(angle), sin(angle));
    let perp  = vec2<f32>(-dir.y, dir.x);
    let half  = p.arrowLen * 0.5;
    let tip   = vec2<f32>(px, py) + dir * half;
    let tail  = vec2<f32>(px, py) - dir * half;
    let hlen  = p.arrowLen * 0.28;
    let hwid  = p.arrowLen * 0.16;
    var pos: vec2<f32>;
    var bright: f32;
    if (seg == 0u) {
        pos = select(tail, tip, isB);  bright = select(0.15, 1.0, isB);
    } else if (seg == 1u) {
        pos = select(tip, tip - dir * hlen + perp * hwid, isB);  bright = select(1.0, 0.45, isB);
    } else {
        pos = select(tip, tip - dir * hlen - perp * hwid, isB);  bright = select(1.0, 0.45, isB);
    }
    let ndc = vec2<f32>(pos.x / p.canvasW * 2.0 - 1.0, -(pos.y / p.canvasH * 2.0 - 1.0));
    return V(vec4<f32>(ndc, 0.0, 1.0), bright);
}
@fragment fn fs(v: V) -> @location(0) vec4<f32> { return vec4<f32>(v.bright, 0.0, 0.0, 1.0); }
