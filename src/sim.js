// ─── Solo — Formula-Driven Wind Particle System ───────────────────────────────
// Agents are independent particles moved by two mathematical fields:
//   dirFormula  — the heading each particle wants to follow
//   windFormula — a force field that pushes them off course
// A magnet image layer guides particles toward bright areas via image gradient.
// Particles overlapping the image region are coloured by the image itself.
// Speed drives brightness. A fading trail accumulates on an offscreen texture.

import { initGUI }      from './gui.js';
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
const MAX_AGENTS = 5_000_000;

// ── Tunable parameters (mutated by lil-gui) ───────────────────────────────────
const params = {
    // Agents
    agentCount:  2_000_000,
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
    pointSize:      1.3,
    color:       '#1a0099',
    speedColor:  '#ff4400',   // color approached at max speed
    brightness:  0.06,        // per-particle alpha; prevents additive saturation to white
    additiveBlend: true,      // true = additive (glow, accumulates); false = max blend (no over-brightness)
    toneBlack:   0.0,         // input level mapped to black (lifts lone-particle visibility)
    toneWhite:   1.0,         // input level mapped to white (HDR saturation point)
    toneGamma:   1.0,         // power curve: <1 boosts darks, >1 crushes darks
    shadowBoost: 0.0,         // inverse-brightness boost: peaks at ~12% luminance, negligible above 60%
    // Magnet
    magnetStr:      30.0, // homing speed: px/frame agents move toward their home position
    alphaThreshold: 0.1,  // min image alpha to trigger homing (0–1)
    blackThreshold: 0.05, // luminance below which pixels are treated as transparent
    vignetteEdge:   0.08, // edge fade width in UV units (0 = none, 0.5 = half image)
    imageSize:      0.316, // user content size as fraction of min(traceW, traceH)
    imageX:         0.5,  // user content center X in screen-space 0–1
    imageY:         0.5,  // user content center Y in screen-space 0–1
    showImage:    false,
    // Trace canvas
    traceScale:   0.5,   // trace canvas resolution relative to main canvas (perf control)
    // QR placement on trace canvas
    qrSize:       0.25,   // QR size as fraction of min(traceW, traceH)
    qrMargin:     0.02,  // uniform margin from the aligned edge, as fraction of min(traceW, traceH)
    qrAlignX:     'center', // 'left' | 'center' | 'right'
    qrAlignY:     'center', // 'top'  | 'center' | 'bottom'
    qrQuietZone:  0,        // quiet zone in QR modules (0 = none, 4 = spec minimum)
    qrInvert:     false,    // swap dark/light: transparent modules on white background
    // Contamination
    contamMouse:   false, // treat mouse cursor as a contamination point
    contamPush:    false, // push free agents outward from the eraser circle
    contamRadius:  150,   // radius of each contamination circle, in canvas pixels
    // Agent shadow
    agentShadowStr:    0.20, // peak opacity of each homing-agent shadow splat (0–1)
    agentShadowRadius: 10,   // splat half-radius in canvas pixels
    // Homing behaviour
    homingChance:    0.2, // per-frame probability [0–1] that a newly-eligible agent commits to homing
    homingInfluence: 1.0, // max homing blend weight at dist=0; falls to 0 at dist=canvasW
    // Homing proximity fade
    homingProximityRange: 300, // canvas px — distance over which homing agents fade in
    homingMinAlpha:       0.1, // minimum alpha for a homing agent at max distance (0–1)
    // Avoidance
    avoidForceStr:   1.0, // multiplier on image-trace avoidance forces
    avoidMapScale:   1.0, // avoidance map coverage as fraction of canvas (1.0 = full)
    qrOverlay:       false, // true = QR on a 2D overlay canvas; agents freed from QR area
    qrAvoidMargin:   0.01,  // extra padding around QR in the avoid zone, as fraction of minDim
    qrAvoidFade:     0.01,  // blur radius of the avoid zone edge, as fraction of minDim
    // Primed-spot probe (free agents only)
    probeLen:          50.0, // probe cast distance in canvas pixels
    probeForceStr:     150.0, // steering force multiplier when probe hits a primed pixel
    respawnOnCollide:  false, // teleport to a random edge position instead of steering on probe hit
    probeSensorAngle:  0.785, // half-angle between left/right Physarum sensors (radians; π/4 ≈ 45°)
    // Caption
    captionSize:   0.055, // font size as fraction of min(canvas width, canvas height)
    // Auto-clear
    clearDelay:    0,     // seconds before auto-clearing user trace content (0 = disabled)
    // Spectator partitioning
    spectatorSpawnChance:      0.01, // base per-frame spawn probability (scaled by user count × multiplier)
    spectatorSpawnMultiplier:  3,    // scales spawn chance proportionally with active user count
    spawnerSpeed:           0.3,  // canvas fractions per second the spawner moves at full joystick deflection
    spawnerVelocityBoost:   2.0,  // multiplier applied to spawnerSpeed when joystick is moved quickly (0 = no boost)
    spawnerSteering:        6,    // direction-change rate (1/s); lower = wider curves, higher = tighter turns
    spawnerInactiveTimeout: 5,    // seconds of joystick silence before spawner goes inactive
    // Session / QR restore
    remoteTimeout:  0,    // seconds of silence from all remotes before QR is restored (0 = disabled)
    maxSpectators:  1,    // sim QR hides when connected count reaches this threshold
    qrFadeZone:     false, // fade free agents near the QR rect to keep it scannable
    n8nTestMode:       false, // true = /webhook-test/sim-event, false = /webhook/sim-event
    heartbeatInterval: 5,    // seconds between periodic param snapshots sent to n8n (0 = off)
    // Weight
    weightSpread: 0.8,    // 0 = all equal; 1 = weights span [0.05 … 1.95]
    // Motion behaviour
    followFormula: true,  // false = free drift (wind + magnet only)
    autoDir:       true,  // randomly cycle dir formula every 30 s
    bounceEdges:   false, // reflect agents at canvas edges instead of wrapping
    useDeltaTime:  true,  // false = fixed 1/60 s timestep (no frame-spike compensation)
};

// ── URL param overrides ───────────────────────────────────────────────────────
// ?s=<uuid>      — pin the sim to a specific session room (survives reloads via URL)
// ?amount=<n>    — override the starting agent count (still adjustable in the GUI)
const _urlParams     = new URLSearchParams(location.search);
const _forcedSession = _urlParams.get('s') || null;
{
    const n = parseInt(_urlParams.get('amount') ?? '', 10);
    if (Number.isFinite(n) && n > 0)
        params.agentCount = Math.max(1_000, Math.min(MAX_AGENTS, n));
}

