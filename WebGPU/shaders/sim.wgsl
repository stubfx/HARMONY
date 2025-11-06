struct Agent {
  pos : vec2<f32>,
  vel : vec2<f32>,
};

struct SimUniforms {
  canvasSize : vec2<f32>,
  trailSize : vec2<f32>,
  time : f32,
  dt : f32,
  drag : f32,
  stepLen : f32,
  senseDist : f32,
  senseAngle : f32,
  turnRate : f32,
  turnJitter : f32,
  agentCount : f32,
  _pad0 : f32,
  _pad1 : vec2<f32>,
};

@group(0) @binding(0) var<storage, read> stateIn : array<Agent>;
@group(0) @binding(1) var<storage, read_write> stateOut : array<Agent>;
@group(0) @binding(2) var<uniform> uniforms : SimUniforms;
@group(0) @binding(3) var trailSampler : sampler;
@group(0) @binding(4) var trailTexture : texture_2d<f32>;

fn rotate(v : vec2<f32>, radians : f32) -> vec2<f32> {
  let c = cos(radians);
  let s = sin(radians);
  return vec2<f32>(c * v.x - s * v.y, s * v.x + c * v.y);
}

fn sampleTrail(pos : vec2<f32>) -> f32 {
  let uv = clamp(pos / uniforms.canvasSize, vec2<f32>(0.0), vec2<f32>(1.0));
  return textureSampleLevel(trailTexture, trailSampler, uv, 0.0).r;
}

fn hash11(p : f32) -> f32 {
  return fract(sin(p) * 43758.5453123);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let index = gid.x;
  if (f32(index) >= uniforms.agentCount) {
    return;
  }

  let agent = stateIn[index];
  var pos = agent.pos;
  var vel = agent.vel;

  let speed = length(vel);
  var dir = vec2<f32>(1.0, 0.0);
  if (speed > 1e-6) {
    dir = vel / speed;
  }

  let forward = sampleTrail(pos + uniforms.senseDist * dir);
  let left = sampleTrail(pos + uniforms.senseDist * rotate(dir, uniforms.senseAngle));
  let right = sampleTrail(pos + uniforms.senseDist * rotate(dir, -uniforms.senseAngle));

  let rnd = hash11(f32(index) * 12.9898 + uniforms.time * 78.233);
  let noise = (rnd * 2.0 - 1.0) * uniforms.turnJitter;

  var turnUnit = noise;
  if (forward < left && forward < right) {
    turnUnit = noise;
  } else if (right > left) {
    turnUnit = -1.0 + noise;
  } else if (left > right) {
    turnUnit = 1.0 + noise;
  }
  turnUnit = clamp(turnUnit, -1.0, 1.0);

  let maxTurn = uniforms.turnRate * uniforms.dt;
  let dTheta = turnUnit * maxTurn;
  vel = rotate(vel, dTheta);

  let target = uniforms.stepLen;
  let drag = exp(-uniforms.drag * uniforms.dt);
  let newSpeed = mix(target, length(vel), drag);
  if (length(vel) > 1e-6) {
    vel = normalize(vel) * newSpeed;
  } else {
    vel = dir * newSpeed;
  }

  pos = pos + vel * uniforms.dt;

  if (pos.x < 0.0) {
    pos.x = pos.x + uniforms.canvasSize.x;
  }
  if (pos.x >= uniforms.canvasSize.x) {
    pos.x = pos.x - uniforms.canvasSize.x;
  }
  if (pos.y < 0.0) {
    pos.y = pos.y + uniforms.canvasSize.y;
  }
  if (pos.y >= uniforms.canvasSize.y) {
    pos.y = pos.y - uniforms.canvasSize.y;
  }

  stateOut[index] = Agent(pos, vel);
}
