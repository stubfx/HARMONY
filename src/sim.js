// ─── Solo — Formula-Driven Wind Particle System ───────────────────────────────
// Agents are independent particles moved by two mathematical fields:
//   dirFormula  — the heading each particle wants to follow
//   windFormula — a force field that pushes them off course
// A magnet image layer guides particles toward bright areas via image gradient.
// Particles overlapping the image region are coloured by the image itself.
// Speed drives brightness. A fading trail accumulates on an offscreen texture.

import GUI              from 'lil-gui';
import QRCode           from 'qrcode';
import { io as ioConnect } from 'socket.io-client';
import soloSimTemplate  from './shaders/compute.wgsl?raw';
import soloRenderWGSL   from './shaders/render.wgsl?raw';
import fadeWGSL         from './shaders/fade.wgsl?raw';
import blitWGSL         from './shaders/blit.wgsl?raw';
import windVisWGSL      from './shaders/wind-vis.wgsl?raw';
import imageDebugWGSL   from './shaders/image-debug.wgsl?raw';
import agentShadowWGSL  from './shaders/agentShadow.wgsl?raw';

// ── Config ────────────────────────────────────────────────────────────────────
const MAX_AGENTS = 1_200_000;

// ── Tunable parameters (mutated by lil-gui) ───────────────────────────────────
const params = {
    // Agents
    agentCount:  MAX_AGENTS,
    // Motion
    stepLen:     2.0,
    turnRate:    0.04,
    maxSpeed:    5.0,
    minSpeed:    0.2,
    // Wind
    windEnabled: true,
    windStr:     0.2,
    showWindVis: false,
    autoWind:    true,   // cycle through WIND_FORMULAS every 10 s
    // Visual
    renderScale:    1.0,    // multiplied with DPR — reduce on high-res screens
    trailDecay:     0.04,
    bgBlackCutoff:  0.05, // luminance below which trail pixels are clamped to 0 at display time
    pointSize:      2.0,
    color:       '#1a0099',
    speedColor:  '#ff4400',   // color approached at max speed
    brightness:  0.06,        // per-particle alpha; prevents additive saturation to white
    // Magnet
    magnetStr:      5.0,  // homing speed: px/frame agents move toward their home position
    alphaThreshold: 0.1,  // min image alpha to trigger homing (0–1)
    blackThreshold: 0.05, // luminance below which pixels are treated as transparent
    vignetteEdge:   0.08, // edge fade width in UV units (0 = none, 0.5 = half image)
    imageSize:      0.316, // image size as fraction of min(canvasW, canvasH)
    showImage:    false,
    // Contamination
    contamMouse:   true,  // treat mouse cursor as a contamination point
    contamRadius:  150,   // radius of each contamination circle, in canvas pixels
    // Agent shadow
    agentShadowStr:    0.30, // peak opacity of each homing-agent shadow splat (0–1)
    agentShadowRadius: 60,   // splat half-radius in canvas pixels
    // Avoidance
    avoidForceStr:   1.0, // multiplier on image-trace avoidance forces
    avoidMapScale:   1.0, // avoidance map coverage as fraction of canvas (1.0 = full)
    // Primed-spot probe (free agents only)
    probeLen:          150.0, // probe cast distance in canvas pixels
    probeForceStr:     100.0, // steering force multiplier when probe hits a primed pixel
    respawnOnCollide:  false, // teleport to a random edge position instead of steering on probe hit
    // Auto-clear
    clearDelay:    20,    // seconds before auto-clearing user trace content (0 = disabled)
    // Session / QR restore
    remoteTimeout:  60,   // seconds of silence from all remotes before QR is restored (0 = disabled)
    maxSpectators:  1,    // sim QR hides when connected count reaches this threshold
    n8nTestMode:       false, // true = /webhook-test/sim-event, false = /webhook/sim-event
    heartbeatInterval: 20,   // seconds between periodic param snapshots sent to n8n (0 = off)
    // Weight
    weightSpread: 0.8,    // 0 = all equal; 1 = weights span [0.05 … 1.95]
    // Motion behaviour
    followFormula: true,  // false = free drift (wind + magnet only)
    autoDir:       true,  // randomly cycle dir formula every 30 s
    bounceEdges:   false, // reflect agents at canvas edges instead of wrapping
    useDeltaTime:  true,  // false = fixed 1/60 s timestep (no frame-spike compensation)
};

const DEFAULT_DIR  = 'atan2(y-cy,x-cx) + sin(length(vec2(x-cx,y-cy))*0.012 - t*1.5)*PI';
const DEFAULT_WIND = 'sin(x * 0.004 - y * 0.003 + t * 0.4) * TWO_PI';

// Idle formulas (kept for reference; not applied automatically)
const IDLE_DIR  = 'atan2(cy - y, cx - x)';
const IDLE_WIND = 'atan2(y - cy, x - cx) + sin(length(vec2(x-cx,y-cy)) * 0.008) * PI + t';

// 20 direction formulas cycled automatically when params.autoDir is true.
// Variables: x, y, t, cx, cy, PI, TWO_PI
const DIR_FORMULAS = [
    'atan2(y-cy,x-cx) + sin(length(vec2(x-cx,y-cy))*0.012 - t*1.5)*PI',
    'atan2(y - cy, x - cx) + t * 0.3',
    'atan2(y - cy, x - cx) - t * 0.4',
    'sin(x * 0.006 + t * 0.4) * PI',
    'sin(x * 0.006) * cos(y * 0.006) * TWO_PI',
    'atan2(y - cy, x - cx) + PI * 0.5',
    'sin(x * 0.009 + sin(y * 0.006 + t)) * TWO_PI',
    'sin((x + y) * 0.005 + t * 0.3) * TWO_PI',
    'sin(y * 0.007 + t * 0.25) * PI',
    'atan2(y-cy,x-cx) + cos(length(vec2(x-cx,y-cy)) * 0.008 - t * 0.8) * PI',
    'atan2(cy - y, cx - x)',
    'atan2(y - cy, x - cx) + sin(t * 1.2) * PI * 0.5',
    'sin(x * 0.005 + sin(y * 0.007 + t * 0.3) * 2.0) * TWO_PI',
    'sin(x * 0.008) * cos(y * 0.008) * PI + t * 0.15',
    'atan2(y-cy,x-cx) + length(vec2(x-cx,y-cy)) * 0.003 + t * 0.5',
    'sin(x * 0.004 + cos(y * 0.006 + t * 0.3) * 3.0) * TWO_PI',
    'sin(x * 0.004 + t * 0.2) * cos(y * 0.004 - t * 0.15) * TWO_PI',
    'sin(length(vec2(x-cx,y-cy)) * 0.015 - t * 2.5) * TWO_PI',
    'atan2(y - cy, x - cx) * 2.0 + t * 0.2',
    'sin(x * 0.003 + y * 0.002 + t * 0.15) * TWO_PI',
];

// 20 wind formulas cycled automatically when params.autoWind is true.
// Variables: x, y, t, cx, cy, PI, TWO_PI
const WIND_FORMULAS = [
    'sin(x * 0.004 - y * 0.003 + t * 0.4) * TWO_PI',
    'sin(y * 0.005 + t * 0.5) * PI',
    'cos(x * 0.005 + t * 0.3) * PI',
    'sin((x + y) * 0.004 + t * 0.3) * TWO_PI',
    'sin((x - y) * 0.004 - t * 0.3) * TWO_PI',
    'atan2(y - cy, x - cx) + PI * 0.5',
    'sin(length(vec2(x-cx,y-cy)) * 0.01 - t * 2.0) * TWO_PI',
    'sin(x * 0.006 + t * 0.5) * PI + cos(y * 0.004 - t * 0.4) * PI',
    'sin(x * 0.007 + sin(y * 0.005 + t * 0.3)) * TWO_PI',
    'atan2(y - cy, x - cx) + sin(length(vec2(x-cx,y-cy)) * 0.008) * PI + t',
    'sin(x * 0.008 + sin(y * 0.006 + t * 0.2) * 3.0) * TWO_PI',
    'sin(x * 0.002 + y * 0.001 + t * 0.15) * TWO_PI',
    'sin(x * 0.009 + t * 1.2) * cos(y * 0.007 - t * 0.9) * TWO_PI',
    'atan2(cy - y, cx - x) + sin(length(vec2(x-cx,y-cy)) * 0.015 + t) * PI * 0.5',
    'sin(x * 0.005) * cos(t * 0.3) * PI + cos(y * 0.005) * sin(t * 0.25) * PI',
    'sin(x * 0.006 + cos(y * 0.007 - t * 0.4) * 4.0) * TWO_PI',
    'sin(x * 0.004 + t * 0.4) * PI + sin(y * 0.004 - t * 0.3) * PI',
    'atan2(y - cy, x - cx) + sin(t * 0.8) * PI',
    'atan2(y-cy,x-cx) + sin(length(vec2(x-cx,y-cy))*0.006 - t*0.8)*PI + cos(length(vec2(x-cx,y-cy))*0.003 + t*0.5)*PI*0.5',
    'sin(x * 0.003 + t * 0.6) * cos(y * 0.004 + t * 0.35) * TWO_PI',
];

