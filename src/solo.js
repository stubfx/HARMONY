// ─── Solo — Formula-Driven Wind Particle System ───────────────────────────────
// Agents are independent particles moved by two mathematical fields:
//   dirFormula  — the heading each particle wants to follow
//   windFormula — a force field that pushes them off course
// A magnet image layer guides particles toward bright areas via image gradient.
// Particles overlapping the image region are coloured by the image itself.
// Speed drives brightness. A fading trail accumulates on an offscreen texture.

import GUI              from 'lil-gui';
import soloSimTemplate  from './shaders/solo_sim.wgsl?raw';
import soloRenderWGSL   from './shaders/solo_render.wgsl?raw';

// ── Tunable parameters (mutated by lil-gui) ───────────────────────────────────
const params = {
    // Motion
    stepLen:     2.0,
    turnRate:    0.04,
    maxSpeed:    5.0,
    minSpeed:    0.2,
    // Wind
    windEnabled: true,
    windStr:     0.3,
    showWindVis: false,
    // Visual
    trailDecay:  0.055,
    pointSize:   2.0,
    color:       '#ffffff',
    // Magnet
    magnetStr:   1.0,
    imageSize:   0.316,   // fraction of each screen dimension (0.316² ≈ 1/10 screen area)
    showImage:   false,
    // Weight
    weightSpread: 0.8,    // 0 = all equal; 1 = weights span [0.05 … 1.95]
};

// ── Config ────────────────────────────────────────────────────────────────────
const AGENT_COUNT = 1_000_000;

const DEFAULT_DIR  = 'sin(x * 0.006 + t * 0.4) * PI';
const DEFAULT_WIND = 'sin(x * 0.004 + t * 0.3) * PI + cos(y * 0.003 + t * 0.2) * 0.8';

const PRESETS = [
    { label: 'waves + weather', dir: 'sin(x * 0.006 + t * 0.4) * PI',                                       wind: 'sin(x * 0.004 + t * 0.3) * PI + cos(y * 0.003 + t * 0.2) * 0.8' },
    { label: 'spiral',          dir: 'atan2(y - cy, x - cx) + t * 0.3',                                      wind: 'sin(x * 0.005 + t * 0.4) * PI + cos(y * 0.005 - t * 0.3) * PI * 0.6' },
    { label: 'cells',           dir: 'sin(x * 0.006) * cos(y * 0.006) * TWO_PI',                             wind: 'sin(x * 0.006 + sin(y * 0.005 + t * 0.4)) * TWO_PI' },
    { label: 'vortex',          dir: 'atan2(y - cy, x - cx) + PI * 0.5',                                     wind: 'atan2(y - cy, x - cx) + t + sin(x * 0.003) * 0.8' },
    { label: 'turbulence',      dir: 'sin(x * 0.009 + sin(y * 0.006 + t)) * TWO_PI',                        wind: 'sin(x * 0.005 + cos(y * 0.006 + t * 0.3)) * TWO_PI' },
    { label: 'radial pulse',    dir: 'atan2(y-cy,x-cx) + sin(length(vec2(x-cx,y-cy))*0.012 - t*1.5)*PI',   wind: 'sin(x * 0.004 - y * 0.003 + t * 0.4) * TWO_PI' },
];

// ── Inline micro-shaders ──────────────────────────────────────────────────────
const FADE_WGSL = `
struct FP { alpha: f32, _0: u32, _1: u32, _2: u32 }
@group(0) @binding(0) var<uniform> p: FP;
struct V { @builtin(position) pos: vec4<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
    var pts = array<vec2<f32>,3>(vec2(-1.,3.),vec2(3.,-1.),vec2(-1.,-1.));
    return V(vec4<f32>(pts[i], 0., 1.));
}
@fragment fn fs(v: V) -> @location(0) vec4<f32> { return vec4(0.,0.,0.,p.alpha); }
`;

