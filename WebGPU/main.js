import simShader from './shaders/sim.wgsl?raw';
import depositShader from './shaders/deposit.wgsl?raw';
import trailShader from './shaders/trail.wgsl?raw';
import fullscreenShader from './shaders/fullscreen.wgsl?raw';

const params = {
  TEX_SIDE: 1500,
  TRAIL_TEX_RES: 0.4,
  STEP_LEN: 70.0,
  DRAG: 0.5,
  TURN_JITTER: 0.1,
  SENSE_DIST: 20.0,
  SENSE_ANGLE: 0.2,
  TURN_RATE: 20.0,
  DEPOSIT_SIZE: 2.0,
  DEPOSIT_STRENGTH: 10.0,
  DEPOSIT_EDGE_SOFT: 0.0,
  CHAMP_SAMPLE_INTERVAL: 50000.0,
  CHAMP_IMP_MULTIPLIER: 2.0,
  TRAIL_DECAY: 0.89,
  SPAWN_RADIUS: 200.0,
};

const canvas = document.getElementById('sim');
const fpsSpan = document.getElementById('fps');
const agentSpan = document.getElementById('agentCount');
const decaySpan = document.getElementById('decay');
const buildSpan = document.getElementById('build');

const buildDate = new Date().toISOString();
if (buildSpan) {
  buildSpan.textContent = buildDate;
}

const agentCount = params.TEX_SIDE * params.TEX_SIDE;
if (agentSpan) {
  agentSpan.textContent = agentCount.toLocaleString();
}
if (decaySpan) {
  decaySpan.textContent = params.TRAIL_DECAY.toFixed(3);
}

if (!navigator.gpu) {
  throw new Error('WebGPU not supported in this browser.');
}

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
  throw new Error('Failed to acquire GPU adapter');
}
const device = await adapter.requestDevice();

const context = canvas.getContext('webgpu');
const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

let canvasWidth = 0;
let canvasHeight = 0;
let trailWidth = 0;
let trailHeight = 0;
let stateIndex = 0;
let trailIndex = 0;

const linearSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
  addressModeU: 'repeat',
  addressModeV: 'repeat',
});

const nearestSampler = device.createSampler({
  magFilter: 'nearest',
  minFilter: 'nearest',
  addressModeU: 'repeat',
  addressModeV: 'repeat',
});

const simPipeline = device.createComputePipeline({
  layout: 'auto',
  compute: {
    module: device.createShaderModule({ code: simShader }),
    entryPoint: 'main',
  },
});

const depositPipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex: {
    module: device.createShaderModule({ code: depositShader }),
    entryPoint: 'vs',
  },
  fragment: {
    module: device.createShaderModule({ code: depositShader }),
    entryPoint: 'fs',
    targets: [
      {
        format: 'rgba16float',
        blend: {
          color: {
            srcFactor: 'one',
            dstFactor: 'one',
            operation: 'add',
          },
          alpha: {
            srcFactor: 'one',
            dstFactor: 'one',
            operation: 'add',
          },
        },
      },
    ],
  },
  primitive: {
    topology: 'triangle-list',
  },
});

const trailPipeline = device.createComputePipeline({
  layout: 'auto',
  compute: {
    module: device.createShaderModule({ code: trailShader }),
    entryPoint: 'main',
  },
});

const fullscreenModule = device.createShaderModule({ code: fullscreenShader });
const fullscreenPipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex: {
    module: fullscreenModule,
    entryPoint: 'vs',
  },
  fragment: {
    module: fullscreenModule,
    entryPoint: 'fs',
    targets: [
      {
        format: presentationFormat,
        blend: {
          color: {
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
          },
          alpha: {
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
          },
        },
      },
    ],
  },
  primitive: {
    topology: 'triangle-list',
  },
});