const PRESETS = [
    { label: 'waves + weather', dir: 'sin(x * 0.006 + t * 0.4) * PI',                                       wind: 'sin(x * 0.004 + t * 0.3) * PI + cos(y * 0.003 + t * 0.2) * 0.8' },
    { label: 'spiral',          dir: 'atan2(y - cy, x - cx) + t * 0.3',                                      wind: 'sin(x * 0.005 + t * 0.4) * PI + cos(y * 0.005 - t * 0.3) * PI * 0.6' },
    { label: 'cells',           dir: 'sin(x * 0.006) * cos(y * 0.006) * TWO_PI',                             wind: 'sin(x * 0.006 + sin(y * 0.005 + t * 0.4)) * TWO_PI' },
    { label: 'vortex',          dir: 'atan2(y - cy, x - cx) + PI * 0.5',                                     wind: 'atan2(y - cy, x - cx) + t + sin(x * 0.003) * 0.8' },
    { label: 'turbulence',      dir: 'sin(x * 0.009 + sin(y * 0.006 + t)) * TWO_PI',                        wind: 'sin(x * 0.005 + cos(y * 0.006 + t * 0.3)) * TWO_PI' },
    { label: 'radial pulse',    dir: 'atan2(y-cy,x-cx) + sin(length(vec2(x-cx,y-cy))*0.012 - t*1.5)*PI',   wind: 'sin(x * 0.004 - y * 0.003 + t * 0.4) * TWO_PI' },
];

// ── Canvas ────────────────────────────────────────────────────────────────────
const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:block;';
document.body.prepend(canvas);

function setSize() {
    const scale   = window.devicePixelRatio * params.renderScale;
    canvas.width  = Math.floor(window.innerWidth  * scale);
    canvas.height = Math.floor(window.innerHeight * scale);
}
setSize();

// ── UI helpers ────────────────────────────────────────────────────────────────
const errEl     = document.querySelector('#error-msg');
const monRes    = document.querySelector('#mon-res');
const monFps    = document.querySelector('#mon-fps');
const monAgents = document.querySelector('#mon-agents');

function showError(msg) {
    console.error('[sim]', msg);
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
}
function hideError()    { if (errEl) errEl.style.display = 'none'; }

function updateMonitor(fps) {
    if (monRes)    monRes.textContent    = `${canvas.width} × ${canvas.height}  @${(window.devicePixelRatio * params.renderScale).toFixed(2)}x`;
    if (monFps)    monFps.textContent    = `${fps.toFixed(1)} fps`;
    if (monAgents) monAgents.textContent = `${params.agentCount.toLocaleString()} agents`;
}

// ── Image region: centered, preserves image aspect ratio ─────────────────────
// imageSize scales the image so its longer side = imageSize × min(canvasW, canvasH).
function getImageRegion() {
    const cx     = canvas.width  / 2;
    const cy     = canvas.height / 2;
    const refDim = Math.min(canvas.width, canvas.height) * params.imageSize;
    const aspect = imageNaturalW / imageNaturalH;
    let hw, hh;
    if (aspect >= 1) { hw = refDim / 2;         hh = refDim / aspect / 2; }
    else             { hh = refDim / 2;          hw = refDim * aspect / 2; }
    return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
}

// ── WebGPU init ───────────────────────────────────────────────────────────────
if (!navigator.gpu) { showError('WebGPU not supported in this browser.'); throw new Error(); }
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter)       { showError('No WebGPU adapter found.'); throw new Error(); }
const device = await adapter.requestDevice();
device.addEventListener('uncapturederror', e => {
    console.error('[WebGPU uncaptured error]', e.error.message);
    showError(e.error.message);
});

const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
const ctx = canvas.getContext('webgpu');
ctx.configure({ device, format: canvasFormat, alphaMode: 'opaque' });

// ── Persistent GPU buffers ────────────────────────────────────────────────────
const agentBuf = device.createBuffer({
    size: MAX_AGENTS * 32,    // [pos.xy, vel.xy, home.xy, weight, _pad] = 8 × f32 = 32 bytes
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const soloUB = device.createBuffer({
    size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const renderUB = device.createBuffer({
    size: 84, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const fadeUB = device.createBuffer({
    size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const blitUB = device.createBuffer({
    size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const windVisUB = device.createBuffer({
    size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const imageDebugUB = device.createBuffer({
    size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
// ContamParams: 16-byte header + 10 × vec4<f32> (16 bytes each) = 176 bytes
const contamUB = device.createBuffer({
    size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

function seedAgents() {
    const count = params.agentCount;
    const data  = new Float32Array(count * 8);   // 8 floats × 4 bytes = 32 bytes/agent
    const TAU   = Math.PI * 2;

    // Divide the canvas into a grid — one cell per agent — aspect-ratio aware.
    // Each agent's home is the centre of its assigned cell.
    const aspect = canvas.width / canvas.height;
    const gridW  = Math.ceil(Math.sqrt(count * aspect));
    const gridH  = Math.ceil(count / gridW);
    const cellW  = canvas.width  / gridW;
    const cellH  = canvas.height / gridH;

    for (let i = 0; i < count; i++) {
        const b  = i * 8;
        const sx = Math.random() * canvas.width;
        const sy = Math.random() * canvas.height;
        const a  = Math.random() * TAU;              // fully random direction
        const s  = 0.5 + Math.random() * 1.5;
        data[b]     = sx;                             // pos.x
        data[b + 1] = sy;                             // pos.y
        data[b + 2] = Math.cos(a) * s;               // vel.x
        data[b + 3] = Math.sin(a) * s;               // vel.y
        // Home: centre of this agent's assigned grid cell
        const col  = i % gridW;
        const row  = Math.floor(i / gridW);
        data[b + 4] = (col + 0.5) * cellW;          // home.x
        data[b + 5] = (row + 0.5) * cellH;          // home.y
        // Weight
        data[b + 6] = Math.max(0.05, 1.0 + (Math.random() * 2 - 1) * params.weightSpread);
        data[b + 7] = 0;                             // _pad
    }
    device.queue.writeBuffer(agentBuf, 0, data);
}
seedAgents();

// ── Static pipelines & resources ──────────────────────────────────────────────
const screenSmp = device.createSampler({
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
});

// 1×1 black placeholder — bound when no magnet image is loaded
const placeholderTex = device.createTexture({
    size: [1, 1], format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
device.queue.writeTexture(
    { texture: placeholderTex },
    new Uint8Array([0, 0, 0, 255]),
    { bytesPerRow: 4 },
    [1, 1],
);
const placeholderTexView = placeholderTex.createView();

const imageSampler = screenSmp;  // same settings — reuse

// ── Avoidance map state ───────────────────────────────────────────────────────
let avoidMapTex     = null;
let avoidMapTexView = null;
let hasAvoidMap     = false;

// Fade: black quad, alpha blend
const fadeMod = device.createShaderModule({ code: fadeWGSL });
const fadePipe = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: fadeMod, entryPoint: 'vs' },
    fragment: {
        module: fadeMod, entryPoint: 'fs',
        targets: [{
            format: 'rgba8unorm',
            blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one',        dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
        }],
    },
    primitive: { topology: 'triangle-list' },
});
const fadeBG = device.createBindGroup({
    layout: fadePipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: fadeUB } }],
});

// Particles: attenuated additive blend (src-alpha × one) so brightness controls
// accumulation — prevents saturation to white on dense clusters.
const renderMod = device.createShaderModule({ code: soloRenderWGSL });
{
    const info = await renderMod.getCompilationInfo();
    const errs = info.messages.filter(m => m.type === 'error');
    if (errs.length) {
        const msg = '[render.wgsl] ' + errs.map(m => `line ${m.lineNum}: ${m.message}`).join('\n');
        console.error(msg);
        showError(msg);
    }
}
const renderPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: renderMod, entryPoint: 'vs' },
    fragment: {
        module: renderMod, entryPoint: 'fs',
        targets: [{
            format: 'rgba8unorm',
            blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'one',        dstFactor: 'one', operation: 'add' },
            },
        }],
    },
    primitive: { topology: 'triangle-list' },
});
// renderBG is rebuilt whenever the image changes (see rebuildRenderBG)
let renderBG = null;

// Blit: copy offscreen → canvas swap-chain
const blitMod = device.createShaderModule({ code: blitWGSL });
const blitPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: blitMod, entryPoint: 'vs' },
    fragment: {
        module: blitMod, entryPoint: 'fs',
        targets: [{ format: canvasFormat }],
    },
    primitive: { topology: 'triangle-list' },
});

// Agent shadow: per-homing-agent soft dark splat blended onto offscreen texture
const agentShadowUB = device.createBuffer({
    size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const agentShadowMod  = device.createShaderModule({ code: agentShadowWGSL });
const agentShadowPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: agentShadowMod, entryPoint: 'vs' },
    fragment: {
        module: agentShadowMod, entryPoint: 'fs',
        targets: [{
            format: 'rgba8unorm',
            blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one',        dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
        }],
    },
    primitive: { topology: 'triangle-list' },
});
let agentShadowBG = null;

// Image debug: centered 1/4-screen quad, 50% opacity grayscale
const imageDebugMod = device.createShaderModule({ code: imageDebugWGSL });
const imageDebugPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: imageDebugMod, entryPoint: 'vs' },
    fragment: {
        module: imageDebugMod, entryPoint: 'fs',
        targets: [{
            format: canvasFormat,
            blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one',        dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
        }],
    },
    primitive: { topology: 'triangle-list' },
});


