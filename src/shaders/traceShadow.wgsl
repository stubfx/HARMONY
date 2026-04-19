// ─── Trace Shadow Pass ────────────────────────────────────────────────────────
// Renders a blurred black shadow onto the offscreen trail texture wherever the
// trace layer (imageTex) has content. Runs after the fade pass but before agents
// are drawn, so agents accumulate additively on top of the shadow each frame.
//
// The blur is a 5×5 box filter (25 taps) centred on each canvas pixel, with tap
// spacing = shadowRadius / 2. This spreads the shadow by ±shadowRadius pixels
// beyond the trace content edges, softening the boundary between the dark zone
// and the open field.
//
// ShadowParams layout (48 bytes):
//   [0]  canvasW        f32
//   [4]  canvasH        f32
//   [8]  imgX0          f32
//   [12] imgY0          f32
//   [16] imgX1          f32
//   [20] imgY1          f32
//   [24] shadowStr      f32   (opacity of the black shadow, 0–1)
//   [28] shadowRadius   f32   (blur spread in canvas pixels)
//   [32] hasImage       u32   (0 = no trace active, skip entirely)
//   [36] blackThreshold f32   (luminance below which pixels are treated as empty)

struct ShadowParams {
    canvasW:        f32,
    canvasH:        f32,
    imgX0:          f32,
    imgY0:          f32,
    imgX1:          f32,
    imgY1:          f32,
    shadowStr:      f32,
    shadowRadius:   f32,
    hasImage:       u32,
    blackThreshold: f32,
    _p0:            u32,
    _p1:            u32,
}

@group(0) @binding(0) var<uniform> p:   ShadowParams;
@group(0) @binding(1) var          smp: sampler;
@group(0) @binding(2) var          tex: texture_2d<f32>;

struct V { @builtin(position) pos: vec4<f32> }

@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
    var pts = array<vec2<f32>, 3>(vec2(-1., 3.), vec2(3., -1.), vec2(-1., -1.));
    return V(vec4<f32>(pts[i], 0., 1.));
}

// Returns the effective trace alpha at a canvas-pixel position.
// Mirrors the logic in compute.wgsl imgAlphaAt but without vignette or
// alpha-threshold gating — for a shadow we want continuous soft coverage.
fn traceAlphaAt(canvasPx: vec2<f32>) -> f32 {
    let uv = vec2<f32>(
        (canvasPx.x - p.imgX0) / (p.imgX1 - p.imgX0),
        (canvasPx.y - p.imgY0) / (p.imgY1 - p.imgY0),
    );
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 0.0; }
    let s    = textureSampleLevel(tex, smp, clamp(uv, vec2(0.0), vec2(1.0)), 0.0);
    let luma = dot(s.rgb, vec3<f32>(0.299, 0.587, 0.114));
    if (luma < p.blackThreshold && s.a < 0.05) { return 0.0; }
    return max(s.a, luma);
}

@fragment fn fs(v: V) -> @location(0) vec4<f32> {
    if (p.hasImage == 0u) { return vec4<f32>(0.0); }

    let pos  = v.pos.xy;
    let step = p.shadowRadius * 0.5;

    // 5×5 box blur — 25 taps, spacing = shadowRadius/2 → covers ±shadowRadius
    var total = 0.0;
    for (var dx = -2; dx <= 2; dx++) {
        for (var dy = -2; dy <= 2; dy++) {
            total += traceAlphaAt(pos + vec2<f32>(f32(dx), f32(dy)) * step);
        }
    }
    total /= 25.0;

    return vec4<f32>(0.0, 0.0, 0.0, total * p.shadowStr);
}
