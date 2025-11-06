struct TrailUniforms {
  trailSize : vec2<f32>,
  keep : f32,
  nuke : f32,
  _pad : vec2<f32>,
};

@group(0) @binding(0) var prevTrail : texture_2d<f32>;
@group(0) @binding(1) var depositTex : texture_2d<f32>;
@group(0) @binding(2) var trailOut : texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> uniforms : TrailUniforms;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= u32(uniforms.trailSize.x) || gid.y >= u32(uniforms.trailSize.y)) {
    return;
  }
  let coord = vec2<i32>(i32(gid.x), i32(gid.y));
  var current = textureLoad(prevTrail, coord, 0);
  let deposit = textureLoad(depositTex, coord, 0);
  current = current * uniforms.keep + deposit;
  if (uniforms.nuke > 0.5) {
    current = vec4<f32>(0.0);
  }
  textureStore(trailOut, coord, current);
}