// ── Offscreen texture (rebuilt on resize) ─────────────────────────────────────
let offscreenTex  = null;
let offscreenView = null;
let blitBG        = null;

function rebuildOffscreen() {
    if (offscreenTex) offscreenTex.destroy();
    offscreenTex = device.createTexture({
        size:   [canvas.width, canvas.height],
        format: 'rgba8unorm',
        usage:  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    offscreenView = offscreenTex.createView();
    blitBG = device.createBindGroup({
        layout: blitPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: blitUB } },
            { binding: 1, resource: screenSmp },
            { binding: 2, resource: offscreenView },
        ],
    });
    const enc = device.createCommandEncoder();
    const rp  = enc.beginRenderPass({
        colorAttachments: [{
            view: offscreenView, loadOp: 'clear',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
        }],
    });
    rp.end();
    device.queue.submit([enc.finish()]);
}
rebuildOffscreen();

window.addEventListener('resize', () => {
    setSize();
    rebuildOffscreen();
    renderTraceCanvas();
    rebuildAgentShadowBG();
    seedAgents();
});

// ── Trace layer state ─────────────────────────────────────────────────────────
// The trace layer is a single GPU texture that is the composite of:
//   - an optional loaded image (imageBitmap, stored for re-compositing)
//   - optional text drawn on top (from #trace-text-input)
// Both are rendered onto traceCanvas (a 2D offscreen canvas) and uploaded as
// one rgba8unorm texture. Changing either source re-runs renderTraceCanvas().
let hasImage      = false;
let imageTex      = null;
let imageTexView  = null;
let imageDebugBG  = null;
let imageNaturalW = 1;
let imageNaturalH = 1;
let imageBitmap   = null;   // retained ImageBitmap so text changes can re-composite
let traceCanvas   = null;   // offscreen 2D canvas used for compositing

// Rebuilds particle render bind group — called after pipeline creation and on image change
function rebuildRenderBG() {
    const texView = (hasImage && imageTexView) ? imageTexView : placeholderTexView;
    renderBG = device.createBindGroup({
        layout: renderPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: renderUB } },
            { binding: 1, resource: { buffer: agentBuf } },
            { binding: 2, resource: imageSampler },
            { binding: 3, resource: texView },
        ],
    });
}
rebuildRenderBG();
rebuildAgentShadowBG();

function rebuildImageDebugBG() {
    if (!hasImage || !imageTexView) { imageDebugBG = null; return; }
    imageDebugBG = device.createBindGroup({
        layout: imageDebugPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: imageDebugUB } },
            { binding: 1, resource: screenSmp },
            { binding: 2, resource: imageTexView },
        ],
    });
}

function rebuildAgentShadowBG() {
    const texView = (hasImage && imageTexView) ? imageTexView : placeholderTexView;
    agentShadowBG = device.createBindGroup({
        layout: agentShadowPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: agentShadowUB } },
            { binding: 1, resource: { buffer: agentBuf } },
            { binding: 2, resource: imageSampler },
            { binding: 3, resource: texView },
        ],
    });
}

// ── Trace canvas compositor ───────────────────────────────────────────────────
// Composites imageBitmap (if any) + trace text (if any) onto a single 2D canvas,
// then uploads the result to the GPU as the trace texture.
// Called whenever either source changes.
function renderTraceCanvas() {
    if (!device) return;

    const text    = document.querySelector('#trace-text-input')?.value.trim() ?? '';
    const hasText = text.length > 0;

    // Nothing to show — tear everything down and return to formula-only mode
    if (!imageBitmap && !hasText) {
        hasImage      = false;
        imageTexView  = null;
        imageNaturalW = 1;
        imageNaturalH = 1;
        if (imageTex) { imageTex.destroy(); imageTex = null; }
        imageDebugBG  = null;
        rebuildSimBG();
        rebuildRenderBG();
        rebuildImageDebugBG();
        rebuildAgentShadowBG();
        return;
    }

    // ── 1. Determine composite canvas dimensions ──────────────────────────────
    // Image size is used as base; text-only wraps to screen width (capped at GPU limit).
    const MAX_DIM = device.limits.maxTextureDimension2D;
    let cw, ch;
    let wrappedLines = null; // only populated for the text-only word-wrap path

    if (imageBitmap) {
        cw = Math.min(imageBitmap.width,  MAX_DIM);
        ch = Math.min(imageBitmap.height, MAX_DIM);
    } else {
        // Text only: fix width to screen width, wrap words, auto-height from line count.
        // Deriving width from measureText would exceed maxTextureDimension2D for long strings.
        cw = Math.min(canvas.width, MAX_DIM);
        const fontSize = Math.round(cw * 0.06);
        const tmp      = document.createElement('canvas').getContext('2d');
        tmp.font       = `bold ${fontSize}px sans-serif`;
        const availW   = cw * 0.92;

        const words = text.split(' ');
        const lines = [];
        let line = '';
        for (const word of words) {
            const test = line ? line + ' ' + word : word;
            if (tmp.measureText(test).width > availW && line) {
                lines.push(line);
                line = word;
            } else {
                line = test;
            }
        }
        if (line) lines.push(line);

        const lineH = Math.round(fontSize * 1.4);
        ch = Math.min(Math.max(lines.length * lineH + lineH, 64), MAX_DIM);
        wrappedLines = { lines, fontSize, lineH };
    }

    // ── 2. Paint the composite canvas ─────────────────────────────────────────
    if (!traceCanvas) traceCanvas = document.createElement('canvas');
    traceCanvas.width  = cw;
    traceCanvas.height = ch;
    const ctx = traceCanvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);

    // Layer 1: image (if loaded)
    if (imageBitmap) ctx.drawImage(imageBitmap, 0, 0, cw, ch);

    // Layer 2: text on top, white fill
    if (hasText) {
        ctx.fillStyle    = 'white';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        if (wrappedLines) {
            // Multi-line text-only mode
            const { lines, fontSize, lineH } = wrappedLines;
            ctx.font = `bold ${fontSize}px sans-serif`;
            const startY = (ch - lines.length * lineH) / 2 + lineH / 2;
            lines.forEach((ln, i) => ctx.fillText(ln, cw / 2, startY + i * lineH));
        } else {
            // Single line over an image — scale font down if wider than canvas
            let fontSize = ch * 0.72;
            ctx.font = `bold ${Math.round(fontSize)}px sans-serif`;
            const measured = ctx.measureText(text).width;
            const maxW     = cw * 0.92;
            if (measured > maxW) {
                fontSize = fontSize * (maxW / measured);
                ctx.font = `bold ${Math.round(fontSize)}px sans-serif`;
            }
            ctx.fillText(text, cw / 2, ch / 2);
        }
    }

    // ── 3. Upload composite to GPU ────────────────────────────────────────────
    imageNaturalW = cw;
    imageNaturalH = ch;
    if (imageTex) imageTex.destroy();
    imageTex = device.createTexture({
        size:   [cw, ch],
        format: 'rgba8unorm',
        usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: traceCanvas }, { texture: imageTex }, [cw, ch]);
    imageTexView = imageTex.createView();
    hasImage     = true;
    rebuildSimBG();
    rebuildRenderBG();
    rebuildImageDebugBG();
    rebuildAgentShadowBG();
}