const DEFAULT_DIR  = 'atan2(y-cy,x-cx) + sin(length(vec2(x-cx,y-cy))*0.012 - t*1.5)*PI';
const DEFAULT_WIND = 'sin(x * 0.004 - y * 0.003 + t * 0.4) * TWO_PI';

// Idle formulas (kept for reference; not applied automatically)
const IDLE_DIR  = 'atan2(cy - y, cx - x)';
const IDLE_WIND = 'atan2(y - cy, x - cx) + sin(length(vec2(x-cx,y-cy)) * 0.008) * PI + t';

// DOT mode — wobbly inward spiral; applied automatically when status === 'DOT'
// Direction wobbles around the inward vector; wind is tangential + time-varying.
const DOT_DIR  = 'atan2(cy - y, cx - x) + sin(t * 1.4 + length(vec2(x-cx,y-cy)) * 0.012) * PI * 0.38';
const DOT_WIND = 'atan2(cy - y, cx - x) + PI * 0.46 + sin(t * 0.65 + length(vec2(x-cx,y-cy)) * 0.007) * 0.6';

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

// QR overlay: 2D canvas on top of the simulation, below GUI (z-index 10).
// Shown only when qrOverlay is on and the QR is active; fades via CSS opacity.
const qrOverlayEl = document.createElement('canvas');
qrOverlayEl.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:10;opacity:0;transition:opacity 0.6s ease;image-rendering:pixelated;';
document.body.appendChild(qrOverlayEl);

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
    if (monFps)    monFps.textContent    = `${fps | 0} fps`;
    if (monAgents) monAgents.textContent = `${params.agentCount / 1_000_000 | 0}M agents`;
}

/// ── Image region ──────────────────────────────────────────────────────────────
// The trace canvas always maps 1:1 to the full screen. Shaders receive the
// full-screen rect so agents can home to any bright pixel anywhere on screen.
function getImageRegion() {
    return { x0: 0, y0: 0, x1: canvas.width, y1: canvas.height };
}

// ── WebGPU init ───────────────────────────────────────────────────────────────
if (!navigator.gpu) { showError('WebGPU not supported in this browser.'); throw new Error(); }
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter)       { showError('No WebGPU adapter found.'); throw new Error(); }
const device = await adapter.requestDevice({
    requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize:               adapter.limits.maxBufferSize,
    },
});
device.addEventListener('uncapturederror', e => {
    console.error('[WebGPU uncaptured error]', e.error.message);
    showError(e.error.message);
});

// WebGPU device loss (Vulkan driver crash, GPU reset, etc.).
// The RAF loop cannot recover from this — reload the page to get a fresh device.
let deviceLost = false;
device.lost.then(({ reason, message }) => {
    deviceLost = true;
    console.error('[WebGPU] device lost:', reason, message);
    setTimeout(() => location.reload(), 3000);
});

const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
const ctx = canvas.getContext('webgpu');
ctx.configure({ device, format: canvasFormat, alphaMode: 'opaque' });

// ── Persistent GPU buffers ────────────────────────────────────────────────────
const agentBuf = device.createBuffer({
    size: MAX_AGENTS * 32,    // [pos.xy, vel.xy, home.xy, weight, primed] = 8 × f32 = 32 bytes
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const soloUB = device.createBuffer({
    size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const renderUB = device.createBuffer({
    size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const fadeUB = device.createBuffer({
    size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const blitUB = device.createBuffer({
    size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
// SpectatorSlots: 16 slots × 48 bytes (12 × f32/u32 per slot) = 768 bytes
const spectatorSlotsBuf = device.createBuffer({
    size: 768, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
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
        data[b + 7] = 0;                             // primed — compute writes this each frame
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
            format: 'rgba16float',
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
            format: 'rgba16float',
            blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'one',        dstFactor: 'one', operation: 'add' },
            },
        }],
    },
    primitive: { topology: 'triangle-list' },
});
// Max blend: result = max(src, dst) per channel — luminosity can never exceed a
// single particle's color. No accumulation, no color-space math needed.
// srcFactor / dstFactor must be 'one' when operation is 'max' (WebGPU spec).
const renderPipeNormal = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: renderMod, entryPoint: 'vs' },
    fragment: {
        module: renderMod, entryPoint: 'fs',
        targets: [{
            format: 'rgba16float',
            blend: {
                color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
                alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
            },
        }],
    },
    primitive: { topology: 'triangle-list' },
});

// renderBG / renderBGNormal are rebuilt whenever the image changes (see rebuildRenderBG)
let renderBG       = null;
let renderBGNormal = null;

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
    size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const agentShadowMod  = device.createShaderModule({ code: agentShadowWGSL });
const agentShadowPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: agentShadowMod, entryPoint: 'vs' },
    fragment: {
        module: agentShadowMod, entryPoint: 'fs',
        targets: [{
            format: 'rgba16float',
            blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one',        dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
        }],
    },
    primitive: { topology: 'triangle-list' },
});
const agentShadowDensityPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: agentShadowMod, entryPoint: 'vs' },
    fragment: {
        module: agentShadowMod, entryPoint: 'fs_density',
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
let agentShadowBG        = null;
let agentShadowDensityBG = null;

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
let offscreenTex       = null;
let offscreenView      = null;
let blitBG             = null;
let shadowDensityTex   = null;
let shadowDensityView  = null;

function rebuildOffscreen() {
    if (offscreenTex) offscreenTex.destroy();
    offscreenTex = device.createTexture({
        size:   [canvas.width, canvas.height],
        format: 'rgba16float',
        usage:  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    offscreenView = offscreenTex.createView();

    if (shadowDensityTex) shadowDensityTex.destroy();
    shadowDensityTex = device.createTexture({
        size:   [canvas.width, canvas.height],
        format: 'rgba8unorm',
        usage:  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    shadowDensityView = shadowDensityTex.createView();

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
    rebuildSimBG();
    renderTraceCanvas();
    rebuildAgentShadowBG();
    rebuildAgentShadowDensityBG();
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
    const entries = [
        { binding: 0, resource: { buffer: renderUB } },
        { binding: 1, resource: { buffer: agentBuf } },
        { binding: 2, resource: imageSampler },
        { binding: 3, resource: texView },
        { binding: 4, resource: { buffer: spectatorSlotsBuf } },
    ];
    renderBG       = device.createBindGroup({ layout: renderPipe.getBindGroupLayout(0),       entries });
    renderBGNormal = device.createBindGroup({ layout: renderPipeNormal.getBindGroupLayout(0), entries });
}
rebuildRenderBG();
rebuildAgentShadowBG();
rebuildAgentShadowDensityBG();

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
    agentShadowBG = device.createBindGroup({
        layout: agentShadowPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: agentShadowUB } },
            { binding: 1, resource: { buffer: agentBuf } },
            { binding: 2, resource: { buffer: contamUB } },
        ],
    });
}

function rebuildAgentShadowDensityBG() {
    agentShadowDensityBG = device.createBindGroup({
        layout: agentShadowDensityPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: agentShadowUB } },
            { binding: 1, resource: { buffer: agentBuf } },
            { binding: 2, resource: { buffer: contamUB } },
        ],
    });
}

