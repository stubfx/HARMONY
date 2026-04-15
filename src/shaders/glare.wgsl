// ─── Bloom composite pass ─────────────────────────────────────────────────────
// Fullscreen quad that samples the downsampled+blurred bloom texture (bloomA)
// and composites it additively over the final canvas output.
//
// The bloom texture is produced by bloom.wgsl (downsample → blur H → blur V),
// written to bloomA at half canvas resolution. This pass reads it and adds it
// back scaled by a colour tint and intensity.
//
// Reactive sources are pre-computed in JS (writeGlareUB) and folded into
// `intensity` and `colorR/G/B` before upload — the shader itself is stateless:
//   1. Join pulse      — burstBrightness spikes intensity on spectator join
//   2. Temperature     — tints colour cold-white ↔ warm-white via smoothTemp
//   3. Spectator count — intensity scales linearly as the room fills
//   4. QR mode         — intensity damps to 0.3× while QR is showing (EMA)
//   5. Coherence       — reserved: wire to bloomRadius in writeBloomUBs to
//                        tighten the blur kernel as order rises
//
// Blend mode: src-alpha / one (additive) — only adds light, never darkens.
//
// BloomCompositeParams layout (16 bytes):
//   [0]  colorR    f32  — tinted colour red   (pre-computed in JS)
//   [4]  colorG    f32  — tinted colour green
//   [8]  colorB    f32  — tinted colour blue
//   [12] intensity f32  — effective brightness (all reactivity folded in)

struct BloomCompositeParams {
    colorR:    f32,
    colorG:    f32,
    colorB:    f32,
    intensity: f32,
}

@group(0) @binding(0) var<uniform> params:   BloomCompositeParams;
@group(0) @binding(1) var          bloomSmp: sampler;
@group(0) @binding(2) var          bloomTex: texture_2d<f32>;

struct VsOut {
    @builtin(position) pos: vec4<f32>,
    @location(0)       uv:  vec2<f32>,
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
    let corners = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0,  1.0),
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0,  1.0), vec2<f32>(-1.0, 1.0),
    );
    let p = corners[vi];
    return VsOut(
        vec4<f32>(p, 0.0, 1.0),
        p * 0.5 + vec2<f32>(0.5),  // UV [0,1], origin top-left
    );
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let bloom = textureSampleLevel(bloomTex, bloomSmp, in.uv, 0.0);
    // Drive additive alpha from bloom luminance so dim areas stay transparent.
    let lum = dot(bloom.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let col = bloom.rgb * vec3<f32>(params.colorR, params.colorG, params.colorB);
    return vec4<f32>(col, lum * params.intensity);
}