// ── Auto-clear timer ──────────────────────────────────────────────────────────
// Started whenever user-added content (image or text) appears in the trace layer.
// Fires after params.clearDelay seconds and wipes user text + any non-QR image.
// Cancelled when the user explicitly clears content; reset when new content arrives.
// The session QR is considered system content and is never auto-cleared.
let autoClearTimer = null;

function scheduleAutoClear() {
    clearTimeout(autoClearTimer);
    if (params.clearDelay <= 0) return;
    autoClearTimer = setTimeout(() => {
        autoClearTimer = null;
        const input = document.querySelector('#trace-text-input');
        if (input) input.value = '';
        if (simState.qrStatus !== 'SHOW') imageBitmap = null;
        renderTraceCanvas();
        console.log('[trace] auto-cleared after', params.clearDelay, 's');
    }, params.clearDelay * 1000);
}

async function loadMagnetImage(file) {
    const wasQR        = simState.qrStatus === 'SHOW';
    simState.qrStatus  = 'HIDE';
    updateStateDisplay();
    imageBitmap = await createImageBitmap(file, { colorSpaceConversion: 'none' });
    renderTraceCanvas();
    scheduleAutoClear();
    if (wasQR) pickRandomFormulas();
}

function clearMagnetImage() {
    const wasQR       = simState.qrStatus === 'SHOW';
    simState.qrStatus = 'HIDE';
    updateStateDisplay();
    imageBitmap = null;
    clearTimeout(autoClearTimer);
    autoClearTimer = null;
    renderTraceCanvas();
    if (wasQR) pickRandomFormulas();
}

function clearTraceText() {
    const input = document.querySelector('#trace-text-input');
    if (input) input.value = '';
    clearTimeout(autoClearTimer);
    autoClearTimer = null;
    renderTraceCanvas();
}

// Restore the session QR as the active trace image.
// Called when all spectators leave or the inactivity timeout fires.
// No-op if QR is already showing or hasn't been generated yet.
function restoreQR() {
    if (simState.qrStatus === 'SHOW' || !qrBitmap) return;
    const input = document.querySelector('#trace-text-input');
    if (input) input.value = '';
    clearTimeout(autoClearTimer);
    autoClearTimer = null;
    imageBitmap       = qrBitmap;
    simState.qrStatus = 'SHOW';
    updateStateDisplay();
    renderTraceCanvas();
    pickRandomFormulas();
}

// Pick a fresh random formula pair and apply it immediately.
// Called both when entering QR mode (agents drift toward the QR image) and when
// leaving it (user content replaces the QR, formula refreshes to avoid stale state).
function pickRandomFormulas() {
    const dir  = rndPick(DIR_FORMULAS);
    const wind = rndPick(WIND_FORMULAS);
    applyFormulas(dir, wind);
    const di = document.querySelector('#dir-input');
    const wi = document.querySelector('#wind-input');
    if (di) di.value = dir;
    if (wi) wi.value = wind;
}

// ── Formula compute + wind-vis pipelines (rebuilt on each formula change) ──────
let simPipe     = null;
let simBG       = null;
let windVisPipe = null;
let windVisBG   = null;

function rebuildSimBG() {
    if (!simPipe) return;
    const texView      = (hasImage    && imageTexView)    ? imageTexView    : placeholderTexView;
    const avoidMapView = (hasAvoidMap && avoidMapTexView) ? avoidMapTexView : placeholderTexView;
    simBG = device.createBindGroup({
        layout: simPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: soloUB } },
            { binding: 1, resource: { buffer: agentBuf } },
            { binding: 2, resource: texView },
            { binding: 3, resource: { buffer: contamUB } },
            { binding: 4, resource: avoidMapView },
        ],
    });
}

async function buildSimPipeline(dir, wind) {
    const fnDefs = [
        `fn evalDirFormula(x:f32,y:f32,t:f32,idx:f32,cx:f32,cy:f32)->f32{ return ${dir}; }`,
        `fn evalWindFormula(x:f32,y:f32,t:f32,idx:f32,cx:f32,cy:f32)->f32{ return ${wind}; }`,
        ``,
    ].join('\n');
    const mod  = device.createShaderModule({ code: fnDefs + soloSimTemplate });
    const info = await mod.getCompilationInfo();
    const errs = info.messages.filter(m => m.type === 'error');
    if (errs.length) throw new Error(errs.map(m => `line ${m.lineNum}: ${m.message}`).join('\n'));

    const pipe = device.createComputePipeline({
        layout: 'auto',
        compute: { module: mod, entryPoint: 'main' },
    });
    simPipe = pipe;
    rebuildSimBG();

    const windVisMod = device.createShaderModule({
        code: `fn evalWindFormula(x:f32,y:f32,t:f32,idx:f32,cx:f32,cy:f32)->f32{ return ${wind}; }\n` + windVisWGSL,
    });
    windVisPipe = device.createRenderPipeline({
        layout: 'auto',
        vertex:   { module: windVisMod, entryPoint: 'vs' },
        fragment: { module: windVisMod, entryPoint: 'fs', targets: [{ format: canvasFormat }] },
        primitive: { topology: 'line-list' },
    });
    windVisBG = device.createBindGroup({
        layout: windVisPipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: windVisUB } }],
    });
}

async function applyFormulas(dir, wind, { reseed = false } = {}) {
    try {
        await buildSimPipeline(dir.trim() || DEFAULT_DIR, wind.trim() || DEFAULT_WIND);
        hideError();
        if (reseed) seedAgents();
    } catch (e) {
        showError(e.message);
    }
}

const rndPick   = arr => arr[Math.floor(Math.random() * arr.length)];
const startDir  = rndPick(DIR_FORMULAS);
const startWind = rndPick(WIND_FORMULAS);

// ── Simulation state machine ──────────────────────────────────────────────────
// qrStatus: 'SHOW' — QR code is the active trace image (vignetteEdge=0, qrMode on)
//           'HIDE' — trace layer is user content or empty
// status:   'NORMAL' — formula steering + wind active, auto-cycling runs
//           'IDLE'   — no formula, no wind; particles drift freely on momentum
const simState = { qrStatus: 'HIDE', status: 'NORMAL' };

let stateCtrl   = null;  // lil-gui controller — set after gui is created
let qrStateCtrl = null;

function updateStateDisplay() {
    stateCtrl?.updateDisplay();
    qrStateCtrl?.updateDisplay();
}

let qrBitmap           = null;  // permanent reference to the session QR bitmap
let sessionRoom        = null;  // UUID assigned by server — needed for n8n payload
let simSpectatorCount  = 0;     // local spectator count — synced from server events
let lastRemoteActivity = Date.now(); // timestamp of last remote-event (touch or text)

// ── n8n direct integration ────────────────────────────────────────────────────
// VITE_N8N_BASE_URL is the bare n8n origin (e.g. http://localhost:5678).
// The sim appends /webhook/sim-event or /webhook-test/sim-event based on
// params.n8nTestMode. An in-flight guard prevents queuing — if a call is already
// running the new event is skipped. A 5 s timeout clears the guard if n8n is slow.
const N8N_BASE       = (import.meta.env.VITE_N8N_BASE_URL ?? '').replace(/\/$/, '');
const N8N_TIMEOUT_MS = 5_000;
let   n8nInFlight          = false;
let   n8nHeartbeatInFlight = false;