// ── QR overlay + avoid map ────────────────────────────────────────────────────
// When qrOverlay is on the QR is displayed on qrOverlayEl (not baked into the trace),
// and the qrBitmap is uploaded as the avoid map so agents naturally avoid the QR area.
// White QR modules (r=1) repel agents; blur merges them into a solid repulsion zone.
let _inQROverlayUpdate = false;
function updateQROverlay() {
    const visible = params.qrOverlay && simState.qrStatus === 'SHOW' && !!qrBitmap;
    qrOverlayEl.style.opacity = visible ? '1' : '0';
    if (!visible) {
        _inQROverlayUpdate = true;
        clearAvoidMap();
        _inQROverlayUpdate = false;
        return;
    }

    // ── Display layer ──────────────────────────────────────────────────────────
    qrOverlayEl.width  = canvas.width;
    qrOverlayEl.height = canvas.height;
    const octx   = qrOverlayEl.getContext('2d');
    octx.clearRect(0, 0, canvas.width, canvas.height);
    const minDim = Math.min(canvas.width, canvas.height);
    const size   = params.qrSize   * minDim;
    const margin = params.qrMargin * minDim + size / 2;
    const cx     = params.qrAlignX === 'left'   ? margin
                 : params.qrAlignX === 'right'  ? canvas.width  - margin
                 :                                canvas.width  / 2;
    const cy     = params.qrAlignY === 'top'    ? margin
                 : params.qrAlignY === 'bottom' ? canvas.height - margin
                 :                                canvas.height / 2;
    octx.drawImage(qrBitmap, cx - size / 2, cy - size / 2, size, size);

    // ── Avoid map layer ────────────────────────────────────────────────────────
    // Draw qrBitmap (white modules on transparent) to a full-canvas 2D element.
    // Blur merges adjacent module halos into a continuous repulsion field.
    const avoidCanvas  = document.createElement('canvas');
    avoidCanvas.width  = canvas.width;
    avoidCanvas.height = canvas.height;
    const actx   = avoidCanvas.getContext('2d');
    const pad    = params.qrAvoidMargin * minDim;
    const blurPx = params.qrAvoidFade   * minDim;
    if (blurPx > 0) actx.filter = `blur(${blurPx}px)`;
    actx.drawImage(qrBitmap, cx - size / 2 - pad, cy - size / 2 - pad, size + 2 * pad, size + 2 * pad);
    if (blurPx > 0) actx.filter = 'none';

    if (avoidMapTex) avoidMapTex.destroy();
    avoidMapTex = device.createTexture({
        size:   [canvas.width, canvas.height],
        format: 'rgba8unorm',
        usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
        { source: avoidCanvas },
        { texture: avoidMapTex },
        [canvas.width, canvas.height],
    );
    avoidMapTexView = avoidMapTex.createView();
    hasAvoidMap     = true;
    rebuildSimBG();
}

// ── Trace canvas compositor ───────────────────────────────────────────────────
// The trace canvas is always full-screen (scaled by traceScale for performance).
// Each element is composited at its own (x, y, size) in screen-space 0–1 coords:
//
//   Layer 0 — QR code:      drawn at (qrX, qrY), sized by qrSize.
//                            Only drawn when qrStatus === 'SHOW' and qrBitmap exists.
//   Layer 1 — user image:   drawn at (imageX, imageY), sized by imageSize.
//   Layer 2 — user text:    drawn at (imageX, imageY) over the image, or as multi-
//                            line standalone text when no image is present.
//
// The resulting texture covers the full screen, so getImageRegion() returns the
// full-screen rect and agents can home to any bright pixel on screen.
let captionText = ''; // story caption — drawn at bottom of trace canvas like subtitle

function renderTraceCanvas() {
    if (!device) return;

    const text       = document.querySelector('#trace-text-input')?.value.trim() ?? '';
    const hasText    = text.length > 0;
    const hasCaption = captionText.length > 0;
    const hasUserContent = !!imageBitmap || hasText || hasCaption;
    // When qrOverlay is on the QR lives on the 2D overlay canvas, not the trace.
    const showQR = !params.qrOverlay && simState.qrStatus === 'SHOW' && !!qrBitmap;

    // Nothing at all — tear down and return to formula-only mode
    if (!showQR && !hasUserContent) {
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
        rebuildAgentShadowDensityBG();
        updateQROverlay();
        return;
    }

    // ── 1. Canvas dimensions — always screen-proportioned, scaled for performance ─
    const MAX_DIM = device.limits.maxTextureDimension2D;
    const tcW = Math.min(Math.max(1, Math.round(canvas.width  * params.traceScale)), MAX_DIM);
    const tcH = Math.min(Math.max(1, Math.round(canvas.height * params.traceScale)), MAX_DIM);
    const minDim = Math.min(tcW, tcH);

    // ── 2. Paint layers ───────────────────────────────────────────────────────
    if (!traceCanvas) traceCanvas = document.createElement('canvas');
    traceCanvas.width  = tcW;
    traceCanvas.height = tcH;
    const ctx = traceCanvas.getContext('2d');
    ctx.clearRect(0, 0, tcW, tcH);

    // Layer 0: user image — cover-fit to fill the full trace canvas
    if (imageBitmap) {
        const imgAspect    = imageBitmap.width / imageBitmap.height;
        const canvasAspect = tcW / tcH;
        let sx, sy, sw, sh;
        if (imgAspect > canvasAspect) {
            sh = imageBitmap.height;
            sw = sh * canvasAspect;
            sx = (imageBitmap.width - sw) / 2;
            sy = 0;
        } else {
            sw = imageBitmap.width;
            sh = sw / canvasAspect;
            sx = 0;
            sy = (imageBitmap.height - sh) / 2;
        }
        ctx.drawImage(imageBitmap, sx, sy, sw, sh, 0, 0, tcW, tcH);
    }

    // Layer 2: text — at (imageX, imageY), multi-line when no image is present
    if (hasText) {
        ctx.fillStyle    = 'white';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        const cx = params.imageX * tcW;
        const cy = params.imageY * tcH;

        if (!imageBitmap) {
            // Multi-line word-wrap centered on (cx, cy)
            const fontSize = Math.round(minDim * 0.10);
            ctx.font = `bold ${fontSize}px sans-serif`;
            const maxW  = tcW * 0.88;
            const words = text.split(/\s+/);
            const lines = [];
            let cur = '';
            for (const w of words) {
                const test = cur ? `${cur} ${w}` : w;
                if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
                else cur = test;
            }
            if (cur) lines.push(cur);
            const lineH  = Math.round(fontSize * 1.35);
            const startY = cy - ((lines.length - 1) * lineH) / 2;
            lines.forEach((ln, i) => ctx.fillText(ln, cx, startY + i * lineH));
        } else {
            // Single line over an image — shrink font to fit width
            let fontSize = minDim * 0.72;
            ctx.font = `bold ${Math.round(fontSize)}px sans-serif`;
            const measured = ctx.measureText(text).width;
            const maxW     = tcW * 0.92;
            if (measured > maxW) {
                fontSize *= maxW / measured;
                ctx.font  = `bold ${Math.round(fontSize)}px sans-serif`;
            }
            ctx.fillText(text, cx, cy);
        }
    }

    // Caption layer: word-wrapped text anchored to the bottom center, subtitle-sized
    if (hasCaption) {
        ctx.fillStyle    = 'white';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'alphabetic';
        const fontSize = Math.round(minDim * params.captionSize);
        ctx.font = `bold ${fontSize}px sans-serif`;
        const maxW  = tcW * 0.80;
        const words = captionText.split(/\s+/);
        const lines = [];
        let cur = '';
        for (const w of words) {
            const test = cur ? `${cur} ${w}` : w;
            if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
            else cur = test;
        }
        if (cur) lines.push(cur);
        const lineH      = Math.round(fontSize * 1.35);
        const bottomY    = tcH - Math.round(minDim * 0.05);
        const startY     = bottomY - (lines.length - 1) * lineH;
        lines.forEach((ln, i) => ctx.fillText(ln, tcW / 2, startY + i * lineH));
    }

    // Topmost layer: QR — always drawn last so it is never obscured by user content
    if (showQR) {
        const size   = params.qrSize   * minDim;
        const margin = params.qrMargin * minDim + size / 2;
        const cx = params.qrAlignX === 'left'   ? margin
                 : params.qrAlignX === 'right'  ? tcW - margin
                 :                                tcW / 2;
        const cy = params.qrAlignY === 'top'    ? margin
                 : params.qrAlignY === 'bottom' ? tcH - margin
                 :                                tcH / 2;
        ctx.drawImage(qrBitmap, cx - size / 2, cy - size / 2, size, size);
    }

    // ── 3. Upload composite to GPU ────────────────────────────────────────────
    imageNaturalW = tcW;
    imageNaturalH = tcH;
    if (imageTex) imageTex.destroy();
    imageTex = device.createTexture({
        size:   [tcW, tcH],
        format: 'rgba8unorm',
        usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: traceCanvas }, { texture: imageTex }, [tcW, tcH]);
    imageTexView = imageTex.createView();
    hasImage     = true;
    rebuildSimBG();
    rebuildRenderBG();
    rebuildImageDebugBG();
    rebuildAgentShadowBG();
    rebuildAgentShadowDensityBG();
    updateQROverlay();
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
        imageBitmap = null;
        renderTraceCanvas();
        console.log('[trace] auto-cleared after', params.clearDelay, 's');
    }, params.clearDelay * 1000);
}

