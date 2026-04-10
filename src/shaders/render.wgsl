// ─── Trail Render Shader ──────────────────────────────────────────────────────
// Entry points: trailVs / trailFs
//
// TrailRenderParams layout (32 bytes):
//   [0]  canvasW    f32
//   [4]  canvasH    f32
//   [8]  brightness f32   (exposure multiplier for trail density → visible range)
//   [12] alpha      f32   (0 = invisible, 1 = fully visible)
//   [16] colorR     f32
//   [20] colorG     f32
//   [24] colorB     f32
//   [28] _pad       f32

// ═════════════════════════════════════════════════════════════════════════════
// TRAIL BACKGROUND
// ═════════════════════════════════════════════════════════════════════════════

struct TrailRenderParams {
    canvasW:    f32,
    canvasH:    f32,
    brightness: f32,
    alpha:      f32,
    colorR:     f32,
    colorG:     f32,
    colorB:     f32,
    _pad:       f32,
}

@group(0) @binding(0) var<uniform> trailParams: TrailRenderParams;
@group(0) @binding(1) var          trailSmp:    sampler;
@group(0) @binding(2) var          trailTex:    texture_2d<f32>;

struct TrailVsOut {
    @builtin(position) pos: vec4<f32>,
    @location(0)       uv:  vec2<f32>,
}

// Full-screen triangle trick (covers entire NDC [-1,1] × [-1,1])
@vertex fn trailVs(@builtin(vertex_index) vi: u32) -> TrailVsOut {
    // vertex 0: (-1, 1, 0) UV(0,0) top-left
    // vertex 1: ( 3, 1, 0) UV(2,0)
    // vertex 2: (-1,-3, 0) UV(0,2)
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
    return TrailVsOut(vec4<f32>(pos[vi], 0.0, 1.0), uv[vi]);
}

@fragment fn trailFs(in: TrailVsOut) -> @location(0) vec4<f32> {
    // in.uv is in [0,1] for the visible screen, Y-down (matching trail texture)
    let density    = textureSampleLevel(trailTex, trailSmp, in.uv, 0.0).r;
    // Exposure tone-map: maps [0,∞) density to [0,1] brightness
    let lum        = 1.0 - exp(-density * trailParams.brightness);
    let color      = vec3<f32>(trailParams.colorR, trailParams.colorG, trailParams.colorB);
    return vec4<f32>(color * lum * trailParams.alpha, trailParams.alpha);
}