const BLIT_WGSL = `
@group(0) @binding(0) var s: sampler;
@group(0) @binding(1) var t: texture_2d<f32>;
struct V { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
    var p = array<vec2<f32>,3>(vec2(-1.,3.),vec2(3.,-1.),vec2(-1.,-1.));
    var u = array<vec2<f32>,3>(vec2(0.,-1.),vec2(2.,1.),vec2(0.,1.));
    return V(vec4<f32>(p[i],0.,1.), u[i]);
}
@fragment fn fs(v: V) -> @location(0) vec4<f32> {
    return textureSampleLevel(t, s, v.uv, 0.0);
}
`;

// Wind visualisation: red arrows drawn on the canvas at a ~100px grid.
const WIND_VIS_WGSL = `
struct WP { canvasW:f32, canvasH:f32, time:f32, gridStep:f32, arrowLen:f32, gridW:u32, _p0:u32, _p1:u32 }
@group(0) @binding(0) var<uniform> p: WP;
struct V { @builtin(position) pos: vec4<f32>, @location(0) bright: f32 }
const PI:f32 = 3.14159265358979; const TWO_PI:f32 = 6.28318530717959;
@vertex fn vs(@builtin(vertex_index) vi: u32) -> V {
    let ai  = vi / 6u;
    let seg = (vi % 6u) / 2u;
    let isB = (vi % 2u) == 1u;
    let gx  = ai % p.gridW;
    let gy  = ai / p.gridW;
    let cx  = p.canvasW * 0.5;  let cy = p.canvasH * 0.5;
    let px  = (f32(gx) + 0.5) * p.gridStep;
    let py  = (f32(gy) + 0.5) * p.gridStep;
    let angle = evalWindFormula(px, py, p.time, f32(ai), cx, cy);
    let dir   = vec2<f32>(cos(angle), sin(angle));
    let perp  = vec2<f32>(-dir.y, dir.x);
    let half  = p.arrowLen * 0.5;
    let tip   = vec2<f32>(px, py) + dir * half;
    let tail  = vec2<f32>(px, py) - dir * half;
    let hlen  = p.arrowLen * 0.28;
    let hwid  = p.arrowLen * 0.16;
    var pos: vec2<f32>;
    var bright: f32;
    if (seg == 0u) {
        pos = select(tail, tip, isB);  bright = select(0.15, 1.0, isB);
    } else if (seg == 1u) {
        pos = select(tip, tip - dir * hlen + perp * hwid, isB);  bright = select(1.0, 0.45, isB);
    } else {
        pos = select(tip, tip - dir * hlen - perp * hwid, isB);  bright = select(1.0, 0.45, isB);
    }
    let ndc = vec2<f32>(pos.x / p.canvasW * 2.0 - 1.0, -(pos.y / p.canvasH * 2.0 - 1.0));
    return V(vec4<f32>(ndc, 0.0, 1.0), bright);
}
@fragment fn fs(v: V) -> @location(0) vec4<f32> { return vec4<f32>(v.bright, 0.0, 0.0, 1.0); }
`;

// Image debug: grayscale 50% overlay, drawn as a centered 1/4-screen quad.
// DP layout (32 bytes): canvasW, canvasH, x0, y0, x1, y1, _p0, _p1
const IMAGE_DEBUG_WGSL = `
struct DP { canvasW:f32, canvasH:f32, x0:f32, y0:f32, x1:f32, y1:f32, _p0:u32, _p1:u32 }
@group(0) @binding(0) var<uniform> p: DP;
@group(0) @binding(1) var s: sampler;
@group(0) @binding(2) var t: texture_2d<f32>;
struct V { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
    var lo = array<vec2<f32>,6>(
        vec2(0.,0.), vec2(1.,0.), vec2(1.,1.),
        vec2(0.,0.), vec2(1.,1.), vec2(0.,1.),
    );
    let lp  = lo[i];
    let px  = p.x0 + lp.x * (p.x1 - p.x0);
    let py  = p.y0 + lp.y * (p.y1 - p.y0);
    let ndc = vec2<f32>(px / p.canvasW * 2.0 - 1.0, -(py / p.canvasH * 2.0 - 1.0));
    return V(vec4<f32>(ndc, 0., 1.), lp);
}
@fragment fn fs(v: V) -> @location(0) vec4<f32> {
    let c = textureSampleLevel(t, s, v.uv, 0.0).r;
    return vec4<f32>(c, c, c, 0.5);
}
`;