async function loadMagnetImage(file) {
    imageBitmap = await createImageBitmap(file, { colorSpaceConversion: 'none' });
    renderTraceCanvas();
    scheduleAutoClear();
}

async function loadTraceImageFromUrl(url) {
    try {
        const res  = await fetch(url);
        const blob = await res.blob();
        imageBitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
        renderTraceCanvas();
        scheduleAutoClear();
    } catch (err) {
        console.warn('[traceImage] failed to load:', url, err.message);
    }
}

function clearMagnetImage() {
    imageBitmap = null;
    clearTimeout(autoClearTimer);
    autoClearTimer = null;
    renderTraceCanvas();
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
    const texView           = (hasImage    && imageTexView)    ? imageTexView    : placeholderTexView;
    const avoidMapView      = (hasAvoidMap && avoidMapTexView) ? avoidMapTexView : placeholderTexView;
    const shadowDensityRes  = shadowDensityView ?? placeholderTexView;
    simBG = device.createBindGroup({
        layout: simPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: soloUB } },
            { binding: 1, resource: { buffer: agentBuf } },
            { binding: 2, resource: texView },
            { binding: 3, resource: { buffer: contamUB } },
            { binding: 4, resource: avoidMapView },
            { binding: 5, resource: shadowDensityRes },
            { binding: 6, resource: { buffer: spectatorSlotsBuf } },
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
/// qrStatus: 'SHOW' — QR is drawn as the topmost layer on the trace canvas.
//                    Independent of user content — both can be visible simultaneously.
//           'HIDE' — QR layer is skipped; only user content (image/text) is drawn.
// status:   'NORMAL' — formula steering + wind active, auto-cycling runs
//           'IDLE'   — no formula, no wind; particles drift freely on momentum
//           'DOT'    — fixed inward-spiral formulas; wind + formula forced on regardless of params
const simState = {
    qrStatus:          'HIDE',
    status:            'NORMAL',
    storyStep:         null,   // echoed from n8n step ID; null = not in story mode
    storyStepComplete: false,
    storyVoteResult:   null,
    stepStatus:        'IDLE', // 'IDLE' | 'DRAW' | 'VOTE' — spectator interaction mode
    optionA:           null,
    optionB:           null,
};

// GUI handles — assigned by initGUI() at the bottom of this file.
let stateCtrl   = null;
let qrStateCtrl = null;
let gui, swarmDebug, dbgUsers, dbgPitch, dbgRoll, dbgTemp, dbgCoherence;
let applyGUIVisibility, toggleGUI, updateGizmo;

function updateStateDisplay() {
    stateCtrl?.updateDisplay();
    qrStateCtrl?.updateDisplay();
}

let qrBitmap           = null;  // permanent reference to the session QR bitmap
let sessionRoom        = null;  // UUID assigned by server — needed for n8n payload
let sessionUrl         = null;  // full remote URL — kept so QR can be regenerated on param change

async function generateQR() {
    if (!sessionUrl) return;
    const dark  = params.qrInvert ? '#00000000' : '#ffffffff';
    const light = params.qrInvert ? '#ffffffff' : '#00000000';
    const qrOffscreen = document.createElement('canvas');
    await QRCode.toCanvas(qrOffscreen, sessionUrl, {
        width: 512, margin: params.qrQuietZone,
        color: { dark, light },
    });
    qrBitmap = await createImageBitmap(qrOffscreen);
}
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
// _pendingOutOfCycle: set by fireOutOfCycleHeartbeat() when a send is requested
// while one is already in-flight; consumed in the finally block.
let _pendingOutOfCycle = false;
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
            body:    JSON.stringify({
                type:              'heartbeat',
                room:              sessionRoom,
                status:            simState.status,
                qrStatus:          simState.qrStatus,
                step:              simState.storyStep,
                storyStepComplete: simState.storyStepComplete,
                storyVoteResult:   simState.storyVoteResult,
                stepStatus:        simState.stepStatus,
                params:            { ...params },
            }),
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
        if (_pendingOutOfCycle) { _pendingOutOfCycle = false; callN8nHeartbeat(); }
    }
}