const stateBufferSize = agentCount * 4 * Float32Array.BYTES_PER_ELEMENT;
const stateBuffers = [0, 1].map(() =>
  device.createBuffer({
    size: stateBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
);

const simUniformSize = 16 * Float32Array.BYTES_PER_ELEMENT;
const depositUniformSize = 16 * Float32Array.BYTES_PER_ELEMENT;
const trailUniformSize = 8 * Float32Array.BYTES_PER_ELEMENT;

const simUniformBuffer = device.createBuffer({
  size: simUniformSize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const depositUniformBuffer = device.createBuffer({
  size: depositUniformSize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const trailUniformBuffer = device.createBuffer({
  size: trailUniformSize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

let depositTexture = null;
let depositView = null;
let trailTextures = [];
let trailViews = [];

function createTrailResources() {
  const width = trailWidth;
  const height = trailHeight;
  const textureDescriptor = {
    size: { width, height },
    format: 'rgba16float',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.STORAGE_BINDING,
  };

  trailTextures = [
    device.createTexture(textureDescriptor),
    device.createTexture(textureDescriptor),
  ];
  trailViews = trailTextures.map((texture) => texture.createView());

  depositTexture = device.createTexture({
    size: { width, height },
    format: 'rgba16float',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  depositView = depositTexture.createView();

  const encoder = device.createCommandEncoder();
  for (const view of trailViews) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.end();
  }
  device.queue.submit([encoder.finish()]);
}

function configureCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const displayWidth = Math.floor(canvas.clientWidth * dpr) || Math.floor(window.innerWidth * dpr);
  const displayHeight = Math.floor(canvas.clientHeight * dpr) || Math.floor(window.innerHeight * dpr);
  if (displayWidth === canvasWidth && displayHeight === canvasHeight) {
    return false;
  }
  canvasWidth = displayWidth;
  canvasHeight = displayHeight;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  context.configure({
    device,
    format: presentationFormat,
    alphaMode: 'premultiplied',
    size: [canvasWidth, canvasHeight],
  });

  trailWidth = Math.max(8, Math.floor(canvasWidth * params.TRAIL_TEX_RES));
  trailHeight = Math.max(8, Math.floor(canvasHeight * params.TRAIL_TEX_RES));
  createTrailResources();
  trailIndex = 0;
  return true;
}

configureCanvas();
window.addEventListener('resize', () => {
  const changed = configureCanvas();
  if (changed) {
    updateBindGroups();
  }
});

function initAgents() {
  const data = new Float32Array(agentCount * 4);
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  const radius = Math.min(params.SPAWN_RADIUS, Math.min(cx, cy));

  for (let i = 0; i < agentCount; i++) {
    const k = i * 4;
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    data[k] = x;
    data[k + 1] = y;
    data[k + 2] = (Math.random() - 0.5);
    data[k + 3] = (Math.random() - 0.5);
  }

  device.queue.writeBuffer(stateBuffers[0], 0, data.buffer, data.byteOffset, data.byteLength);
  device.queue.writeBuffer(stateBuffers[1], 0, data.buffer, data.byteOffset, data.byteLength);
}

initAgents();

function makeSimBindGroup(readState, writeState, trailSampleView) {
  return device.createBindGroup({
    layout: simPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: stateBuffers[readState] } },
      { binding: 1, resource: { buffer: stateBuffers[writeState] } },
      { binding: 2, resource: { buffer: simUniformBuffer } },
      { binding: 3, resource: linearSampler },
      { binding: 4, resource: trailSampleView },
    ],
  });
}

function makeDepositBindGroup(writeState) {
  return device.createBindGroup({
    layout: depositPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: stateBuffers[writeState] } },
      { binding: 1, resource: { buffer: depositUniformBuffer } },
    ],
  });
}

function makeTrailBindGroup(trailReadView, trailWriteView) {
  return device.createBindGroup({
    layout: trailPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: trailReadView },
      { binding: 1, resource: depositView },
      { binding: 2, resource: trailWriteView },
      { binding: 3, resource: { buffer: trailUniformBuffer } },
    ],
  });
}

function makeFullscreenBindGroup(trailView) {
  return device.createBindGroup({
    layout: fullscreenPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: nearestSampler },
      { binding: 1, resource: trailView },
    ],
  });
}

let simBindGroup = null;
let depositBindGroup = null;
let trailBindGroup = null;
let fullscreenBindGroup = null;

