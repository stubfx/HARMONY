// ─── Trail Decay Compute Shader ──────────────────────────────────────────────
// One thread per trail texel. Reads the previous frame's decay texture and the
// current frame's deposit texture. Applies exponential fade, optional B&W
// image/video overlay, mouse-eraser, and nuke.
//
// Struct layout (64 bytes):
//   [0]  trailWidth    u32
//   [4]  trailHeight   u32
//   [8]  canvasW       f32
//   [12] canvasH       f32
//   [16] decay         f32   (0..1  — fraction kept per nominal 60-fps frame)
//   [20] dt            f32
//   [24] hasMedia      u32   (bool)
//   [28] nukeTrail     u32   (bool — clear entire trail)
//   [32] mouseDown     u32   (bool)
//   [36] _pad          u32
//   [40] mouseX        f32   (canvas pixels)
//   [44] mouseY        f32   (canvas pixels)
//   [48] mouseRadius   f32   (canvas pixels)
//   [52] mediaStrength f32   (0..1  — how strongly media overrides trail)
//   [56] imageArea     f32   (canvas pixels — radius of strong attraction)
//   [60] imageReveal   f32   (canvas pixels — outer reveal fade radius)

struct DecayParams {
    trailWidth:    u32,
    trailHeight:   u32,
    canvasW:       f32,
    canvasH:       f32,
    decay:         f32,
    dt:            f32,
    hasMedia:      u32,
    nukeTrail:     u32,
    mouseDown:     u32,
    _pad:          u32,
    mouseX:        f32,
    mouseY:        f32,
    mouseRadius:   f32,
    mediaStrength: f32,
    imageArea:     f32,
    imageReveal:   f32,
}

@group(0) @binding(0) var<uniform> params:     DecayParams;
@group(0) @binding(1) var          trailSmp:   sampler;
@group(0) @binding(2) var          trailTex:   texture_2d<f32>;   // previous decay output
@group(0) @binding(3) var          depositTex: texture_2d<f32>;   // this frame's deposits
@group(0) @binding(4) var          mediaSmp:   sampler;
@group(0) @binding(5) var          mediaTex:   texture_2d<f32>;   // B&W image or video frame
@group(0) @binding(6) var          trailOut:   texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let tx = gid.x;
    let ty = gid.y;
    if (tx >= params.trailWidth || ty >= params.trailHeight) { return; }

    let coord = vec2<i32>(i32(tx), i32(ty));

    // ── Hard clear (nuke key) ─────────────────────────────────────────────────
    if (params.nukeTrail != 0u) {
        textureStore(trailOut, coord, vec4<f32>(0.0));
        return;
    }

    // ── Normalised UV for this texel (Y-down, same as trail/canvas convention) ─
    let uv = (vec2<f32>(f32(tx), f32(ty)) + 0.5)
           / vec2<f32>(f32(params.trailWidth), f32(params.trailHeight));

    // ── Decay + accumulate ────────────────────────────────────────────────────
    // Normalise decay coefficient to 60 fps so that the GUI value is frame-rate
    // independent.  pow(decay, dt * 60) keeps pheromone half-life constant.
    let prev    = textureSampleLevel(trailTex,    trailSmp, uv, 0.0).r;
    let deposit = textureSampleLevel(depositTex,  trailSmp, uv, 0.0).r;
    let keep    = pow(params.decay, params.dt * 60.0);
    var value   = prev * keep + deposit;

    // ── B&W image / video overlay ─────────────────────────────────────────────
    // Bright pixels become strong pheromone attractors. The effect is masked
    // by a smooth radial gradient centred on the trail texture.
    if (params.hasMedia != 0u) {
        let mediaRGBA   = textureSampleLevel(mediaTex, mediaSmp, uv, 0.0);
        // Average of R,G,B — works for both greyscale and colour media
        let brightness  = (mediaRGBA.r + mediaRGBA.g + mediaRGBA.b) / 3.0;
        // Only pixels brighter than 15% contribute; scale to a strong attractor
        let mediaVal    = select(0.0, brightness * 1000.0, brightness > 0.15);

        // Convert UV position to trail-pixel coordinates for distance test
        let trailCenter = vec2<f32>(f32(params.trailWidth), f32(params.trailHeight)) * 0.5;
        let trailPx     = uv * vec2<f32>(f32(params.trailWidth), f32(params.trailHeight));
        let dist        = length(trailPx - trailCenter);

        // Convert canvas-space radii to trail-texture-pixel radii
        let trailPerCanvas  = f32(params.trailWidth) / params.canvasW;
        let revealPx        = params.imageReveal * trailPerCanvas;
        let areaPx          = params.imageArea   * trailPerCanvas;

        if (dist < revealPx) {
            // Smooth fade: full effect at centre, zero at revealPx
            let t = smoothstep(1.0, 0.0, dist / max(areaPx, 0.001));
            value = mix(value, mediaVal, t * params.mediaStrength);
        }
    }

    // ── Mouse trail-eraser ────────────────────────────────────────────────────
    if (params.mouseDown != 0u) {
        let trailPerCanvas = f32(params.trailWidth) / params.canvasW;
        let mouseTX        = params.mouseX * trailPerCanvas;
        let mouseTY        = params.mouseY * trailPerCanvas;
        let pxPos          = vec2<f32>(f32(tx), f32(ty));
        let mousePx        = vec2<f32>(mouseTX, mouseTY);
        let eraseR         = params.mouseRadius * trailPerCanvas;
        if (length(pxPos - mousePx) < eraseR) {
            value = 0.0;
        }
    }

    textureStore(trailOut, coord, vec4<f32>(value, 0.0, 0.0, 1.0));
}
