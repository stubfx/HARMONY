struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@group(0) @binding(0) var trailSampler : sampler;
@group(0) @binding(1) var trailTexture : texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vertexIndex : u32) -> VSOut {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  let pos = positions[vertexIndex];
  var out : VSOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = (pos + vec2<f32>(1.0, 1.0)) * 0.5;
  return out;
}

@fragment
fn fs(input : VSOut) -> @location(0) vec4<f32> {
  let color = textureSampleLevel(trailTexture, trailSampler, input.uv, 0.0);
  return vec4<f32>(color.rgb, 1.0);
}