function updateBindGroups() {
  simBindGroup = makeSimBindGroup(stateIndex, 1 - stateIndex, trailViews[trailIndex]);
  depositBindGroup = makeDepositBindGroup(1 - stateIndex);
  trailBindGroup = makeTrailBindGroup(trailViews[trailIndex], trailViews[1 - trailIndex]);
  fullscreenBindGroup = makeFullscreenBindGroup(trailViews[1 - trailIndex]);
}

updateBindGroups();

let lastTimestamp = performance.now();
let fpsAccumulator = 0;
let fpsCounter = 0;
let fpsTimer = lastTimestamp;

function writeUniforms(dtSeconds, timeSeconds) {
  const simData = new Float32Array(16);
  simData[0] = canvasWidth;
  simData[1] = canvasHeight;
  simData[2] = trailWidth;
  simData[3] = trailHeight;
  simData[4] = timeSeconds;
  simData[5] = dtSeconds;
  simData[6] = params.DRAG;
  simData[7] = params.STEP_LEN;
  simData[8] = params.SENSE_DIST;
  simData[9] = params.SENSE_ANGLE;
  simData[10] = params.TURN_RATE;
  simData[11] = params.TURN_JITTER;
  simData[12] = agentCount;
  device.queue.writeBuffer(simUniformBuffer, 0, simData.buffer);

  const depositData = new Float32Array(16);
  depositData[0] = canvasWidth;
  depositData[1] = canvasHeight;
  depositData[2] = trailWidth;
  depositData[3] = trailHeight;
  depositData[4] = params.DEPOSIT_SIZE;
  depositData[5] = params.DEPOSIT_STRENGTH;
  depositData[6] = dtSeconds;
  depositData[7] = params.DEPOSIT_EDGE_SOFT;
  depositData[8] = params.CHAMP_SAMPLE_INTERVAL;
  depositData[9] = params.CHAMP_IMP_MULTIPLIER;
  device.queue.writeBuffer(depositUniformBuffer, 0, depositData.buffer);

  const keep = Math.pow(params.TRAIL_DECAY, dtSeconds);
  const trailData = new Float32Array(8);
  trailData[0] = trailWidth;
  trailData[1] = trailHeight;
  trailData[2] = keep;
  trailData[3] = 0.0;
  device.queue.writeBuffer(trailUniformBuffer, 0, trailData.buffer);
}

function frame(timestamp) {
  const dt = Math.max(0.0001, (timestamp - lastTimestamp) / 1000);
  lastTimestamp = timestamp;
  const timeSeconds = timestamp / 1000;

  writeUniforms(dt, timeSeconds);

  const commandEncoder = device.createCommandEncoder();

  const simPass = commandEncoder.beginComputePass();
  simPass.setPipeline(simPipeline);
  simPass.setBindGroup(0, simBindGroup);
  simPass.dispatchWorkgroups(Math.ceil(agentCount / 64));
  simPass.end();

  const depositPass = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: depositView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  depositPass.setPipeline(depositPipeline);
  depositPass.setBindGroup(0, depositBindGroup);
  depositPass.draw(6, agentCount);
  depositPass.end();

  const trailPass = commandEncoder.beginComputePass();
  trailPass.setPipeline(trailPipeline);
  trailPass.setBindGroup(0, trailBindGroup);
  trailPass.dispatchWorkgroups(
    Math.ceil(trailWidth / 8),
    Math.ceil(trailHeight / 8)
  );
  trailPass.end();

  const currentTexture = context.getCurrentTexture();
  const screenPass = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: currentTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  screenPass.setPipeline(fullscreenPipeline);
  screenPass.setBindGroup(0, fullscreenBindGroup);
  screenPass.draw(3);
  screenPass.end();

  device.queue.submit([commandEncoder.finish()]);

  fpsAccumulator += dt;
  fpsCounter += 1;
  if (timestamp - fpsTimer > 1000) {
    const fps = Math.round(fpsCounter / fpsAccumulator);
    if (fpsSpan) {
      fpsSpan.textContent = fps.toString();
    }
    fpsCounter = 0;
    fpsAccumulator = 0;
    fpsTimer = timestamp;
  }

  stateIndex = 1 - stateIndex;
  trailIndex = 1 - trailIndex;
  updateBindGroups();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