async function callN8n(event) {
    if (!N8N_BASE || n8nInFlight) return;
    n8nInFlight = true;
    const path = params.n8nTestMode ? '/webhook-test/sim-event' : '/webhook/sim-event';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);
    try {
        const res = await fetch(N8N_BASE + path, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ ...event, room: sessionRoom }),
            signal:  controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object') applySimParams(data);
        }
    } catch (err) {
        clearTimeout(timer);
        if (err.name !== 'AbortError') console.warn('[n8n]', err.message);
    } finally {
        n8nInFlight = false;
    }
}

// Periodic heartbeat — sends the full params snapshot to n8n every
// params.heartbeatInterval seconds. Response is handled identically to sim-event.
// Has its own in-flight guard so it never blocks user-triggered events.
async function callN8nHeartbeat() {
    if (!N8N_BASE || n8nHeartbeatInFlight) return;
    n8nHeartbeatInFlight = true;
    const path = params.n8nTestMode ? '/webhook-test/heartbeat' : '/webhook/heartbeat';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);
    try {
        const res = await fetch(N8N_BASE + path, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ type: 'heartbeat', room: sessionRoom, params: { ...params } }),
            signal:  controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object') applySimParams(data);
        }
    } catch (err) {
        clearTimeout(timer);
        if (err.name !== 'AbortError') console.warn('[n8n heartbeat]', err.message);
    } finally {
        n8nHeartbeatInFlight = false;
    }
}

let heartbeatTimer = null;
function restartHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (N8N_BASE && params.heartbeatInterval > 0) {
        heartbeatTimer = setInterval(callN8nHeartbeat, params.heartbeatInterval * 1000);
    }
}
restartHeartbeat();

await applyFormulas(startDir, startWind, { reseed: true });

// ── Session: Socket.IO connection + QR code ───────────────────────────────────
// The server assigns a session UUID on socket connect and emits it back as
// 'session-id'. The sim renders a QR code pointing to $VITE_USER_URL/?s=<id> as both
// a small scannable overlay and a large trace image in the canvas centre.
// If VITE_N8N_BASE_URL is set, the sim calls n8n directly on each remote-event.
{
    // In dev, Vite runs on a different port from Express, so connect directly to Express.
    // In production, use VITE_SOCKET_URL (the Caddy-fronted public origin) so Socket.IO
    // traffic is routed through Caddy → Express. Falls back to '/' (same origin) if unset.
    const socketUrl = import.meta.env.DEV
        ? `http://localhost:${import.meta.env.VITE_SERVER_PORT ?? 3000}`
        : (import.meta.env.VITE_SOCKET_URL || '/');
    const socket = ioConnect(socketUrl, { reconnectionDelay: 2000 });

    // Identify this socket as the host simulation so the server can distinguish
    // it from remote spectator sockets and assign a UUID session room.
    socket.emit('register-host');

    socket.on('session-id', async (sessionId) => {
        sessionRoom = sessionId;
        // Use VITE_USER_URL as-is (Caddy handles the /remote redirect internally).
        // Falls back to the page's own origin in dev when no env var is set.
        const envUrl  = (import.meta.env.VITE_USER_URL ?? '').replace(/\/$/, '');
        const base    = envUrl || window.location.origin;
        const userUrl = `${base}/?s=${sessionId}`;

        console.log('[session] remote URL:', userUrl);

        // ── Small scannable QR in the UI panel ──────────────────────────────
        const uiQr = document.querySelector('#qr-canvas');
        if (uiQr) {
            await QRCode.toCanvas(uiQr, userUrl, {
                width: 120, margin: 1,
                color: { dark: '#000000', light: '#ffffff' },
            });
            uiQr.style.display = 'block';
            uiQr.style.cursor  = 'pointer';
            uiQr.addEventListener('click', () => window.open(userUrl, '_blank'));
        }

        // ── Large QR as trace image — modules white (opaque), background transparent.
        // dark=#ffffffff → QR modules are white (alpha=1) — homing agents fill them.
        // light=#00000000 → quiet zone and gaps are transparent — no agents there.
        const qrOffscreen = document.createElement('canvas');
        await QRCode.toCanvas(qrOffscreen, userUrl, {
            width: 512, margin: 0,
            color: { dark: '#ffffffff', light: '#00000000' },
        });
        // Treat as a loaded image so Clear image removes it and user images replace it.
        // Delay trace render until the intro ends — prevents particles being trapped
        // in the QR pattern during the radial spread-out phase.
        // Stored permanently in qrBitmap so it can be restored at any time.
        // Flagged as QR so auto-clear never wipes it.
        qrBitmap          = await createImageBitmap(qrOffscreen);
        imageBitmap       = qrBitmap;
        simState.qrStatus = 'SHOW';
        updateStateDisplay();
        renderTraceCanvas();
        pickRandomFormulas();
    });

    socket.on('sim-params', (data) => {
        try { applySimParams(data); }
        catch { /* malformed payload — ignore */ }
    });

    // Collective swarm state — aggregated by the server from all spectators in the room.
    // Tilt bias: avgPitch/avgRoll are 0-1 (0.5 = phone held flat/neutral).
    // Temperature: 0 = cold (top of phone screen), 1 = warm (bottom of phone screen).
    socket.on('collective-state', ({ avgPitch, avgRoll, avgTemp, avgCoherence, userCount }) => {
        const biasStr = params.windStr;
        collectiveBiasX     = (avgRoll  - 0.5) * 2 * biasStr;
        collectiveBiasY     = (avgPitch - 0.5) * 2 * biasStr;
        collectiveTemp      = avgTemp      ?? 0.5;
        collectiveCoherence = avgCoherence ?? 0.5;
        // Mirror to GUI debug panel (manual refresh — no .listen() RAF loop)
        swarmDebug.users     = userCount ?? 0;
        swarmDebug.pitch     = +(avgPitch     ?? 0.5).toFixed(3);
        swarmDebug.roll      = +(avgRoll      ?? 0.5).toFixed(3);
        swarmDebug.temp      = +(avgTemp      ?? 0.5).toFixed(3);
        swarmDebug.coherence = +(avgCoherence ?? 0.5).toFixed(3);
        dbgUsers.updateDisplay();
        dbgPitch.updateDisplay();
        dbgRoll.updateDisplay();
        dbgTemp.updateDisplay();
        dbgCoherence.updateDisplay();
    });

    // A spectator joined — fire a brief directional gust into the field.
    // Random angle each time so every join feels distinct.
    // Once the connected count reaches maxSpectators the QR is dismissed
    // (clearMagnetImage also applies a random formula so the sim breathes).
    socket.on('spectator-joined', ({ userCount }) => {
        simSpectatorCount = userCount ?? simSpectatorCount + 1;
        // Reset activity clock so the remoteTimeout inactivity timer starts
        // from when someone actually arrives, not from sim boot.
        lastRemoteActivity = Date.now();
        burstBrightness = BURST_BRIGHTNESS;
        if (simState.qrStatus === 'SHOW' && simSpectatorCount >= params.maxSpectators) {
            clearMagnetImage();
        }
    });

    // A spectator left — decrement internal count.
    // QR restoration is handled exclusively by the ticker so the remoteTimeout
    // delay is always respected, even when the last spectator disconnects.
    socket.on('spectator-left', ({ userCount }) => {
        simSpectatorCount = userCount ?? Math.max(0, simSpectatorCount - 1);
    });

    // Remote events forwarded from spectator devices.
    // Text events: if n8n is configured they are routed there — n8n processes the
    // text and returns what to apply (traceText, formulas, status, etc.) via
    // applySimParams(). Without n8n the text is applied directly to the trace layer.
    // All other events (touch, etc.) are always applied locally; callN8n also fires
    // for every event so n8n can react to touches too if the workflow handles them.
    socket.on('remote-event', (event) => {
        lastRemoteActivity = Date.now();
        if (event.type === 'text' && event.data?.text && !N8N_BASE) {
            const wasQR = simState.qrStatus === 'SHOW';
            if (wasQR) { imageBitmap = null; simState.qrStatus = 'HIDE'; updateStateDisplay(); }
            const input = document.querySelector('#trace-text-input');
            if (input) input.value = event.data.text;
            renderTraceCanvas();
            scheduleAutoClear();
            if (wasQR) pickRandomFormulas();
        }
        callN8n(event);
    });

    socket.on('connect_error', () => console.warn('[socket] connection failed, will retry…'));
}