// Fire an immediate heartbeat regardless of the periodic schedule.
// Used when a story step completes to notify n8n without waiting for the next tick.
function fireOutOfCycleHeartbeat() {
    if (n8nHeartbeatInFlight) { _pendingOutOfCycle = true; return; }
    callN8nHeartbeat();
}

// Called when the current story step finishes (timer expiry or vote settled).
let _stepDurationTimer = null;
function _onStoryStepComplete(voteResult = null) {
    simState.storyStepComplete = true;
    simState.storyVoteResult   = voteResult;
    fireOutOfCycleHeartbeat();
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

// ── Spectator partitioning ────────────────────────────────────────────────────
// Each connected spectator gets a color and a contiguous partition of agents
// (index % spectatorCount). Their touch position is uploaded each frame so the
// GPU can teleport a fraction of their agents to the touch point.
const MAX_SPECTATOR_SLOTS = 16;
const SPECTATOR_PALETTE = [
    '#e63333','#ff8800','#ffe600','#44dd22',
    '#00ddaa','#0088ff','#8833ff','#ff33bb',
    '#ff7766','#ffbb44','#88ff44','#33eeff',
    '#4466ff','#bb55ff','#ff6699','#ffff55',
];
// { spectatorId, colorR, colorG, colorB, spawnerX, spawnerY, spawnerLocationActive,
//   windX, windY, dx, dy, magnitude, lastInputTime }
const activeSlots = [];

function uploadSpectatorSlots() {
    const ab = new ArrayBuffer(768);
    const f  = new Float32Array(ab);
    const u  = new Uint32Array(ab);
    for (let i = 0; i < activeSlots.length; i++) {
        const b = i * 12;
        const s = activeSlots[i];
        f[b + 0] = s.colorR;
        f[b + 1] = s.colorG;
        f[b + 2] = s.colorB;
        u[b + 3] = 1;
        f[b + 4] = s.spawnerX;
        f[b + 5] = s.spawnerY;
        u[b + 6] = s.spawnerLocationActive;
        u[b + 7] = 0;
        f[b + 8] = s.windX;
        f[b + 9] = s.windY;
        u[b + 10] = 0;
        u[b + 11] = 0;
    }
    device.queue.writeBuffer(spectatorSlotsBuf, 0, ab);
}

// ── Session: Socket.IO connection + QR code ───────────────────────────────────
// The server assigns a session UUID on socket connect and emits it back as
// 'session-id'. The sim renders a QR code pointing to $VITE_USER_URL/?s=<id> as both
// a small scannable overlay and a large trace image in the canvas centre.
// If VITE_N8N_BASE_URL is set, the sim calls n8n directly on each remote-event.
// socket is declared here so the GUI's n8nTestMode onChange can reach it.
let socket;
{
    // In dev, Vite runs on a different port from Express, so connect directly to Express.
    // In production, use VITE_SOCKET_URL (the Caddy-fronted public origin) so Socket.IO
    // traffic is routed through Caddy → Express. Falls back to '/' (same origin) if unset.
    const socketUrl = import.meta.env.DEV
        ? `http://localhost:${import.meta.env.VITE_SERVER_PORT ?? 3000}`
        : (import.meta.env.VITE_SOCKET_URL || '/');
    socket = ioConnect(socketUrl, { reconnectionDelay: 2000 });

    // Identify this socket as the host simulation so the server can distinguish
    // it from remote spectator sockets and assign a UUID session room.
    // Pass _forcedSession if ?s= is in the URL — server will use it as the room ID.
    socket.emit('register-host', { testMode: params.n8nTestMode, sessionId: _forcedSession || undefined });

    socket.on('session-id', async (sessionId) => {
        sessionRoom = sessionId;
        // Pin this session ID in the page URL so reloads reconnect to the same room.
        const currentUrl = new URL(location.href);
        if (currentUrl.searchParams.get('s') !== sessionId) {
            currentUrl.searchParams.set('s', sessionId);
            history.replaceState(null, '', currentUrl);
        }
        // Use VITE_USER_URL as-is (Caddy handles the /remote redirect internally).
        // Falls back to the page's own origin in dev when no env var is set.
        const envUrl = (import.meta.env.VITE_USER_URL ?? '').replace(/\/$/, '');
        const base   = envUrl || window.location.origin;
        sessionUrl   = `${base}/?s=${sessionId}`;

        console.log('[session] remote URL:', sessionUrl);

        // ── Small scannable QR in the UI panel ──────────────────────────────
        const uiQr = document.querySelector('#qr-canvas');
        if (uiQr) {
            await QRCode.toCanvas(uiQr, sessionUrl, {
                width: 120, margin: 1,
                color: { dark: '#000000', light: '#ffffff' },
            });
            uiQr.style.display = 'block';
            uiQr.style.cursor  = 'pointer';
            uiQr.addEventListener('click', () => window.open(sessionUrl, '_blank'));
        }

        // ── Large QR bitmap — pre-rendered via generateQR(), stored for later activation.
        // Activation is driven by n8n via heartbeat response { showQR: true }.
        await generateQR();
    });

    socket.on('sim-params', (data) => {
        try { applySimParams(data); }
        catch { /* malformed payload — ignore */ }
    });

    // Collective swarm state — aggregated by the server from all spectators in the room.
    // Tilt bias: avgPitch/avgRoll are 0-1 (0.5 = phone held flat/neutral).
    // Temperature: 0 = cold (top of phone screen), 1 = warm (bottom of phone screen).
    socket.on('collective-state', ({ avgPitch, avgRoll, avgTemp, avgCoherence, userCount }) => {
        // Tilt is now per-spectator via remote-event; collective-state only drives temp/coherence.
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
        updateGizmo(avgPitch ?? 0.75, avgRoll ?? 0.5);
    });

    // A spectator joined — assign a slot, send them their color, brightness burst.
    socket.on('spectator-joined', ({ spectatorId } = {}) => {
        lastRemoteActivity = Date.now();
        burstBrightness    = BURST_BRIGHTNESS;
        if (spectatorId && activeSlots.length < MAX_SPECTATOR_SLOTS) {
            // Start with a neutral white — the phone sends a 'color-pick' immediately
            // after joining with its locally generated palette color, which overwrites this.
            activeSlots.push({ spectatorId, colorR: 1, colorG: 1, colorB: 1, spawnerX: 0.5, spawnerY: 0.5, spawnerLocationActive: 0, windX: 0, windY: 0, dx: 0, dy: 0, magnitude: 0, velocity: 0, _smoothDx: 0, _smoothDy: 0, lastInputTime: 0 });
            uploadSpectatorSlots();
        }
    });

    socket.on('spectator-left', ({ spectatorId } = {}) => {
        if (spectatorId) {
            const idx = activeSlots.findIndex(s => s.spectatorId === spectatorId);
            if (idx !== -1) {
                activeSlots.splice(idx, 1);
                uploadSpectatorSlots();
            }
        }
    });

    // ── Remote event registry ─────────────────────────────────────────────────
    // Single source of truth for all event types emitted by spectator devices.
    // sendToN8n: whether this event type is forwarded to n8n via callN8n().
    const REMOTE_EVENTS = {
        spawner:    { sendToN8n: false },
        tilt:       { sendToN8n: false },
        'color-pick': { sendToN8n: false },
        rotation:   { sendToN8n: false },
        text:       { sendToN8n: true  },
    };

    socket.on('remote-event', (event) => {
        lastRemoteActivity = Date.now();
        if (event.type === 'spawner') {
            const slot = activeSlots.find(s => s.spectatorId === event.spectatorId);
            if (slot) {
                const { dx = 0, dy = 0, magnitude = 0, velocity = 0, active = true } = event.data ?? {};
                if (!active) {
                    slot.spawnerLocationActive = 0;
                    slot.dx = 0; slot.dy = 0; slot.magnitude = 0; slot.velocity = 0;
                } else {
                    if (slot.spawnerLocationActive === 0) {
                        // Re-activating after inactive — new random canvas position
                        slot.spawnerX = Math.random();
                        slot.spawnerY = Math.random();
                    }
                    slot.spawnerLocationActive = 1;
                    slot.dx        = dx;
                    slot.dy        = dy;
                    slot.magnitude = magnitude;
                    slot.velocity  = velocity;
                    slot.lastInputTime = Date.now();
                }
                uploadSpectatorSlots();
            }
        }
        if (event.type === 'tilt') {
            const slot = activeSlots.find(s => s.spectatorId === event.spectatorId);
            if (slot) {
                const roll  = event.data?.roll  ?? 0.5;
                const pitch = event.data?.pitch ?? 0.75;
                // Portrait upright = (roll≈0.5, pitch≈0.75) → windX/Y = 0.
                // Tilt maps to ±1 at ±90° from portrait, then scaled by windStr in shader.
                slot.windX = Math.max(-1, Math.min(1, (roll  - 0.5 ) * 2));
                slot.windY = Math.max(-1, Math.min(1, (pitch - 0.75) * 4));
                uploadSpectatorSlots();
            }
        }
        if (event.type === 'color-pick') {
            const slot = activeSlots.find(s => s.spectatorId === event.spectatorId);
            if (slot && typeof event.data?.color === 'string') {
                const [r, g, b] = hexToF(event.data.color);
                slot.colorR = r; slot.colorG = g; slot.colorB = b;
                uploadSpectatorSlots();
            }
        }
        if (event.type === 'text' && event.data?.text && !N8N_BASE) {
            const input = document.querySelector('#trace-text-input');
            if (input) input.value = event.data.text;
            renderTraceCanvas();
            scheduleAutoClear();
        }
        if (REMOTE_EVENTS[event.type]?.sendToN8n) callN8n(event);
    });

    // Running vote tally from server — update storyVoteResult to current leader.
    socket.on('story-vote-update', ({ optionA, votesA, optionB, votesB }) => {
        if      (votesA > votesB) simState.storyVoteResult = optionA;
        else if (votesB > votesA) simState.storyVoteResult = optionB;
        else                      simState.storyVoteResult = null;
    });

    socket.on('connect_error', () => console.warn('[socket] connection failed, will retry…'));
}

// Merge n8n-provided params into the live simulation.
// Only numeric/boolean keys present in the payload are applied;
// if formulas are included they re-trigger pipeline compilation.
function applySimParams(data) {
    const { dir, wind, restart, clearTrace, showQR, traceText, clearText, traceImage, status, avoidMap,
            step, stepDuration, stepStatus, optionA, optionB, caption, ...rest } = data;

    // Story step — a new step ID resets all completion state then applies the step's UI mode.
    if (step !== undefined) {
        clearTimeout(_stepDurationTimer);
        _stepDurationTimer         = null;
        simState.storyStep         = step;
        simState.storyStepComplete = false;
        simState.storyVoteResult   = null;
        simState.stepStatus        = stepStatus ?? 'IDLE';
        simState.optionA           = optionA    ?? null;
        simState.optionB           = optionB    ?? null;
        socket.emit('story-ui', { stepStatus: simState.stepStatus, optionA: simState.optionA, optionB: simState.optionB });
        if (stepDuration > 0) {
            _stepDurationTimer = setTimeout(() => _onStoryStepComplete(), stepDuration * 1000);
        }
    } else if (stepStatus !== undefined) {
        // Mid-step status change (no new step ID).
        simState.stepStatus = stepStatus;
        if (optionA !== undefined) simState.optionA = optionA;
        if (optionB !== undefined) simState.optionB = optionB;
        socket.emit('story-ui', { stepStatus: simState.stepStatus, optionA: simState.optionA, optionB: simState.optionB });
    }
    if (status === 'NORMAL' || status === 'IDLE' || status === 'DOT') {
        simState.status = status;
        if (status === 'DOT') applyFormulas(DOT_DIR, DOT_WIND);
        updateStateDisplay();
    }
    if (restart)              seedAgents();
    if (avoidMap === null)    clearAvoidMap();
    else if (typeof avoidMap === 'string') loadAvoidMap(avoidMap);
    if (clearTrace) {
        imageBitmap = null;
        clearTimeout(autoClearTimer);
        autoClearTimer = null;
        const clearInput = document.querySelector('#trace-text-input');
        if (clearInput) clearInput.value = '';
        simState.qrStatus = 'HIDE';
        updateStateDisplay();
        renderTraceCanvas();
    }
    if (caption !== undefined) { captionText = caption || ''; renderTraceCanvas(); }
    if (showQR === true)  restoreQR();
    if (showQR === false) {
        simState.qrStatus = 'HIDE';
        updateStateDisplay();
        renderTraceCanvas();
    }
    if (typeof traceImage === 'string') loadTraceImageFromUrl(traceImage);
    if (clearText)            clearTraceText();
    if (traceText !== undefined) {
        const input = document.querySelector('#trace-text-input');
        if (input) input.value = traceText;
        renderTraceCanvas();
        scheduleAutoClear();
    }
    Object.entries(rest).forEach(([k, v]) => {
        if (k in params) params[k] = v;
    });
    if ('heartbeatInterval' in rest) restartHeartbeat();
    if ('n8nTestMode'       in rest) socket.emit('set-n8n-test-mode', params.n8nTestMode);
    if ('agentCount'        in rest || 'weightSpread' in rest) seedAgents();
    if ('renderScale'       in rest) { setSize(); rebuildOffscreen(); seedAgents(); }
    if ('traceScale' in rest || 'qrSize'   in rest || 'qrMargin' in rest ||
        'qrAlignX'   in rest || 'qrAlignY' in rest ||
        'imageX'     in rest || 'imageY'   in rest || 'imageSize' in rest) renderTraceCanvas();
    if ('qrQuietZone' in rest || 'qrInvert' in rest) generateQR().then(renderTraceCanvas);
    gui.controllersRecursive().forEach(c => c.updateDisplay());
    if (dir !== undefined || wind !== undefined) {
        const newDir  = dir  ?? dirInput.value;
        const newWind = wind ?? windInput.value;
        dirInput.value  = newDir;
        windInput.value = newWind;
        applyFormulas(newDir, newWind);
    }
}

// ── GUI ───────────────────────────────────────────────────────────────────────
({
    gui, swarmDebug,
    stateCtrl, qrStateCtrl,
    dbgUsers, dbgPitch, dbgRoll, dbgTemp, dbgCoherence,
    applyGUIVisibility, toggleGUI, updateGizmo,
} = initGUI({
    params, socket, simState, MAX_AGENTS,
    seedAgents, setSize, rebuildOffscreen,
    renderTraceCanvas, generateQR,
    clearMagnetImage, clearTraceText, clearAvoidMap,
    restartHeartbeat,
}));

stateCtrl.onChange(v => { if (v === 'DOT') applyFormulas(DOT_DIR, DOT_WIND); });

window.addEventListener('keydown', e => {
    if (e.key === 'Control') toggleGUI();
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
    if (!_inQROverlayUpdate && params.qrOverlay && simState.qrStatus === 'SHOW' && qrBitmap) updateQROverlay();
}

function clearAvoidMap() {
    if (avoidMapTex) { avoidMapTex.destroy(); avoidMapTex = null; }
    avoidMapTexView = null;
    hasAvoidMap     = false;
    rebuildSimBG();
    if (!_inQROverlayUpdate && params.qrOverlay && simState.qrStatus === 'SHOW' && qrBitmap) updateQROverlay();
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

    const ab = _soloAB;
    const u  = _soloU;
    const f  = _soloF;
    const { x0, y0, x1, y1 } = getImageRegion();
    u[0] = params.agentCount;
    f[1] = canvas.width;
    f[2] = canvas.height;
    f[3] = params.stepLen;
    f[4] = dt;
    f[5] = time;
    const isIdle = simState.status === 'IDLE';
    const isDot  = simState.status === 'DOT';
    f[6] = isIdle ? 0.0 : (isDot || params.windEnabled ? params.windStr : 0.0);
    f[7] = params.turnRate * coherenceMult;  // coherence scales how sharply agents follow the formula
    f[8] = params.maxSpeed;
    f[9] = params.minSpeed;
    u[10] = hasImage ? 1 : 0;
    f[11] = params.magnetStr;
    f[12] = x0;
    f[13] = y0;
    f[14] = x1;
    f[15] = y1;
    u[16] = (!isIdle && (isDot || params.followFormula)) ? 1 : 0;
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
    f[30] = params.probeSensorAngle;
    f[31] = params.homingChance;
    f[32] = params.homingInfluence;
    u[33] = activeSlots.length;
    f[34] = Math.min(params.spectatorSpawnChance * activeSlots.length * params.spectatorSpawnMultiplier, 1.0);
    device.queue.writeBuffer(soloUB, 0, ab);
}

function writeRenderUB() {
    const ab = _renderAB;
    const u  = _renderU;
    const f  = _renderF;
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
    u[20] = simState.qrStatus === 'SHOW' ? 1 : 0;
    u[21] = params.qrFadeZone ? 1 : 0;
    f[22] = params.homingProximityRange;
    f[23] = params.homingMinAlpha;
    u[24] = activeSlots.length;
    u[25] = params.additiveBlend ? 1 : 0;
    device.queue.writeBuffer(renderUB, 0, ab);
}


function writeFadeUB() {
    _fadeF[0] = params.trailDecay;
    device.queue.writeBuffer(fadeUB, 0, _fadeAB);
}

function writeBlitUB() {
    _blitF[0] = params.bgBlackCutoff;
    _blitF[1] = params.toneBlack;
    _blitF[2] = params.toneWhite;
    _blitF[3] = params.toneGamma;
    _blitF[4] = params.shadowBoost;
    device.queue.writeBuffer(blitUB, 0, _blitAB);
}

function writeWindVisUB(time, gridW) {
    const step = Math.round(100 * window.devicePixelRatio);
    _windVisF[0] = canvas.width;
    _windVisF[1] = canvas.height;
    _windVisF[2] = time;
    _windVisF[3] = step;
    _windVisF[4] = step * 0.55;
    _windVisU[5] = gridW;
    device.queue.writeBuffer(windVisUB, 0, _windVisAB);
}

function writeAgentShadowUB() {
    _shadowF[0] = canvas.width;
    _shadowF[1] = canvas.height;
    _shadowF[2] = params.agentShadowRadius;
    _shadowF[3] = params.agentShadowStr;
    _shadowU[4] = hasImage ? 1 : 0;
    _shadowF[5] = params.homingProximityRange;
    _shadowF[6] = params.homingMinAlpha;
    device.queue.writeBuffer(agentShadowUB, 0, _shadowAB);
}

function writeImageDebugUB() {
    const { x0, y0, x1, y1 } = getImageRegion();
    _imgDbgF[0] = canvas.width;
    _imgDbgF[1] = canvas.height;
    _imgDbgF[2] = x0;
    _imgDbgF[3] = y0;
    _imgDbgF[4] = x1;
    _imgDbgF[5] = y1;
    device.queue.writeBuffer(imageDebugUB, 0, _imgDbgAB);
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
    const ab     = _contamAB;
    const u      = _contamU;
    const f      = _contamF;
    u[0] = count;
    f[1] = params.contamRadius;
    u[2] = params.contamPush ? 1 : 0;
    // points start at byte 16 → float index 4; each vec4 = 4 floats (xy used, zw = 0)
    for (let k = 0; k < count; k++) {
        f[4 + k * 4]     = pts[k * 2];      // x
        f[4 + k * 4 + 1] = pts[k * 2 + 1]; // y
    }
    device.queue.writeBuffer(contamUB, 0, ab);
}

// ── Pre-allocated uniform buffers (reused every frame to avoid GC pressure) ──
const _soloAB  = new ArrayBuffer(144); const _soloU  = new Uint32Array(_soloAB);  const _soloF  = new Float32Array(_soloAB);
const _renderAB= new ArrayBuffer(112); const _renderU= new Uint32Array(_renderAB); const _renderF= new Float32Array(_renderAB);
const _fadeAB  = new ArrayBuffer(16);  const _fadeF  = new Float32Array(_fadeAB);
const _blitAB  = new ArrayBuffer(32);  const _blitF  = new Float32Array(_blitAB);
const _contamAB= new ArrayBuffer(176); const _contamU= new Uint32Array(_contamAB); const _contamF= new Float32Array(_contamAB);
const _shadowAB= new ArrayBuffer(32);  const _shadowF= new Float32Array(_shadowAB); const _shadowU= new Uint32Array(_shadowAB);
const _imgDbgAB= new ArrayBuffer(32);  const _imgDbgF= new Float32Array(_imgDbgAB);
const _windVisAB=new ArrayBuffer(32);  const _windVisF=new Float32Array(_windVisAB); const _windVisU=new Uint32Array(_windVisAB);

// ── Frame loop ────────────────────────────────────────────────────────────────
const TIME_MULT = 0.001;
let prevTime  = performance.now() * TIME_MULT;
let fpsFrames = 0;
// FPS update decoupled from the render loop — DOM writes every 1 s must not stall RAF.
setInterval(() => { updateMonitor(fpsFrames); fpsFrames = 0; }, 1000);

function frame(ts) {
    if (deviceLost) return;
    requestAnimationFrame(frame);

    const now    = ts * TIME_MULT;
    const rawDt  = Math.min(Math.max(now - prevTime, TIME_MULT), 0.05);
    const dt     = params.useDeltaTime ? rawDt : (1 / 60);
    prevTime     = now;

    // Move each spectator's spawner along the last joystick direction, check inactivity timeout.
    if (activeSlots.length) {
        const wallNow = Date.now();
        let dirty = false;
        for (const slot of activeSlots) {
            if (slot.spawnerLocationActive === 1) {
                if (wallNow - slot.lastInputTime > params.spawnerInactiveTimeout * 1000) {
                    slot.spawnerLocationActive = 0;
                    slot.dx = 0; slot.dy = 0; slot.magnitude = 0; slot.velocity = 0;
                    slot._smoothDx = 0; slot._smoothDy = 0;
                    dirty = true;
                } else if (slot.magnitude > 0) {
                    const steer = Math.min(params.spawnerSteering * dt, 1);
                    slot._smoothDx += (slot.dx - slot._smoothDx) * steer;
                    slot._smoothDy += (slot.dy - slot._smoothDy) * steer;
                    const vBoost = params.spawnerSpeed * (1 + slot.velocity * params.spawnerVelocityBoost);
                    slot.spawnerX = ((slot.spawnerX + slot._smoothDx * slot.magnitude * vBoost * dt) % 1 + 1) % 1;
                    slot.spawnerY = ((slot.spawnerY + slot._smoothDy * slot.magnitude * vBoost * dt) % 1 + 1) % 1;
                    dirty = true;
                }
            }
        }
        if (dirty) uploadSpectatorSlots();
    }

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

    // Shadow density pass: clear to black, render bright additive splats per homing agent.
    // Result is read by compute.wgsl binding 5 on the *next* frame (same-frame read is fine
    // because the density pass runs after compute, and compute runs first next frame).
    if (hasImage && agentShadowDensityBG && shadowDensityView) {
        const dp = enc.beginRenderPass({
            colorAttachments: [{
                view: shadowDensityView,
                loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store',
            }],
        });
        dp.setPipeline(agentShadowDensityPipe);
        dp.setBindGroup(0, agentShadowDensityBG);
        dp.draw(params.agentCount * 6);
        dp.end();
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
        rp.setPipeline(params.additiveBlend ? renderPipe : renderPipeNormal);
        rp.setBindGroup(0, params.additiveBlend ? renderBG : renderBGNormal);
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
}

requestAnimationFrame(frame);