// ── Canvas ────────────────────────────────────────────────────────────────────
const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:block;';
document.body.prepend(canvas);

function setSize() {
    canvas.width  = Math.floor(window.innerWidth  * window.devicePixelRatio);
    canvas.height = Math.floor(window.innerHeight * window.devicePixelRatio);
}
setSize();

// ── UI helpers ────────────────────────────────────────────────────────────────
const errEl = document.querySelector('#error-msg');
function showError(msg) { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } }
function hideError()    { if (errEl) errEl.style.display = 'none'; }

// ── Image region: centered square, size = params.imageSize fraction of each dimension ──
// imageSize = 1.0 → full screen; 0.316 → ~1/10 of screen area (√0.1 per side)
function getImageRegion() {
    const hw = canvas.width  * params.imageSize / 2;
    const hh = canvas.height * params.imageSize / 2;
    const cx = canvas.width  / 2;
    const cy = canvas.height / 2;
    return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
}

// ── WebGPU init ───────────────────────────────────────────────────────────────
if (!navigator.gpu) { showError('WebGPU not supported in this browser.'); throw new Error(); }
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter)       { showError('No WebGPU adapter found.'); throw new Error(); }
const device = await adapter.requestDevice();
device.addEventListener('uncapturederror', e => showError(e.error.message));

const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
const ctx = canvas.getContext('webgpu');
ctx.configure({ device, format: canvasFormat, alphaMode: 'opaque' });