// Merge n8n-provided params into the live simulation.
// Only numeric/boolean keys present in the payload are applied;
// if formulas are included they re-trigger pipeline compilation.
function applySimParams(data) {
    const { dir, wind, restart, clearTrace, showQR, traceText, clearText, status, avoidMap, ...rest } = data;
    if (status === 'NORMAL' || status === 'IDLE') {
        simState.status = status;
        updateStateDisplay();
    }
    if (restart)              seedAgents();
    if (avoidMap === null)    clearAvoidMap();
    else if (typeof avoidMap === 'string') loadAvoidMap(avoidMap);
    if (clearTrace)           { clearMagnetImage(); clearTraceText(); }
    if (showQR === true)      restoreQR();
    if (showQR === false)     clearMagnetImage();
    if (clearText)            clearTraceText();
    if (traceText !== undefined) {
        const wasQR = simState.qrStatus === 'SHOW';
        if (wasQR) { imageBitmap = null; simState.qrStatus = 'HIDE'; updateStateDisplay(); }
        const input = document.querySelector('#trace-text-input');
        if (input) input.value = traceText;
        renderTraceCanvas();
        scheduleAutoClear();
        if (wasQR) pickRandomFormulas();
    }
    Object.entries(rest).forEach(([k, v]) => {
        if (k in params) params[k] = v;
    });
    gui.controllersRecursive().forEach(c => c.updateDisplay());
    if (dir !== undefined || wind !== undefined) {
        const newDir  = dir  ?? dirInput.value;
        const newWind = wind ?? windInput.value;
        dirInput.value  = newDir;
        windInput.value = newWind;
        applyFormulas(newDir, newWind);
    }
}

// ── HUD visibility — hidden by default; show with ?gui=true or Ctrl ──────────
let guiVisible = new URLSearchParams(location.search).get('gui') === 'true';
const uiEl      = document.querySelector('#ui');
const monitorEl = document.querySelector('#monitor');

function applyGUIVisibility() {
    uiEl.style.display           = guiVisible ? 'flex' : 'none';
    monitorEl.style.display      = guiVisible ? 'flex' : 'none';
    gui.domElement.style.display = guiVisible ? ''     : 'none';
}

// ── lil-gui ───────────────────────────────────────────────────────────────────
// Live values mirrored into the GUI debug panel (updated by collective-state events).
const swarmDebug = { users: 0, pitch: 0.5, roll: 0.5, temp: 0.5, coherence: 0.5 };

const gui = new GUI({ title: 'Wind Particles', width: 260 });
// Hide immediately to prevent a flash of the panel before applyGUIVisibility() runs.
if (!guiVisible) gui.domElement.style.display = 'none';

const fMotion = gui.addFolder('Motion');
fMotion.add(params, 'agentCount', 1_000, MAX_AGENTS, 1_000)
    .name('agents')
    .onChange(() => seedAgents());
fMotion.add(params, 'stepLen',      0.1, 8,    0.1).name('base speed');
fMotion.add(params, 'turnRate',     0.005, 0.3, 0.005).name('turn rate');
fMotion.add(params, 'maxSpeed',     1,    15,   0.5).name('max speed');
fMotion.add(params, 'minSpeed',     0,    2,    0.05).name('min speed');
fMotion.add(params, 'weightSpread',   0, 1, 0.01).name('weight spread')
    .onChange(() => seedAgents());
fMotion.add(params, 'followFormula').name('follow formula');
fMotion.add(params, 'autoDir').name('auto-cycle formula');
fMotion.add(params, 'bounceEdges').name('bounce edges');
fMotion.add(params, 'useDeltaTime').name('delta time');

const fWind = gui.addFolder('Wind');
const windStrCtrl = fWind.add(params, 'windStr', 0, 2, 0.01).name('strength');
fWind.add(params, 'windEnabled').name('enabled').onChange(v => windStrCtrl.enable(v));
fWind.add(params, 'showWindVis').name('show arrows');
fWind.add(params, 'autoWind').name('auto-cycle formula');

const fVis = gui.addFolder('Visual');
fVis.add(params, 'renderScale', 0.1, 1.0, 0.05).name('render scale').onChange(() => {
    setSize();
    rebuildOffscreen();
    seedAgents();
});
fVis.add(params,  'trailDecay',    0.005, 0.4,  0.005).name('trail decay');
fVis.add(params,  'bgBlackCutoff', 0,     0.05, 0.001).name('black cutoff');
fVis.add(params,  'pointSize',     1,     6,    0.1  ).name('agent size');
fVis.addColor(params, 'color').name('base color');
fVis.addColor(params, 'speedColor').name('fast color');
fVis.add(params, 'brightness', 0.01, 0.5, 0.005).name('brightness');


const fMagnet = gui.addFolder('Trace');
fMagnet.add(params, 'magnetStr',      0, 20,  0.1 ).name('homing speed');
fMagnet.add(params, 'alphaThreshold', 0,  1,  0.01).name('alpha threshold');
fMagnet.add(params, 'blackThreshold', 0,  0.5, 0.005).name('black cutoff');
fMagnet.add(params, 'vignetteEdge',   0,  0.5, 0.005).name('edge fade');
fMagnet.add(params, 'imageSize', 0.05, 1.0, 0.01).name('size');
fMagnet.add(params, 'showImage').name('show image');
fMagnet.add(params, 'contamMouse').name('mouse eraser');
fMagnet.add(params, 'contamRadius', 10, 600, 5).name('eraser radius');
fMagnet.add(params, 'agentShadowStr',    0,   1,   0.01).name('shadow strength');
fMagnet.add(params, 'agentShadowRadius', 0, 300,   1   ).name('shadow radius');
fMagnet.add(params, 'avoidForceStr', 0, 5, 0.05).name('avoid force');
fMagnet.add(params, 'probeLen',      5, 300, 1   ).name('probe distance');
fMagnet.add(params, 'probeForceStr',    0, 200, 1   ).name('probe force');
fMagnet.add(params, 'respawnOnCollide').name('respawn on collide');
fMagnet.add(params, 'clearDelay', 0, 120, 5).name('auto clear (s)');
fMagnet.add({ load: () => document.querySelector('#image-input').click() }, 'load').name('Load image…');
fMagnet.add({ clear: clearMagnetImage }, 'clear').name('Clear image');
fMagnet.add({ clear: clearTraceText },   'clear').name('Clear text');

const fAvoid = gui.addFolder('Avoidance map');
fAvoid.add(params, 'avoidMapScale', 0.05, 1.0, 0.01).name('scale');
fAvoid.add({ load: () => document.querySelector('#avoid-map-input').click() }, 'load').name('Load map…');
fAvoid.add({ clear: clearAvoidMap }, 'clear').name('Clear map');

const fSession = gui.addFolder('Session');
fSession.add(params, 'remoteTimeout',  0, 180,  5).name('idle restore QR (s)');
fSession.add(params, 'maxSpectators',  1,  50,  1).name('QR hides at N users');
fSession.add(params, 'n8nTestMode').name('n8n test mode');
fSession.add(params, 'heartbeatInterval', 0, 120, 5).name('heartbeat (s)').onChange(() => restartHeartbeat());

const fDebug = gui.addFolder('Debug');
// No .listen() — controllers are refreshed manually inside the collective-state
// socket handler (≤300 ms cadence) so there's no extra RAF loop competing with WebGPU.
const dbgUsers     = fDebug.add(swarmDebug, 'users').name('remotes').disable();
const dbgPitch     = fDebug.add(swarmDebug, 'pitch',     0, 1).name('avg pitch').disable();
const dbgRoll      = fDebug.add(swarmDebug, 'roll',      0, 1).name('avg roll').disable();
const dbgTemp      = fDebug.add(swarmDebug, 'temp',      0, 1).name('avg temp').disable();
const dbgCoherence = fDebug.add(swarmDebug, 'coherence', 0, 1).name('avg coherence').disable();
fDebug.close();

gui.add({ restart: () => seedAgents() }, 'restart').name('↺  Restart');

// ── State machine display ─────────────────────────────────────────────────────
stateCtrl   = gui.add(simState, 'status',   ['NORMAL', 'IDLE']).name('status');
qrStateCtrl = gui.add(simState, 'qrStatus').name('qr').disable();

fMotion.open();
fWind.open();

applyGUIVisibility();

window.addEventListener('keydown', e => {
    if (e.key === 'Control') { guiVisible = !guiVisible; applyGUIVisibility(); }
});

// ── Formula UI wiring ─────────────────────────────────────────────────────────
const dirInput  = document.querySelector('#dir-input');
const windInput = document.querySelector('#wind-input');
const applyBtn  = document.querySelector('#apply-btn');
const presetsEl = document.querySelector('#presets');

