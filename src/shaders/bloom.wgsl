// ─── Bloom Post-Process Compute Shaders ──────────────────────────────────────
// Two entry points:
//   downsample — threshold + 2× downscale into bloomA
//   blur       — single-axis separable 9-tap Gaussian; used twice (H then V)
//
// Struct layout (32 bytes):
//   [0]  inputW      u32
//   [4]  inputH      u32
//   [8]  outputW     u32
//   [12] outputH     u32
//   [16] threshold   f32   (luminance threshold, e.g. 0.8)
//   [20] strength    f32   (unused in compute passes; used by blit)
//   [24] horizontal  u32   (1 = H blur, 0 = V blur; used in blur pass)
//   [28] radius      u32   (tap half-width, e.g. 4 → 9-tap kernel)

struct BloomParams {
    inputW:     u32,
    inputH:     u32,
    outputW:    u32,
    outputH:    u32,
    threshold:  f32,
    strength:   f32,
    horizontal: u32,
    radius:     u32,
}

@group(0) @binding(0) var<uniform> params:    BloomParams;
@group(0) @binding(1) var          inputSmp:  sampler;
@group(0) @binding(2) var          inputTex:  texture_2d<f32>;
@group(0) @binding(3) var          outputTex: texture_storage_2d<rgba16float, write>;

// ── 9-tap Gaussian weights (normalised, radius = 4) ───────────────────────────
// w[0]=center, w[1..4]=decreasing
fn gaussWeight(offset: i32) -> f32 {
    let w = array<f32, 5>(0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162);
    let a = abs(offset);
    if (a > 4) { return 0.0; }
    return w[a];
}

// ── Pass 1: downsample 2× + luminance threshold ───────────────────────────────
@compute @workgroup_size(8, 8)
fn downsample(@builtin(global_invocation_id) gid: vec3<u32>) {
    let ox = gid.x;
    let oy = gid.y;
    if (ox >= params.outputW || oy >= params.outputH) { return; }

    // Box-filter 2×2 from input
    let uv = (vec2<f32>(f32(ox), f32(oy)) + 0.5)
           / vec2<f32>(f32(params.outputW), f32(params.outputH));

    // 4-tap box (bilinear sampler gives us the average almost for free)
    let off = 0.5 / vec2<f32>(f32(params.inputW), f32(params.inputH));
    var c = textureSampleLevel(inputTex, inputSmp, uv + vec2<f32>(-off.x, -off.y), 0.0).rgb;
    c    += textureSampleLevel(inputTex, inputSmp, uv + vec2<f32>( off.x, -off.y), 0.0).rgb;
    c    += textureSampleLevel(inputTex, inputSmp, uv + vec2<f32>(-off.x,  off.y), 0.0).rgb;
    c    += textureSampleLevel(inputTex, inputSmp, uv + vec2<f32>( off.x,  off.y), 0.0).rgb;
    c    /= 4.0;

    // Luminance threshold
    let lum    = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
    let bright = max(c * ((lum - params.threshold) / max(lum, 0.001)), vec3<f32>(0.0));

    textureStore(outputTex, vec2<i32>(i32(ox), i32(oy)), vec4<f32>(bright, 1.0));
}

// ── Pass 2 (×2): separable Gaussian blur ─────────────────────────────────────
// Call once with horizontal=1, then again with horizontal=0, swapping I/O.
@compute @workgroup_size(8, 8)
fn blur(@builtin(global_invocation_id) gid: vec3<u32>) {
    let ox = gid.x;
    let oy = gid.y;
    if (ox >= params.outputW || oy >= params.outputH) { return; }

    var result      = vec3<f32>(0.0);
    var totalWeight = 0.0;
    let r = i32(params.radius);

    for (var off = -r; off <= r; off++) {
        let w = gaussWeight(off);
        if (w <= 0.0) { continue; }

        var sx = i32(ox);
        var sy = i32(oy);
        if (params.horizontal != 0u) {
            sx = clamp(sx + off, 0, i32(params.outputW) - 1);
        } else {
            sy = clamp(sy + off, 0, i32(params.outputH) - 1);
        }
        let uv = (vec2<f32>(f32(sx), f32(sy)) + 0.5)
               / vec2<f32>(f32(params.outputW), f32(params.outputH));
        result      += textureSampleLevel(inputTex, inputSmp, uv, 0.0).rgb * w;
        totalWeight += w;
    }

    textureStore(outputTex, vec2<i32>(i32(ox), i32(oy)),
                 vec4<f32>(result / max(totalWeight, 0.001), 1.0));
}