// ── Persistent GPU buffers ────────────────────────────────────────────────────
const agentBuf = device.createBuffer({
    size: AGENT_COUNT * 24,   // [pos.xy, vel.xy, weight, _pad] = 6 × f32 = 24 bytes
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const soloUB = device.createBuffer({
    size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const renderUB = device.createBuffer({
    size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const fadeUB = device.createBuffer({
    size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const windVisUB = device.createBuffer({
    size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const imageDebugUB = device.createBuffer({
    size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

function seedAgents() {
    const data = new Float32Array(AGENT_COUNT * 6);   // 6 floats × 4 bytes = 24 bytes/agent
    for (let i = 0; i < AGENT_COUNT; i++) {
        const b = i * 6;
        data[b]     = Math.random() * canvas.width;
        data[b + 1] = Math.random() * canvas.height;
        const a = Math.random() * Math.PI * 2;
        const s = 0.5 + Math.random() * 1.5;
        data[b + 2] = Math.cos(a) * s;
        data[b + 3] = Math.sin(a) * s;
        // weight: centred on 1.0, spread controlled by GUI
        data[b + 4] = Math.max(0.05, 1.0 + (Math.random() * 2 - 1) * params.weightSpread);
        data[b + 5] = 0;   // _pad
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

const imageSampler = device.createSampler({
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
});

// Fade: black quad, alpha blend
const fadeMod = device.createShaderModule({ code: FADE_WGSL });
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

// Particles: additive blend — now with image sampler/texture at bindings 2 & 3
const renderMod = device.createShaderModule({ code: soloRenderWGSL });
const renderPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: renderMod, entryPoint: 'vs' },
    fragment: {
        module: renderMod, entryPoint: 'fs',
        targets: [{
            format: 'rgba8unorm',
            blend: {
                color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
        }],
    },
    primitive: { topology: 'triangle-list' },
});
// renderBG is rebuilt whenever the image changes (see rebuildRenderBG)
let renderBG = null;

// Blit: copy offscreen → canvas swap-chain
const blitMod = device.createShaderModule({ code: BLIT_WGSL });
const blitPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: blitMod, entryPoint: 'vs' },
    fragment: {
        module: blitMod, entryPoint: 'fs',
        targets: [{ format: canvasFormat }],
    },
    primitive: { topology: 'triangle-list' },
});

// Image debug: centered 1/4-screen quad, 50% opacity grayscale
const imageDebugMod = device.createShaderModule({ code: IMAGE_DEBUG_WGSL });
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
            { binding: 0, resource: screenSmp },
            { binding: 1, resource: offscreenView },
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
    seedAgents();
});

// ── Magnet image state ────────────────────────────────────────────────────────
let hasImage     = false;
let imageTex     = null;
let imageTexView = null;
let imageDebugBG = null;

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

async function loadMagnetImage(file) {
    const bmp = await createImageBitmap(file, { colorSpaceConversion: 'none' });
    if (imageTex) imageTex.destroy();
    imageTex = device.createTexture({
        size:   [bmp.width, bmp.height],
        format: 'rgba8unorm',
        usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
        { source: bmp },
        { texture: imageTex },
        [bmp.width, bmp.height],
    );
    imageTexView = imageTex.createView();
    hasImage     = true;
    rebuildSimBG();
    rebuildRenderBG();
    rebuildImageDebugBG();
}

function clearMagnetImage() {
    hasImage     = false;
    imageTexView = null;
    if (imageTex) { imageTex.destroy(); imageTex = null; }
    imageDebugBG = null;
    rebuildSimBG();
    rebuildRenderBG();
}

// ── Formula compute + wind-vis pipelines (rebuilt on each formula change) ──────
let simPipe     = null;
let simBG       = null;
let windVisPipe = null;
let windVisBG   = null;

function rebuildSimBG() {
    if (!simPipe) return;
    const texView = (hasImage && imageTexView) ? imageTexView : placeholderTexView;
    simBG = device.createBindGroup({
        layout: simPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: soloUB } },
            { binding: 1, resource: { buffer: agentBuf } },
            { binding: 2, resource: imageSampler },
            { binding: 3, resource: texView },
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
        code: `fn evalWindFormula(x:f32,y:f32,t:f32,idx:f32,cx:f32,cy:f32)->f32{ return ${wind}; }\n` + WIND_VIS_WGSL,
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

async function applyFormulas(dir, wind) {
    try {
        await buildSimPipeline(dir.trim() || DEFAULT_DIR, wind.trim() || DEFAULT_WIND);
        hideError();
        seedAgents();
    } catch (e) {
        showError(e.message);
    }
}

await applyFormulas(DEFAULT_DIR, DEFAULT_WIND);

// ── lil-gui ───────────────────────────────────────────────────────────────────
const gui = new GUI({ title: 'Wind Particles', width: 260 });

const fMotion = gui.addFolder('Motion');
fMotion.add(params, 'stepLen',      0.1, 8,    0.1).name('base speed');
fMotion.add(params, 'turnRate',     0.005, 0.3, 0.005).name('turn rate');
fMotion.add(params, 'maxSpeed',     1,    15,   0.5).name('max speed');
fMotion.add(params, 'minSpeed',     0,    2,    0.05).name('min speed');
fMotion.add(params, 'weightSpread', 0,    1,    0.01).name('weight spread')
    .onChange(() => seedAgents());

const fWind = gui.addFolder('Wind');
const windStrCtrl = fWind.add(params, 'windStr', 0, 2, 0.01).name('strength');
fWind.add(params, 'windEnabled').name('enabled').onChange(v => windStrCtrl.enable(v));
fWind.add(params, 'showWindVis').name('show arrows');

const fVis = gui.addFolder('Visual');
fVis.add(params,  'trailDecay', 0.005, 0.4, 0.005).name('trail decay');
fVis.add(params,  'pointSize',  1, 6, 0.1).name('point size');
fVis.addColor(params, 'color').name('color');

const fMagnet = gui.addFolder('Magnet Image');
fMagnet.add(params, 'magnetStr',  0, 10,  0.1).name('strength');
fMagnet.add(params, 'imageSize', 0.05, 1.0, 0.01).name('size');
fMagnet.add(params, 'showImage').name('show image');
fMagnet.add({ load: () => document.querySelector('#image-input').click() }, 'load').name('Load image…');
fMagnet.add({ clear: clearMagnetImage }, 'clear').name('Clear image');

gui.add({ restart: () => seedAgents() }, 'restart').name('↺  Restart');

fMotion.open();
fWind.open();

// ── Formula UI wiring ─────────────────────────────────────────────────────────
const dirInput  = document.querySelector('#dir-input');
const windInput = document.querySelector('#wind-input');
const applyBtn  = document.querySelector('#apply-btn');
const presetsEl = document.querySelector('#presets');

dirInput.value  = DEFAULT_DIR;
windInput.value = DEFAULT_WIND;

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

// ── File input for magnet image ───────────────────────────────────────────────
document.querySelector('#image-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) loadMagnetImage(file);
    e.target.value = '';
});

// ── Hex color → float RGB ─────────────────────────────────────────────────────
function hexToF(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

// ── Uniform writers ───────────────────────────────────────────────────────────
function writeSoloUB(dt, time) {
    const ab = new ArrayBuffer(64);
    const u  = new Uint32Array(ab);
    const f  = new Float32Array(ab);
    const { x0, y0, x1, y1 } = getImageRegion();
    u[0] = AGENT_COUNT;
    f[1] = canvas.width;
    f[2] = canvas.height;
    f[3] = params.stepLen;
    f[4] = dt;
    f[5] = time;
    f[6] = params.windEnabled ? params.windStr : 0.0;
    f[7] = params.turnRate;
    f[8] = params.maxSpeed;
    f[9] = params.minSpeed;
    u[10] = hasImage ? 1 : 0;
    f[11] = params.magnetStr;
    f[12] = x0;
    f[13] = y0;
    f[14] = x1;
    f[15] = y1;
    device.queue.writeBuffer(soloUB, 0, ab);
}

function writeRenderUB() {
    const ab  = new ArrayBuffer(64);
    const u   = new Uint32Array(ab);
    const f   = new Float32Array(ab);
    const rgb = hexToF(params.color);
    const { x0, y0, x1, y1 } = getImageRegion();
    u[0] = AGENT_COUNT;
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
    device.queue.writeBuffer(renderUB, 0, ab);
}

function writeFadeUB() {
    const ab = new ArrayBuffer(16);
    new Float32Array(ab)[0] = params.trailDecay;
    device.queue.writeBuffer(fadeUB, 0, ab);
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

// ── Frame loop ────────────────────────────────────────────────────────────────
const TIME_MULT = 0.001;
let prevTime = performance.now() * TIME_MULT;

function frame(ts) {
    requestAnimationFrame(frame);

    const now = ts * TIME_MULT;
    const dt  = Math.min(Math.max(now - prevTime, TIME_MULT), 0.05);
    prevTime  = now;

    writeSoloUB(dt, now);
    writeRenderUB();
    writeFadeUB();

    const enc = device.createCommandEncoder();

    // Compute: move all particles
    if (simPipe) {
        const cp = enc.beginComputePass();
        cp.setPipeline(simPipe);
        cp.setBindGroup(0, simBG);
        cp.dispatchWorkgroups(Math.ceil(AGENT_COUNT / 64));
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
    rp.setPipeline(renderPipe);
    rp.setBindGroup(0, renderBG);
    rp.draw(AGENT_COUNT * 6);
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
}

requestAnimationFrame(frame);