dirInput.value  = startDir;
windInput.value = startWind;

// ── Auto formula cycle — random pick every 30 s ───────────────────────────────
// Each flag is checked independently; both can fire in the same tick.
// STATUS=IDLE suspends cycling; followFormula / windEnabled guard the rest.
setInterval(() => {
    if (simState.status !== 'NORMAL') return;

    let newDir  = dirInput.value;
    let newWind = windInput.value;
    let changed = false;

    if (params.autoDir && params.followFormula) {
        newDir = rndPick(DIR_FORMULAS);
        dirInput.value = newDir;
        changed = true;
    }
    if (params.autoWind && params.windEnabled) {
        newWind = rndPick(WIND_FORMULAS);
        windInput.value = newWind;
        changed = true;
    }
    if (changed) applyFormulas(newDir, newWind);
}, 30_000);

// ── QR restore ticker ─────────────────────────────────────────────────────────
// Single authority for QR restoration — runs every 5 s.
// Restores the QR when remoteTimeout seconds have elapsed since the last
// remote-event, regardless of whether the room is empty or just quiet.
// The simSpectatorCount === 0 case is covered naturally: if no one is
// connected no remote-events arrive, so lastRemoteActivity ages out.
// remoteTimeout = 0 disables automatic restoration entirely.
setInterval(() => {
    if (simState.qrStatus === 'SHOW' || !qrBitmap) return;
    if (params.remoteTimeout <= 0) return;
    if (Date.now() - lastRemoteActivity > params.remoteTimeout * 1000) restoreQR();
}, 5_000);

function apply() { applyFormulas(dirInput.value, windInput.value); }
applyBtn.addEventListener('click', apply);
[dirInput, windInput].forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
});

PRESETS.forEach(({ label, dir, wind }) => {
    const btn = document.createElement('button');
    btn.className   = 'preset-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => {
        dirInput.value  = dir;
        windInput.value = wind;
        applyFormulas(dir, wind);
    });
    presetsEl?.appendChild(btn);
});

// ── File input for trace image ────────────────────────────────────────────────
document.querySelector('#image-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) loadMagnetImage(file);
    e.target.value = '';
});

// ── Avoidance map upload ──────────────────────────────────────────────────────
async function loadAvoidMap(source) {
    let bmp;
    if (typeof source === 'string') {
        const res  = await fetch(source);
        const blob = await res.blob();
        bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    } else {
        bmp = await createImageBitmap(source, { colorSpaceConversion: 'none' });
    }
    if (avoidMapTex) avoidMapTex.destroy();
    avoidMapTex = device.createTexture({
        size:   [bmp.width, bmp.height],
        format: 'rgba8unorm',
        usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bmp }, { texture: avoidMapTex }, [bmp.width, bmp.height]);
    avoidMapTexView = avoidMapTex.createView();
    hasAvoidMap     = true;
    rebuildSimBG();
}

function clearAvoidMap() {
    if (avoidMapTex) { avoidMapTex.destroy(); avoidMapTex = null; }
    avoidMapTexView = null;
    hasAvoidMap     = false;
    rebuildSimBG();
}

document.querySelector('#avoid-map-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) loadAvoidMap(file);
    e.target.value = '';
});

// ── Trace text input ──────────────────────────────────────────────────────────
// Debounced: re-composites and uploads the trace texture 300 ms after the user
// stops typing. The text is drawn as white glyphs on top of any loaded image.
let traceTextTimer = null;
document.querySelector('#trace-text-input').addEventListener('input', () => {
    clearTimeout(traceTextTimer);
    traceTextTimer = setTimeout(() => {
        renderTraceCanvas();
        scheduleAutoClear();
    }, 300);
});

// ── Hex color → float RGB ─────────────────────────────────────────────────────
function hexToF(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

function lerpColor(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ── Contamination — mouse tracking ───────────────────────────────────────────
// Mouse position in canvas pixels (-1 = off-canvas / inactive).
// Up to 10 contamination points; for now only the mouse is wired up.
let mouseCanvasX = -1;
let mouseCanvasY = -1;

canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mouseCanvasX = (e.clientX - rect.left) * (canvas.width  / rect.width);
    mouseCanvasY = (e.clientY - rect.top)  * (canvas.height / rect.height);
});
canvas.addEventListener('mouseleave', () => { mouseCanvasX = -1; mouseCanvasY = -1; });

// ── Collective swarm state (written by 'collective-state' socket events) ───────
// Smoothed each frame via exponential moving average to avoid jarring jumps.
let collectiveBiasX   = 0;   // target wind bias X (from tilt)
let collectiveBiasY   = 0;   // target wind bias Y (from tilt)
let collectiveTemp    = 0.5; // target temperature [0=cold … 1=warm] (from touch Y)
let collectiveCoherence = 0.5; // target coherence [0=chaos … 1=order] (from touch X)

let smoothBiasX       = 0;   // smoothed versions
let smoothBiasY       = 0;
let smoothTemp        = 0.5;
let smoothCoherence   = 0.5;

// ── Join burst state ──────────────────────────────────────────────────────────
// When a spectator joins, a single brightness pulse fires across the field.
const BURST_BRIGHTNESS = 0.4;  // peak brightness boost added to params.brightness
const BURST_DECAY      = 0.88; // per frame — fully dissipated in ~0.5 s at 60 fps
const BURST_THRESHOLD  = 0.001;
let burstBrightness = 0;

// ── Uniform writers ───────────────────────────────────────────────────────────
function writeSoloUB(dt, time) {
    // Smooth collective state toward targets (~0.8 s time constant)
    const a = Math.exp(-dt / 0.8);
    smoothBiasX     = smoothBiasX     * a + collectiveBiasX     * (1 - a);
    smoothBiasY     = smoothBiasY     * a + collectiveBiasY     * (1 - a);
    smoothTemp      = smoothTemp      * a + collectiveTemp      * (1 - a);
    smoothCoherence = smoothCoherence * a + collectiveCoherence * (1 - a);

    // Decay join brightness pulse exponentially each frame
    burstBrightness *= BURST_DECAY;
    if (burstBrightness < BURST_THRESHOLD) burstBrightness = 0;

    // Coherence multiplier for turnRate:
    //   0.0 (chaos / left)  → 0.08× (agents barely steer, each follows own momentum)
    //   0.5 (neutral)       → 1.0×  (GUI turnRate unchanged)
    //   1.0 (order / right) → 3.0×  (agents snap instantly to formula direction)
    const coherenceMult = smoothCoherence < 0.5
        ? 0.08 + smoothCoherence * 2 * 0.92   // 0.08 → 1.0
        : 1.0  + (smoothCoherence - 0.5) * 4; // 1.0  → 3.0

    const ab = new ArrayBuffer(128);
    const u  = new Uint32Array(ab);
    const f  = new Float32Array(ab);
    const { x0, y0, x1, y1 } = getImageRegion();
    u[0] = params.agentCount;
    f[1] = canvas.width;
    f[2] = canvas.height;
    f[3] = params.stepLen;
    f[4] = dt;
    f[5] = time;
    const isIdle = simState.status === 'IDLE';
    f[6] = isIdle ? 0.0 : (params.windEnabled ? params.windStr : 0.0);
    f[7] = params.turnRate * coherenceMult;  // coherence scales how sharply agents follow the formula
    f[8] = params.maxSpeed;
    f[9] = params.minSpeed;
    u[10] = hasImage ? 1 : 0;
    f[11] = params.magnetStr;
    f[12] = x0;
    f[13] = y0;
    f[14] = x1;
    f[15] = y1;
    u[16] = (!isIdle && params.followFormula) ? 1 : 0;
    f[17] = params.alphaThreshold;
    f[18] = params.blackThreshold;
    const isQR = simState.qrStatus === 'SHOW';
    f[19] = isQR ? 0 : params.vignetteEdge;
    f[20] = smoothBiasX;  // collective tilt bias
    f[21] = smoothBiasY;
    f[22] = params.avoidForceStr;
    u[23] = isQR ? 1 : 0;  // qrMode — rect-based homing when QR is active
    u[24] = hasAvoidMap ? 1 : 0;
    f[25] = params.avoidMapScale;
    u[26] = params.bounceEdges ? 1 : 0;
    f[27] = params.probeLen;
    f[28] = params.probeForceStr;
    u[29] = params.respawnOnCollide ? 1 : 0;
    device.queue.writeBuffer(soloUB, 0, ab);
}

