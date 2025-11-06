struct Agent {
  pos : vec2<f32>,
  vel : vec2<f32>,
};

struct DepositUniforms {
  canvasSize : vec2<f32>,
  trailSize : vec2<f32>,
  pointSize : f32,
  strength : f32,
  dt : f32,
  edgeSoft : f32,
  champInterval : f32,
  champMultiplier : f32,
  _pad : vec2<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) champ : f32,
};

@group(0) @binding(0) var<storage, read> agents : array<Agent>;
@group(0) @binding(1) var<uniform> uniforms : DepositUniforms;

fn quadVertex(i : u32) -> vec2<f32> {
  let quad = array<vec2<f32>, 6>(
    vec2<f32>(-0.5, -0.5),
    vec2<f32>( 0.5, -0.5),
    vec2<f32>(-0.5,  0.5),
    vec2<f32>(-0.5,  0.5),
    vec2<f32>( 0.5, -0.5),
    vec2<f32>( 0.5,  0.5)
  );
  return quad[i];
}

@vertex
fn vs(@builtin(vertex_index) vertexIndex : u32,
      @builtin(instance_index) instanceIndex : u32) -> VSOut {
  let agent = agents[instanceIndex];
  let offset = quadVertex(vertexIndex);
  let pointSize = uniforms.pointSize;
  let pointOffset = offset * pointSize;

  let trailPos = agent.pos * (uniforms.trailSize / uniforms.canvasSize);
  let corner = trailPos + pointOffset;
  var clip = vec2<f32>(corner / uniforms.trailSize * 2.0 - vec2<f32>(1.0, 1.0));
  clip.y = -clip.y;

  var output : VSOut;
  output.position = vec4<f32>(clip, 0.0, 1.0);
  output.uv = offset + vec2<f32>(0.5, 0.5);

  if (uniforms.champInterval > 0.5) {
    let champIdx = u32(uniforms.champInterval);
    output.champ = select(0.0, 1.0, (instanceIndex % champIdx) == 0u);
  } else {
    output.champ = 0.0;
  }
  return output;
}

@fragment
fn fs(input : VSOut) -> @location(0) vec4<f32> {
  let d = distance(input.uv, vec2<f32>(0.5, 0.5));
  let edge = uniforms.edgeSoft;
  let m = smoothstep(0.5, edge, d) * uniforms.strength * uniforms.dt;
  let champMul = select(1.0, uniforms.champMultiplier, input.champ > 0.5);
  let deposit = m * champMul;
  return vec4<f32>(deposit, 0.0, 0.0, 1.0);
}