function writeRenderUB() {
    const ab   = new ArrayBuffer(84);
    const u    = new Uint32Array(ab);
    const f    = new Float32Array(ab);
    const rgb  = hexToF(params.color);
    const srgb = hexToF(params.speedColor);

    // Collective temperature tints the fast (speed) colour by up to 65%.
    // Cold (0) → deep blue  ·  neutral (0.5) → user speedColor  ·  warm (1) → amber
    const COLD  = [0.05, 0.15, 0.90];
    const WARM  = [1.00, 0.40, 0.05];
    const tintTarget = smoothTemp < 0.5
        ? lerpColor(COLD, srgb, smoothTemp * 2)
        : lerpColor(srgb, WARM, (smoothTemp - 0.5) * 2);
    const tinted = lerpColor(srgb, tintTarget, 0.65);

    const { x0, y0, x1, y1 } = getImageRegion();
    u[0] = params.agentCount;
    f[1] = canvas.width;
    f[2] = canvas.height;
    f[3] = params.pointSize;
    f[4] = rgb[0];
    f[5] = rgb[1];
    f[6] = rgb[2];
    f[7] = params.maxSpeed;
    u[8]  = hasImage ? 1 : 0;
    f[9]  = x0;
    f[10] = y0;
    f[11] = x1;
    f[12] = y1;
    f[13] = tinted[0];
    f[14] = tinted[1];
    f[15] = tinted[2];
    f[16] = params.brightness + burstBrightness;
    f[17] = params.alphaThreshold;
    f[18] = params.blackThreshold;
    f[19] = simState.qrStatus === 'SHOW' ? 0 : params.vignetteEdge;
    u[20] = simState.qrStatus === 'SHOW' ? 1 : 0;  // qrMode — darken free agents near QR rect
    device.queue.writeBuffer(renderUB, 0, ab);
}


function writeFadeUB() {
    const ab = new ArrayBuffer(16);
    new Float32Array(ab)[0] = params.trailDecay;
    device.queue.writeBuffer(fadeUB, 0, ab);
}

function writeBlitUB() {
    const ab = new ArrayBuffer(16);
    new Float32Array(ab)[0] = params.bgBlackCutoff;
    device.queue.writeBuffer(blitUB, 0, ab);
}

function writeWindVisUB(time, gridW) {
    const step = Math.round(100 * window.devicePixelRatio);
    const ab = new ArrayBuffer(32);
    const u  = new Uint32Array(ab);
    const f  = new Float32Array(ab);
    f[0] = canvas.width;
    f[1] = canvas.height;
    f[2] = time;
    f[3] = step;
    f[4] = step * 0.55;
    u[5] = gridW;
    device.queue.writeBuffer(windVisUB, 0, ab);
}

function writeAgentShadowUB() {
    const { x0, y0, x1, y1 } = getImageRegion();
    const ab = new ArrayBuffer(64);
    const f  = new Float32Array(ab);
    const u  = new Uint32Array(ab);
    f[0]  = canvas.width;
    f[1]  = canvas.height;
    u[2]  = params.agentCount;
    f[3]  = params.agentShadowRadius;
    f[4]  = params.agentShadowStr;
    u[5]  = hasImage ? 1 : 0;
    f[6]  = x0;
    f[7]  = y0;
    f[8]  = x1;
    f[9]  = y1;
    f[10] = params.alphaThreshold;
    f[11] = params.blackThreshold;
    device.queue.writeBuffer(agentShadowUB, 0, ab);
}

function writeImageDebugUB() {
    const { x0, y0, x1, y1 } = getImageRegion();
    const ab = new ArrayBuffer(32);
    const f  = new Float32Array(ab);
    f[0] = canvas.width;
    f[1] = canvas.height;
    f[2] = x0;
    f[3] = y0;
    f[4] = x1;
    f[5] = y1;
    device.queue.writeBuffer(imageDebugUB, 0, ab);
}

// Writes ContamParams (176 bytes) — header + up to 10 vec4 points.
// Points array is sparse: only active entries (count) are used by the shader.
// For now, slot 0 = mouse cursor when on-canvas; extend here to add more sources.
function writeContamUB() {
    const pts = [];
    if (params.contamMouse &&
        mouseCanvasX >= 0 && mouseCanvasX <= canvas.width &&
        mouseCanvasY >= 0 && mouseCanvasY <= canvas.height) {
        pts.push(mouseCanvasX, mouseCanvasY);
    }
    // Future: push additional contamination points here (remote touches, etc.)

    const count  = pts.length / 2;  // each point is 2 floats (x, y)
    const ab     = new ArrayBuffer(176);
    const u      = new Uint32Array(ab);
    const f      = new Float32Array(ab);
    u[0] = count;
    f[1] = params.contamRadius;
    // points start at byte 16 → float index 4; each vec4 = 4 floats (xy used, zw = 0)
    for (let k = 0; k < count; k++) {
        f[4 + k * 4]     = pts[k * 2];      // x
        f[4 + k * 4 + 1] = pts[k * 2 + 1]; // y
    }
    device.queue.writeBuffer(contamUB, 0, ab);
}

// ── Frame loop ────────────────────────────────────────────────────────────────
const TIME_MULT = 0.001;
let prevTime  = performance.now() * TIME_MULT;
let fpsFrames = 0;
let fpsLast   = performance.now();

function frame(ts) {
    requestAnimationFrame(frame);

    const now    = ts * TIME_MULT;
    const rawDt  = Math.min(Math.max(now - prevTime, TIME_MULT), 0.05);
    const dt     = params.useDeltaTime ? rawDt : (1 / 60);
    prevTime     = now;

    writeSoloUB(dt, now);
    writeRenderUB();
    writeFadeUB();
    writeBlitUB();
    writeContamUB();
    writeAgentShadowUB();

    const enc = device.createCommandEncoder();

    // Compute: move all particles
    if (simPipe) {
        const cp = enc.beginComputePass();
        cp.setPipeline(simPipe);
        cp.setBindGroup(0, simBG);
        cp.dispatchWorkgroups(Math.ceil(params.agentCount / 64));
        cp.end();
    }

    // Offscreen: fade old trail + draw new particles
    const rp = enc.beginRenderPass({
        colorAttachments: [{
            view: offscreenView, loadOp: 'load', storeOp: 'store',
        }],
    });
    rp.setPipeline(fadePipe);
    rp.setBindGroup(0, fadeBG);
    rp.draw(3);
    if (hasImage && agentShadowBG) {
        rp.setPipeline(agentShadowPipe);
        rp.setBindGroup(0, agentShadowBG);
        rp.draw(params.agentCount * 6);
    }
    if (renderBG) {
        rp.setPipeline(renderPipe);
        rp.setBindGroup(0, renderBG);
        rp.draw(params.agentCount * 6);
    }
    rp.end();

    const visStep  = Math.round(100 * window.devicePixelRatio);
    const visGridW = Math.ceil(canvas.width  / visStep) + 1;
    const visGridH = Math.ceil(canvas.height / visStep) + 1;
    if (params.showWindVis && windVisPipe) writeWindVisUB(now, visGridW);

    // Blit offscreen → canvas, then optional overlays
    const bp = enc.beginRenderPass({
        colorAttachments: [{
            view: ctx.getCurrentTexture().createView(),
            loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
        }],
    });
    bp.setPipeline(blitPipe);
    bp.setBindGroup(0, blitBG);
    bp.draw(3);
    if (params.showWindVis && windVisPipe) {
        bp.setPipeline(windVisPipe);
        bp.setBindGroup(0, windVisBG);
        bp.draw(visGridW * visGridH * 6);
    }
    if (params.showImage && hasImage && imageDebugBG) {
        writeImageDebugUB();
        bp.setPipeline(imageDebugPipe);
        bp.setBindGroup(0, imageDebugBG);
        bp.draw(6);   // 2-triangle quad covering the image region
    }
    bp.end();

    device.queue.submit([enc.finish()]);

    fpsFrames++;
    const nowMs = performance.now();
    if (nowMs - fpsLast >= 1000) {
        updateMonitor((fpsFrames * 1000) / (nowMs - fpsLast));
        fpsFrames = 0;
        fpsLast   = nowMs;
    }
}

requestAnimationFrame(frame);
