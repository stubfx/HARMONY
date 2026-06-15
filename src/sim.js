// ─── Solo — Formula-Driven Wind Particle System ───────────────────────────────
// Agents are independent particles moved by two mathematical fields:
//   dirFormula  — the heading each particle wants to follow
//   windFormula — a force field that pushes them off course
// A magnet image layer guides particles toward bright areas via image gradient.
// Particles overlapping the image region are coloured by the image itself.
// Speed drives brightness. A fading trail accumulates on an offscreen texture.

import { initGUI }      from './gui.js';
import { stopAudio, isActive, getVolume, playAudio, playAudioBg, unlockAudio, setDuckLevel, isAudioLocked, isAudioReady, onAudioStateChange, setChaos } from './audio.js';
import QRCode           from 'qrcode';
import { io as ioConnect } from 'socket.io-client';
import soloSimTemplate  from './shaders/compute.wgsl?raw';
import soloRenderWGSL   from './shaders/render.wgsl?raw';
import fadeWGSL         from './shaders/fade.wgsl?raw';
import blitWGSL         from './shaders/blit.wgsl?raw';
import downsampleWGSL   from './shaders/downsample.wgsl?raw';
import windVisWGSL      from './shaders/wind-vis.wgsl?raw';
import imageDebugWGSL   from './shaders/image-debug.wgsl?raw';
import agentShadowWGSL  from './shaders/agentShadow.wgsl?raw';
import champLinesWGSL   from './shaders/champLines.wgsl?raw';
import golStepWGSL      from './shaders/gol-step.wgsl?raw';
import { startSynth, setSynthState, playIdleTrack, stopIdleTrack, fadeOutIdleTrack, setIdleChaos, addArpInfluence } from './synth.js';

// ── Config ────────────────────────────────────────────────────────────────────
const MAX_AGENTS = 5_000_000;
// Game of Life grid width in cells (height derived from canvas aspect).
const GOL_W = 192;

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
    color1:      '#00ff00',   // first palette colour
    color2:      '#0000ff',   // second palette colour (assigned by agent index % 2)
    chaosColor:         '#ff2244',  // colour taken by chaosColorFraction of all agents at full chaos
    chaosColorFraction: 0.5,        // max fraction of agents that use chaosColor (at chaos=1)
    idleColor:          '#0057B8',  // colour shown when no spectators connected (Greek marine blue)
    idleColorFraction:  0.7,        // fraction of agents that take idleColor when idle
    brightness:  0.06,        // per-particle alpha; prevents additive saturation to white
    additiveBlend: true,      // true = additive (glow, accumulates); false = max blend (no over-brightness)
    blendAmount:   1.0,       // 0–1 multiplier on per-particle fragment output; lowers contribution in both blend modes
    toneBlack:   0.0,         // input level mapped to black (lifts lone-particle visibility)
    toneWhite:   1.0,         // input level mapped to white (HDR saturation point)
    toneGamma:   1.0,         // power curve: <1 boosts darks, >1 crushes darks
    shadowBoost: 0.0,         // inverse-brightness boost: peaks at ~12% luminance, negligible above 60%
    pixelGrid:      false,    // chunky low-res grid (downsample → nearest-sample blit) — final stage before canvas
    pixelGridCells: 700,      // cell count along the X axis; Y count is derived from canvas aspect ratio
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
    traceScale:   1.0,   // trace canvas resolution relative to main canvas (perf control)
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
    // Champions — every Nth agent (agentId % champions == 0) drops a constant shadow
    // splat under itself even when free. 1 = every agent, 2 = one in two…
    championsEnabled:  true, // master on/off for the whole champions feature
    champions:         700,
    // Champion point size — applied ONLY while a champion is free (not homing);
    // homing champions render at the normal agent size like everyone else.
    championSize:      15,
    champLinesAlpha:   0.01,
    // Game of Life mode — toggle
    golEnabled:      false,
    golStrength:     0.5,  // attraction of particles toward live cells
    golStepInterval: 4,    // frames between Game-of-Life generations (higher = slower)
    golSpark:        0.001, // random life injection per generation (0 = pure Conway; prevents freezing)
    // Homing behaviour
    homingChance:    0.2, // per-frame probability [0–1] that a newly-eligible agent commits to homing
    homingInfluence: 1.0, // max homing blend weight at dist=0; falls to 0 at dist=canvasW
    // Homing proximity fade
    homingProximityRange: 300, // canvas px — distance over which homing agents fade in
    homingMinAlpha:       0.1, // minimum alpha for a homing agent at max distance (0–1)
    // Avoidance
    avoidForceStr:   1.0, // multiplier on image-trace avoidance forces
    avoidMapScale:   1.0, // avoidance map coverage as fraction of canvas (1.0 = full)
    avoidMapInvert:  false, // true = read the map as 1 - r, so light areas become non-avoid and dark areas become the avoid signal
    avoidMapSampleColor: true,  // true = non-homing particles take their base color from the avoid map sample at their position
    avoidMapFixedColor:  true,  // true (paired with sampleColor) = use the sampled pixel exactly
    avoidMapBlackCutoff: 0.05,  // luminance floor for the color sample: pixels below this are skipped (particle keeps base color) — mirrors trace blackThreshold
    qrOverlay:       false, // true = QR on a 2D overlay canvas; agents freed from QR area
    // Primed-spot probe (free agents only)
    probeLen:          15.0, // probe cast distance in canvas pixels
    probeForceStr:     150.0, // steering force multiplier when probe hits a primed pixel
    respawnOnCollide:  false, // teleport to a random edge position instead of steering on probe hit
    probeSensorAngle:  0.785, // half-angle between left/right Physarum sensors (radians; π/4 ≈ 45°)
    // Caption
    captionSize:   0.035, // font size as fraction of min(canvas width, canvas height)
    // Font — Google Fonts family used for trace/caption text, loaded at runtime
    // (nothing installed on the host machine). Empty string = system sans-serif.
    fontFamily:    'Bellefair',
    // Export ('s' screenshot) — both off by default
    exportTransparent: false, // make the black background transparent (alpha = brightness)
    exportCMYK:        false, // convert to CMYK and save as TIFF instead of PNG
    // Auto-clear
    clearDelay:    0,     // seconds before auto-clearing user trace content (0 = disabled)
    // DOT mode
    dotCenterRadius:     50,   // px — agents within this radius of centre are candidates for respawn (0 = disabled)
    dotRespawnChance:    0.01, // per-frame probability that a centre-zone agent is respawned to an edge
    // Freeroam lock — when on, FREEROAM auto-reverts to NORMAL after a delay
    freeroamLock:        true,
    freeroamLockDelay:   30,   // seconds in FREEROAM before reverting to NORMAL (timer resets each time FREEROAM is re-entered)
    // Spectator partitioning
    spectatorAgentShare:       35,   // % of agents assigned to spectators (0 = sim only, 100 = full user control)
    spectatorSpawnChance:      0.01, // base per-frame spawn probability (scaled by user count × multiplier)
    spectatorSpawnMultiplier:  3,    // scales spawn chance proportionally with active user count
    spawnerSpeed:           0.3,  // canvas fractions per second the spawner moves at full joystick deflection
    spawnerVelocityBoost:   2.0,  // multiplier applied to spawnerSpeed when joystick is moved quickly (0 = no boost)
    spawnerSteering:        6,    // direction-change rate (1/s); lower = wider curves, higher = tighter turns
    spawnerInactiveTimeout: 5,    // seconds of joystick silence before spawner goes inactive
    releaseBurstSpeed:      30,   // fireworks: speed agents scatter at when a joystick is released (0 = disabled)
    randomTeleportChance:         0.003, // per-frame probability [0–1] any agent jumps to a random canvas position
    randomTeleportOnAvoidMap:     true,  // when true, random teleport is active only while an avoidMap is loaded
    // Session / QR restore
    remoteTimeout:  0,    // seconds of silence from all remotes before QR is restored (0 = disabled)
    maxSpectators:  1,    // sim QR hides when connected count reaches this threshold
    respawnOnQR:      true,  // respawn free agents inside the QR rect to a random edge
    qrRespawnChance:  0.01,  // per-frame probability [0–1] for the respawn
    n8nEnabled:        false, // false = silence all n8n traffic (heartbeat + sim-event) without unsetting VITE_N8N_BASE_URL
    n8nTestMode:       false, // true = /webhook-test/sim-event, false = /webhook/sim-event
    heartbeatInterval: 10,   // seconds between periodic param snapshots sent to n8n (0 = off)
    heartbeatTimeout:  60,   // seconds before a heartbeat fetch is aborted
    voteDuration:      30,   // seconds the vote panel stays open before the sim fires the result
    // Weight
    weightSpread: 0.8,    // 0 = all equal; 1 = weights span [0.05 … 1.95]
    // Motion behaviour
    followFormula: true,  // false = free drift (wind + magnet only)
    autoDir:       true,  // randomly cycle dir formula every 30 s
    bounceEdges:   false, // reflect agents at canvas edges instead of wrapping
    useDeltaTime:  true,  // false = fixed 1/60 s timestep (no frame-spike compensation)
    // Audio reactivity
    color2AudioStr: 1.0,  // how strongly room audio leans the palette toward color2 (0 = off, 1 = full color2 at peak volume)
    duckLevel:     0.15,  // bg gain while voiceover is active (0 = mute, 1 = no ducking)
};

// ── URL param overrides ───────────────────────────────────────────────────────
// ?s=<uuid>      — pin the sim to a specific session room (survives reloads via URL)
// ?amount=<n>    — override the starting agent count (still adjustable in the GUI)
// ?test=1        — start with n8n test mode enabled (mirrors GUI toggle, survives reloads)
// ?password=<x>  — forwarded as-is in every heartbeat payload; survives reloads via URL
// ?n8n=off       — start with n8n traffic disabled (heartbeat + sim-event); mirrors GUI toggle, survives reloads
// ?pixelGrid=true — start with the chunky low-res pixel-grid mode enabled
const _urlParams     = new URLSearchParams(location.search);
const _forcedSession = _urlParams.get('s') || null;
const _n8nPassword   = _urlParams.get('password') || null;
if (['off', 'false', '0', 'disabled'].includes(_urlParams.get('n8n') ?? '')) {
    params.n8nEnabled = false;
}
{
    const v = _urlParams.get('pixelGrid');
    if (v === 'true' || v === '1') params.pixelGrid = true;
}
{
    const n = parseInt(_urlParams.get('amount') ?? '', 10);
    if (Number.isFinite(n) && n > 0)
        params.agentCount = Math.max(1_000, Math.min(MAX_AGENTS, n));
}
{
    const t = _urlParams.get('test');
    if (t === '1' || t === 'true') params.n8nTestMode = true;
}
{
    // resolution: initial render scale, 0–1 (clamped to the slider's 0.1–1.0 range).
    const r = parseFloat(_urlParams.get('resolution') ?? '');
    if (Number.isFinite(r)) params.renderScale = Math.max(0.1, Math.min(1.0, r));
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

// Base direction formulas. Variables: x, y, t, cx, cy, PI, TWO_PI
const BASE_DIR_FORMULAS = [
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

// Line / cell / grid heading patterns — the family we want to favour (like 'cells').
// Folded into the auto-cycle pool several times below so it lands on these far more often.
const LINE_CELL_DIR = [
    // cells / grids — product of the two axes
    'sin(x * 0.006) * cos(y * 0.006) * TWO_PI',
    'sin(x * 0.010) * cos(y * 0.010) * TWO_PI',
    'sin(x * 0.004) * cos(y * 0.004) * TWO_PI',
    'cos(x * 0.007) * sin(y * 0.007) * TWO_PI',
    '(sin(x * 0.006) + cos(y * 0.006)) * PI',
    'sin(x * 0.012) * cos(y * 0.012) * PI',
    'sin(x * 0.008 + t * 0.2) * cos(y * 0.008 - t * 0.2) * TWO_PI',
    // lines / bands — single axis
    'sin(x * 0.006) * PI',
    'sin(y * 0.006) * PI',
    'cos(x * 0.008) * PI',
    'sin(x * 0.010 + t * 0.3) * PI',
    'sin(y * 0.008 - t * 0.2) * PI',
    // diagonal lines
    'sin((x + y) * 0.005) * TWO_PI',
    'sin((x - y) * 0.005) * TWO_PI',
    'sin((x + y) * 0.008 + t * 0.25) * TWO_PI',
];

// Auto-cycle pool: base set + the line/cell family repeated, so a line- or
// cell-like pattern is much more likely to be picked.
const DIR_FORMULAS = [
    ...BASE_DIR_FORMULAS,
    ...LINE_CELL_DIR,
    ...LINE_CELL_DIR,
    ...LINE_CELL_DIR,
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
    { label: 'grid',            dir: 'sin(x * 0.008) * cos(y * 0.008) * TWO_PI',                            wind: 'sin(x * 0.003 + t * 0.2) * PI' },
    { label: 'fine grid',       dir: 'sin(x * 0.012) * cos(y * 0.012) * TWO_PI',                            wind: 'cos(y * 0.004 - t * 0.2) * PI' },
    { label: 'lines',           dir: 'sin(x * 0.006) * PI',                                                 wind: 'cos(y * 0.004 + t * 0.2) * PI' },
    { label: 'lines (horizontal)', dir: 'sin(y * 0.006) * PI',                                              wind: 'sin(x * 0.004 - t * 0.2) * PI' },
    { label: 'diagonal',        dir: 'sin((x + y) * 0.006) * TWO_PI',                                       wind: 'sin((x - y) * 0.004 + t * 0.2) * PI' },
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
ctx.configure({
    device, format: canvasFormat, alphaMode: 'opaque',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
});

// ── Persistent GPU buffers ────────────────────────────────────────────────────
const agentBuf = device.createBuffer({
    size: MAX_AGENTS * 32,    // [pos.xy, vel.xy, home.xy, weight, primed] = 8 × f32 = 32 bytes
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const soloUB = device.createBuffer({
    size: 208, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const renderUB = device.createBuffer({
    size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const fadeUB = device.createBuffer({
    size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const blitUB = device.createBuffer({
    size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const downsampleUB = device.createBuffer({
    size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const windVisUB = device.createBuffer({
    size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const imageDebugUB = device.createBuffer({
    size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
// Game of Life step uniform: seed, spark, pad, pad (16 bytes)
const golUB = device.createBuffer({
    size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
        // Home: jittered within this agent's assigned grid cell.
        // Keeps uniform coverage but breaks the visible grid alignment when agents home.
        const col  = i % gridW;
        const row  = Math.floor(i / gridW);
        data[b + 4] = (col + Math.random()) * cellW; // home.x
        data[b + 5] = (row + Math.random()) * cellH; // home.y
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

// Nearest sampler — used by the blit when pixelGrid mode is on so the small
// gridTex stretches across the canvas as chunky cells instead of being smoothed.
const nearestSmp = device.createSampler({
    magFilter: 'nearest', minFilter: 'nearest',
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

// Downsample: full-res offscreen → small gridTex with per-cell area average.
// Used only when params.pixelGrid is on.
const downsampleMod = device.createShaderModule({ code: downsampleWGSL });
const downsamplePipe = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: downsampleMod, entryPoint: 'vs' },
    fragment: {
        module: downsampleMod, entryPoint: 'fs',
        targets: [{ format: 'rgba16float' }],
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

// ── Champion Lines — LINE_STRIP overlay connecting champion agents ─────────────
const champLinesUB  = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const champLinesMod = device.createShaderModule({ code: champLinesWGSL });
const champLinesPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: champLinesMod, entryPoint: 'vs' },
    fragment: {
        module: champLinesMod, entryPoint: 'fs',
        targets: [{
            format: canvasFormat,
            blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'zero',       dstFactor: 'one', operation: 'add' },
            },
        }],
    },
    primitive: { topology: 'line-strip' },
});
const champLinesBG = device.createBindGroup({
    layout: champLinesPipe.getBindGroupLayout(0),
    entries: [
        { binding: 0, resource: { buffer: champLinesUB } },
        { binding: 1, resource: { buffer: agentBuf } },
    ],
});

// Game of Life: a Conway automaton on a small grid; particles are attracted to live cells.
const golStepMod  = device.createShaderModule({ code: golStepWGSL });
const golStepPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: golStepMod, entryPoint: 'vs' },
    fragment: { module: golStepMod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
});
let golStepBG = null;

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
let golStateTex        = null;
let golStateView       = null;
let golScratchTex      = null;
let golScratchView     = null;
let golW               = 1;
let golH               = 1;
let golTick            = 0;

// Pixel-grid mode resources — rebuilt on canvas resize or grid-cell-count change.
let gridTex      = null;
let gridTexView  = null;
let gridBlitBG   = null;   // blit reads gridTex with nearest sampler when pixelGrid on
let downsampleBG = null;   // downsample pass reads offscreen with linear sampler

function gridCellDims() {
    const cellsW = Math.max(8, Math.floor(params.pixelGridCells));
    const aspect = canvas.height / canvas.width;
    const cellsH = Math.max(8, Math.round(cellsW * aspect));
    return [cellsW, cellsH];
}

function rebuildGridTex() {
    if (gridTex) gridTex.destroy();
    const [cellsW, cellsH] = gridCellDims();
    gridTex = device.createTexture({
        size:   [cellsW, cellsH],
        format: 'rgba16float',
        usage:  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    gridTexView = gridTex.createView();

    downsampleBG = device.createBindGroup({
        layout: downsamplePipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: downsampleUB } },
            { binding: 1, resource: screenSmp },
            { binding: 2, resource: offscreenView },
        ],
    });

    gridBlitBG = device.createBindGroup({
        layout: blitPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: blitUB } },
            { binding: 1, resource: nearestSmp },
            { binding: 2, resource: gridTexView },
        ],
    });
}

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

    golW = GOL_W;
    golH = Math.max(1, Math.round(GOL_W * canvas.height / canvas.width));
    if (golStateTex)   golStateTex.destroy();
    if (golScratchTex) golScratchTex.destroy();
    golStateTex = device.createTexture({
        size:   [golW, golH],
        format: 'rgba8unorm',
        usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    golScratchTex = device.createTexture({
        size:   [golW, golH],
        format: 'rgba8unorm',
        usage:  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    golStateView   = golStateTex.createView();
    golScratchView = golScratchTex.createView();
    seedGoL();
    rebuildGolBG();

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

    // Grid resources depend on offscreenView, so rebuild them whenever offscreen changes.
    rebuildGridTex();
}
rebuildOffscreen();

// Full resolution-change rebuild: recreate every canvas-sized resource AND every
// bind group that samples those textures. rebuildOffscreen alone rebuilds only a
// subset (blit/grid/gol step) — simBG still references the recreated shadow-density
// and GoL textures (bindings 5 and 7), so it must be rebuilt too or the next submit
// uses a destroyed texture. Used on resize and on every renderScale change.
function applyResize() {
    setSize();
    rebuildOffscreen();
    rebuildSimBG();
    renderTraceCanvas();
    rebuildAgentShadowBG();
    rebuildAgentShadowDensityBG();
    seedAgents();
}
window.addEventListener('resize', applyResize);

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

// ── Animated image state ──────────────────────────────────────────────────────
let gifFrames        = null;   // ImageBitmap[] | null — trace GIF frames
let gifDurations     = null;   // number[]      | null — per-frame delay (ms)
let gifFrameIdx      = 0;
let gifNextFrameAt   = 0;      // performance.now() timestamp for next advance

let avoidGifFrames    = null;  // same for avoidance map
let avoidGifDurations = null;
let avoidGifFrameIdx  = 0;
let avoidGifNextFrameAt = 0;

// Rebuilds particle render bind group — called after pipeline creation, on image change,
// and on avoid-map change (avoid map at binding 5 feeds the optional per-particle color sampling).
function rebuildRenderBG() {
    const texView      = (hasImage && imageTexView) ? imageTexView : placeholderTexView;
    const avoidView    = (hasAvoidMap && avoidMapTexView) ? avoidMapTexView : placeholderTexView;
    const entries = [
        { binding: 0, resource: { buffer: renderUB } },
        { binding: 1, resource: { buffer: agentBuf } },
        { binding: 2, resource: imageSampler },
        { binding: 3, resource: texView },
        { binding: 4, resource: { buffer: spectatorSlotsBuf } },
        { binding: 5, resource: avoidView },
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

function rebuildGolBG() {
    if (!golStateView) return;
    golStepBG = device.createBindGroup({
        layout: golStepPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: golStateView },
            { binding: 1, resource: { buffer: golUB } },
        ],
    });
}

// Seed the Game-of-Life grid with a random live/dead pattern.
function seedGoL() {
    if (!golStateTex) return;
    const cells = golW * golH;
    const d = new Uint8Array(cells * 4);
    for (let i = 0; i < cells; i++) {
        const alive = Math.random() < 0.22 ? 255 : 0;
        d[i * 4]     = alive;
        d[i * 4 + 1] = alive;
        d[i * 4 + 2] = alive;
        d[i * 4 + 3] = 255;
    }
    device.queue.writeTexture(
        { texture: golStateTex },
        d,
        { offset: 0, bytesPerRow: golW * 4, rowsPerImage: golH },
        [golW, golH, 1],
    );
}

// ── QR overlay + avoid map ────────────────────────────────────────────────────
// When qrOverlay is on the QR is displayed on qrOverlayEl (not baked into the trace),
// and the qrBitmap is uploaded as the avoid map so agents naturally avoid the QR area.
// White QR modules (r=1) repel agents; blur merges them into a solid repulsion zone.
let _inQROverlayUpdate = false;
let _qrOwnedAvoidMap   = false; // true when the current avoid map was set by updateQROverlay
function updateQROverlay() {
    const visible = params.qrOverlay && simState.qrStatus === 'SHOW' && !!qrBitmap;
    qrOverlayEl.style.opacity = visible ? '1' : '0';
    if (!visible) {
        if (_qrOwnedAvoidMap) {
            _inQROverlayUpdate = true;
            clearAvoidMap();
            _inQROverlayUpdate = false;
            _qrOwnedAvoidMap = false;
        }
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
    actx.drawImage(qrBitmap, cx - size / 2, cy - size / 2, size, size);

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
    avoidMapTexView  = avoidMapTex.createView();
    hasAvoidMap      = true;
    _qrOwnedAvoidMap = true;
    rebuildSimBG();
    rebuildRenderBG();
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

// ── Google Fonts loader ─────────────────────────────────────────────────────
// Loads a typeface straight from Google Fonts at runtime (CSS link + the CSS
// Font Loading API), so the machine running the simulation needs nothing
// installed. Canvas 2D won't paint with a webfont until the glyphs are ready,
// so we await loading and then re-render the trace canvas. Falls back to
// sans-serif if the family can't be fetched.
//
// Accepts anything you can grab from fonts.google.com:
//   • a bare family name              "Playfair Display"
//   • a css2 family spec              "Bebas+Neue:wght@400;700"
//   • the family= query part          "family=Inter:wght@700"
//   • a full embed URL                "https://fonts.googleapis.com/css2?family=…"
function parseFontSpec(raw) {
    let spec = (raw || '').trim();
    if (!spec) return null;
    if (/fonts\.googleapis\.com/.test(spec)) {
        const m = spec.match(/[?&]family=([^&]+)/);
        spec = m ? m[1] : '';
    } else if (/^family=/.test(spec)) {
        spec = spec.replace(/^family=/, '');
    }
    if (!spec) return null;
    // Family name (for canvas ctx.font) is the part before the ':' axis spec,
    // with '+' turned back into spaces.
    const family = spec.split(':')[0].replace(/\+/g, ' ').trim();
    if (!family) return null;
    // Build a css2 query: spaces → '+', keep ':' ';' '@' literal as Google wants.
    let query = spec.replace(/\s+/g, '+');
    if (!query.includes(':')) query += ':wght@400;700'; // ensure bold + regular
    return { href: `https://fonts.googleapis.com/css2?family=${query}&display=swap`, family };
}

let _fontLinkEl = null;
async function loadFontSpec(raw) {
    const parsed = parseFontSpec(raw);
    if (!parsed) { params.fontFamily = ''; renderTraceCanvas(); return; }
    const { href, family } = parsed;
    if (!_fontLinkEl) {
        _fontLinkEl = document.createElement('link');
        _fontLinkEl.rel = 'stylesheet';
        _fontLinkEl.id  = 'google-font-link';
        document.head.appendChild(_fontLinkEl);
    }
    try {
        // Setting href fetches + parses the @font-face rules. Wait for that
        // before asking the Font Loading API to download the actual glyphs.
        if (_fontLinkEl.href !== href) {
            await new Promise((resolve, reject) => {
                _fontLinkEl.onload  = resolve;
                _fontLinkEl.onerror = reject;
                _fontLinkEl.href    = href;
            });
        }
        await Promise.all([
            document.fonts.load(`bold 100px "${family}"`),
            document.fonts.load(`400 100px "${family}"`),
        ]);
    } catch (e) {
        console.warn(`Could not load Google Font "${family}" — using sans-serif fallback.`, e);
    }
    params.fontFamily = family;
    renderTraceCanvas();
}

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
    // Google-font family (loaded at runtime) with a system fallback baked in.
    const fontStack = params.fontFamily ? `"${params.fontFamily}", sans-serif` : 'sans-serif';

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
            ctx.font = `bold ${fontSize}px ${fontStack}`;
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
            ctx.font = `bold ${Math.round(fontSize)}px ${fontStack}`;
            const measured = ctx.measureText(text).width;
            const maxW     = tcW * 0.92;
            if (measured > maxW) {
                fontSize *= maxW / measured;
                ctx.font  = `bold ${Math.round(fontSize)}px ${fontStack}`;
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
        ctx.font = `bold ${fontSize}px ${fontStack}`;
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

// Decodes every frame of an animated image (GIF, animated WebP/AVIF) via the
// ImageDecoder API. Returns { frames: ImageBitmap[], durations: number[] } or
// null if the image is static, the API is unavailable, or decoding fails.
async function decodeAnimatedImage(blob) {
    if (typeof ImageDecoder === 'undefined') return null;
    let decoder;
    try {
        decoder = new ImageDecoder({ data: blob.stream(), type: blob.type || 'image/gif' });
        await decoder.tracks.ready;
        const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 1;
        if (frameCount <= 1) return null;
        const frames = [], durations = [];
        for (let i = 0; i < frameCount; i++) {
            const { image } = await decoder.decode({ frameIndex: i });
            frames.push(await createImageBitmap(image));
            durations.push(Math.max(50, (image.duration ?? 100_000) / 1000)); // µs→ms, min 50 ms
            image.close();
        }
        return { frames, durations };
    } catch { return null; }
    finally { decoder?.close(); }
}

function clearGif() {
    if (gifFrames) gifFrames.forEach(b => b.close());
    gifFrames = null; gifDurations = null; gifFrameIdx = 0; gifNextFrameAt = 0;
}

function clearAvoidGif() {
    if (avoidGifFrames) avoidGifFrames.forEach(b => b.close());
    avoidGifFrames = null; avoidGifDurations = null; avoidGifFrameIdx = 0; avoidGifNextFrameAt = 0;
}

async function loadMagnetImage(file) {
    clearGif();
    const anim = await decodeAnimatedImage(file);
    if (anim) {
        gifFrames = anim.frames; gifDurations = anim.durations;
        gifFrameIdx = 0; gifNextFrameAt = performance.now() + gifDurations[0];
        imageBitmap = gifFrames[0];
    } else {
        imageBitmap = await createImageBitmap(file, { colorSpaceConversion: 'none' });
    }
    renderTraceCanvas();
    scheduleAutoClear();
}

async function loadTraceImageFromUrl(url, fetchOptions = {}) {
    try {
        const res = await fetch(url, fetchOptions);
        if (!res.ok) { console.warn('[traceImage] HTTP', res.status, url); return; }
        const blob = await res.blob();
        clearGif();
        const anim = await decodeAnimatedImage(blob);
        if (anim) {
            gifFrames = anim.frames; gifDurations = anim.durations;
            gifFrameIdx = 0; gifNextFrameAt = performance.now() + gifDurations[0];
            imageBitmap = gifFrames[0];
        } else {
            imageBitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
        }
        renderTraceCanvas();
        scheduleAutoClear();
    } catch (err) {
        console.warn('[traceImage] failed to load:', url, err.message);
    }
}

function clearMagnetImage() {
    clearGif();
    imageBitmap = null;
    clearTimeout(autoClearTimer);
    autoClearTimer = null;
    renderTraceCanvas();
}

function clearTraceText() {
    const input = document.querySelector('#trace-text-input');
    if (input) input.value = '';
    captionText = '';
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
            { binding: 7, resource: golStateView ?? placeholderTexView },
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

// ── Simulation state machine ──────────────────────────────────────────────────
/// qrStatus: 'SHOW' — QR is drawn as the topmost layer on the trace canvas.
//                    Independent of user content — both can be visible simultaneously.
//           'HIDE' — QR layer is skipped; only user content (image/text) is drawn.
// mode:     'STORY'    — narrative-driven session; n8n sequences steps, votes, and content
//           'SHOWCASE' — ambient / exhibition mode; no story sequencing
// status:   'NORMAL' — formula steering + wind active, auto-cycling runs
//           'FREEROAM' — no formula, no wind; particles drift freely on momentum
//           'DOT'    — fixed inward-spiral formulas; wind + formula forced on regardless of params
const simState = {
    mode:              'STORY',
    colorMode:         'NORMAL',
    qrStatus:          'HIDE',
    status:            'DOT',
    storyStep:         null,   // echoed from n8n step ID; null = not in story mode
    storyVoteResult:   null,
    votesA:            0,      // raw vote count for optionA — dirty, never auto-reset
    votesB:            0,      // raw vote count for optionB — dirty, never auto-reset
    stepStatus:        'HARMONY', // 'HARMONY' | 'IDLE' | 'DRAW' | 'VOTE' — spectator interaction mode
    optionA:           null,
    optionB:           null,
    userCount:         0,      // live spectator count — updated via spectator-joined/-left
    voteEndTime:       null,   // wall-clock ms when the current vote closes; null = no active vote
    voteResultSent:    false,  // guard: prevents firing the vote-result call more than once
};

// GUI handles — assigned by initGUI() at the bottom of this file.
let stateCtrl     = null;
let qrStateCtrl   = null;
let modeCtrl      = null;
let colorModeCtrl = null;
let gui, swarmDebug, dbgUsers, dbgPitch, dbgRoll, dbgTemp, dbgCoherence, dbgChaos;
let applyGUIVisibility, toggleGUI, updateGizmo;

function updateStateDisplay() {
    modeCtrl?.updateDisplay();
    colorModeCtrl?.updateDisplay();
    stateCtrl?.updateDisplay();
    qrStateCtrl?.updateDisplay();
}

let freeroamTimer = null;

// Freeroam lock: when enabled, entering FREEROAM starts a timer that reverts the
// status to NORMAL after freeroamLockDelay seconds. Re-entering FREEROAM resets it.
function armFreeroamLock() {
    clearTimeout(freeroamTimer);
    freeroamTimer = null;
    if (simState.status === 'FREEROAM' && params.freeroamLock) {
        freeroamTimer = setTimeout(() => {
            freeroamTimer = null;
            if (params.freeroamLock && simState.status === 'FREEROAM') setStatus('NORMAL');
        }, Math.max(0, params.freeroamLockDelay) * 1000);
    }
}

// Single entry point for status changes (GUI dropdown and n8n API both route here),
// so the freeroam lock timer is armed/reset wherever FREEROAM is (re)entered.
function setStatus(newStatus) {
    simState.status = newStatus;
    if (newStatus === 'DOT') applyFormulas(DOT_DIR, DOT_WIND);
    armFreeroamLock();
    updateStateDisplay();
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
// Two separate fetch paths, each with its own in-flight guard:
//   /webhook/sim-event   — real-time events (vote-result, text input, etc.)
//   /webhook/heartbeat   — periodic full state snapshot; n8n uses this to drive story
// In test mode all paths switch to /webhook-test/*.

// ── Server echo ───────────────────────────────────────────────────────────────
// Whatever the server sends back in a heartbeat response is stored here and
// echoed verbatim in the next heartbeat. Session-only: cleared on page reload.
// The server can compare the echoed values against its current state and decide
// whether the client is up to date or needs a re-push.
let _serverEcho = {};

// Runtime toggle is `params.n8nEnabled`; URL `?n8n=off` flips that flag at boot.
// Every fetch / scheduler / fallback path that referenced N8N_BASE also checks
// the runtime flag, so disabling at runtime stops traffic without needing a reload.
const N8N_BASE            = (import.meta.env.VITE_N8N_BASE_URL ?? '').replace(/\/$/, '');
const N8N_USER_TIMEOUT_MS = 15_000;
let   n8nInFlight          = false;
let   n8nHeartbeatInFlight = false;

async function callN8n(event) {
    if (!N8N_BASE || !params.n8nEnabled || n8nInFlight) return;
    n8nInFlight = true;
    const path = params.n8nTestMode ? '/webhook-test/sim-event' : '/webhook/sim-event';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), N8N_USER_TIMEOUT_MS);
    try {
        const res = await fetch(N8N_BASE + path, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ ...event, room: sessionRoom }),
            signal:  controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
            const raw  = await res.json();
            const data = Array.isArray(raw) ? raw[0] : raw;
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
// In-flight guard: any heartbeat requested while one is running is dropped (no queue).
async function callN8nHeartbeat() {
    if (!N8N_BASE || !params.n8nEnabled) return;
    if (n8nHeartbeatInFlight) { console.log('[n8n heartbeat] skipped — previous call still in flight'); return; }
    n8nHeartbeatInFlight = true;
    const path = params.n8nTestMode ? '/webhook-test/heartbeat' : '/webhook/heartbeat';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.heartbeatTimeout * 1000);
    try {
        const res = await fetch(N8N_BASE + path, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                type:              'heartbeat',
                room:              sessionRoom,
                mode:              simState.mode,
                colorMode:         simState.colorMode,
                status:            simState.status,
                qrStatus:          simState.qrStatus,
                step:              simState.storyStep,
                stepStatus:        simState.stepStatus,
                optionA:           simState.optionA,
                optionB:           simState.optionB,
                votesA:            simState.votesA,
                votesB:            simState.votesB,
                storyVoteResult:   simState.storyVoteResult,
                userCount:         simState.userCount,
                avgChaos:          smoothChaos,
                ...(_n8nPassword !== null && { password: _n8nPassword }),
                ..._serverEcho,
                params:            { ...params },
            }),
            signal:  controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
            const raw  = await res.json();
            const data = Array.isArray(raw) ? raw[0] : raw;
            if (data && typeof data === 'object') {
                const { audio, audioFormat, audiobg, audiobgFormat, audiobgLoop,
                        traceImage, avoidMap, traceText, clearText, clearTrace,
                        restart, dir, wind, ...echoable } = data;
                _serverEcho = echoable;
                applySimParams(data);
            }
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
    if (N8N_BASE && params.n8nEnabled && params.heartbeatInterval > 0) {
        heartbeatTimer = setInterval(callN8nHeartbeat, params.heartbeatInterval * 1000);
    }
}
restartHeartbeat();

await applyFormulas(DOT_DIR, DOT_WIND, { reseed: true });

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

// Note-driven formula selection: sum of active note indices → modulo on formula arrays.
const _activeNotesBySpectator = new Map(); // spectatorId → noteIndex (0–8)
let _noteFormulaTimer = null; // debounce — evita recompile pipeline ad ogni cambio nota

// ── Harmony state ─────────────────────────────────────────────────────────────
// The cache key is the raw note sum — each unique note combination gets its own
// persistent avoidMap image. Images are stored in IndexedDB (binary, no size limit)
// and fetched on demand; no speculative prefetch.
let _harmonyActive     = false;
let _currentHarmonyKey = -1;        // active sum value, -1 = no harmony
const _harmonyFetching = new Set(); // sums currently being fetched

// ── IndexedDB helpers ─────────────────────────────────────────────────────────
const _HARMONY_DB_NAME  = 'thesis-sim-harmony';
const _HARMONY_DB_STORE = 'images';
let _harmonyDb = null;

function _openHarmonyDb() {
    if (_harmonyDb) return Promise.resolve(_harmonyDb);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(_HARMONY_DB_NAME, 1);
        req.onupgradeneeded = (e) => e.target.result.createObjectStore(_HARMONY_DB_STORE, { keyPath: 'sum' });
        req.onsuccess = (e) => { _harmonyDb = e.target.result; resolve(_harmonyDb); };
        req.onerror   = (e) => reject(e.target.error);
    });
}

async function _harmonyDbRead(sum) {
    try {
        const db = await _openHarmonyDb();
        return new Promise((resolve) => {
            const req = db.transaction(_HARMONY_DB_STORE, 'readonly').objectStore(_HARMONY_DB_STORE).get(sum);
            req.onsuccess = (e) => resolve(e.target.result?.bytes ?? null);
            req.onerror   = () => resolve(null);
        });
    } catch { return null; }
}

async function _harmonyDbWrite(sum, bytes) {
    try {
        const db = await _openHarmonyDb();
        return new Promise((resolve, reject) => {
            const req = db.transaction(_HARMONY_DB_STORE, 'readwrite').objectStore(_HARMONY_DB_STORE).put({ sum, bytes, savedAt: Date.now() });
            req.onsuccess = () => resolve();
            req.onerror   = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.warn('[harmony] IndexedDB write failed (sum=' + sum + '):', e.message);
    }
}

async function _enterHarmony(sum) {
    if (_harmonyActive && _currentHarmonyKey === sum) return;
    _harmonyActive     = true;
    _currentHarmonyKey = sum;
    let bytes = await _harmonyDbRead(sum);
    if (!bytes) {
        if (_harmonyFetching.has(sum)) return; // fetch already in flight for this sum
        _harmonyFetching.add(sum);
        try {
            bytes = await _fetchIdleImageBytes();
            await _harmonyDbWrite(sum, bytes);
        } catch (e) {
            console.warn('[harmony] enter sum', sum, 'failed:', e.message);
            return;
        } finally {
            _harmonyFetching.delete(sum);
        }
    }
    if (_currentHarmonyKey === sum) { // guard: sum may have changed while awaiting
        await loadAvoidMap(new Blob([bytes], { type: 'image/webp' }));
    }
}

function _exitHarmony() {
    if (!_harmonyActive) return;
    _harmonyActive     = false;
    _currentHarmonyKey = -1;
    clearAvoidMap();
}

function _recalcNoteFormulas() {
    let sum = 0;
    for (const idx of _activeNotesBySpectator.values()) sum += idx;

    const hasNotes = _activeNotesBySpectator.size > 0;

    if (hasNotes && (!_harmonyActive || sum !== _currentHarmonyKey)) _enterHarmony(sum);
    else if (!hasNotes && _harmonyActive) _exitHarmony();

    if (_activeNotesBySpectator.size === 0) return;

    const newDir  = DIR_FORMULAS[sum % DIR_FORMULAS.length];
    const newWind = WIND_FORMULAS[sum % WIND_FORMULAS.length];
    if (dirInput)  dirInput.value  = newDir;
    if (windInput) windInput.value = newWind;
    clearTimeout(_noteFormulaTimer);
    _noteFormulaTimer = setTimeout(() => applyFormulas(newDir, newWind), 400);
}

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
        u[b + 10] = s.burst ? 1 : 0;
        u[b + 11] = s.burstSeed >>> 0;
    }
    device.queue.writeBuffer(spectatorSlotsBuf, 0, ab);
}

// Fireworks: flag a slot's agents to scatter in random directions on the next
// compute frame. One-shot — the flag is cleared right after the frame consumes it.
function triggerReleaseBurst(slot) {
    slot.burst     = 1;
    slot.burstSeed = (Math.random() * 0x7fffffff) >>> 0;
}

// ── Session: Socket.IO connection + QR code ───────────────────────────────────
// The server assigns a session UUID on socket connect and emits it back as
// 'session-id'. The sim renders a QR code pointing to $VITE_USER_URL/?s=<id> as both
// a small scannable overlay and a large trace image in the canvas centre.
// If VITE_N8N_BASE_URL is set, the sim calls n8n directly on each remote-event.
// socket is declared here so the GUI's n8nTestMode onChange can reach it.
let socket;
// Base URL for server API calls — VITE_USER_URL in production, own origin as fallback.
const _apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
{
    // In dev, Vite runs on a different port from Express, so connect directly to Express.
    // In production, use VITE_SOCKET_URL (the Caddy-fronted public origin) so Socket.IO
    // traffic is routed through Caddy → Express. Falls back to '/' (same origin) if unset.
    const socketUrl = import.meta.env.DEV
        ? `http://localhost:${import.meta.env.VITE_SERVER_PORT ?? 3000}`
        : (import.meta.env.VITE_SOCKET_URL || '/');
    socket = ioConnect(socketUrl, { reconnectionDelay: 2000 });

    onAudioStateChange(() => {
        if (socket?.connected) socket.emit('audio-state', { locked: isAudioLocked() });
        _syncAudioBanner();
    });

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
        socket.emit('audio-state', { locked: isAudioLocked() });
    });

    socket.on('sim-params', (data) => {
        try { applySimParams(data); }
        catch { /* malformed payload — ignore */ }
    });

    // Collective swarm state — aggregated by the server from all spectators in the room.
    // Tilt bias: avgPitch/avgRoll are 0-1 (0.5 = phone held flat/neutral).
    // Temperature: 0 = cold (top of phone screen), 1 = warm (bottom of phone screen).
    socket.on('collective-state', ({ avgPitch, avgRoll, avgTemp, avgCoherence, avgChaos, userCount }) => {
        // Tilt is now per-spectator via remote-event; collective-state only drives temp/coherence.
        collectiveTemp      = avgTemp      ?? 0.5;
        collectiveCoherence = avgCoherence ?? 0.5;
        collectiveChaos     = avgChaos     ?? 1;
        console.log('[chaos] raw avgChaos:', avgChaos?.toFixed(4), '| users:', userCount);
        // Mirror to GUI debug panel (manual refresh — no .listen() RAF loop)
        swarmDebug.users     = userCount ?? 0;
        swarmDebug.pitch     = +(avgPitch     ?? 0.5).toFixed(3);
        swarmDebug.roll      = +(avgRoll      ?? 0.5).toFixed(3);
        swarmDebug.temp      = +(avgTemp      ?? 0.5).toFixed(3);
        swarmDebug.coherence = +(avgCoherence ?? 0.5).toFixed(3);
        swarmDebug.chaos     = +(avgChaos     ?? 1).toFixed(3);
        dbgUsers.updateDisplay();
        dbgPitch.updateDisplay();
        dbgRoll.updateDisplay();
        dbgTemp.updateDisplay();
        dbgCoherence.updateDisplay();
        dbgChaos.updateDisplay();
        updateGizmo(avgPitch ?? 0.75, avgRoll ?? 0.5);
    });

    // A spectator joined — assign a slot, send them their color, brightness burst.
    socket.on('spectator-joined', ({ spectatorId, userCount } = {}) => {
        if (userCount !== undefined) simState.userCount = userCount;
        if (userCount === 1) { loadIdleAudio(true); } // first user — start music with fade in
        if (simState.status === 'DOT' && userCount >= 1) setStatus('NORMAL');
        lastRemoteActivity = Date.now();
        burstBrightness    = BURST_BRIGHTNESS;
        if (spectatorId && activeSlots.length < MAX_SPECTATOR_SLOTS) {
            // Start with a neutral white — the phone sends a 'color-pick' immediately
            // after joining with its locally generated palette color, which overwrites this.
            activeSlots.push({ spectatorId, colorR: 1, colorG: 1, colorB: 1, spawnerX: 0.5, spawnerY: 0.5, spawnerLocationActive: 0, windX: 0, windY: 0, dx: 0, dy: 0, magnitude: 0, velocity: 0, _smoothDx: 0, _smoothDy: 0, lastInputTime: 0, burst: 0, burstSeed: 0 });
            uploadSpectatorSlots();
        }
        // Push current UI state so the new spectator shows the right screen immediately.
        socket.emit('remote-ui', _remoteUiPayload());
    });

    socket.on('spectator-left', ({ spectatorId, userCount } = {}) => {
        if (userCount !== undefined) simState.userCount = userCount;
        if (userCount === 0) {
            _exitHarmony();
            collectiveChaos     = 1;
            collectiveCoherence = 0.5;
            collectiveTemp      = 0.5;
            setSynthState(1.0, 0.5, 0, 0, 0.5);
            // last user left — fade out music, only synth remains
            const _fadeGen = ++_idleAudioGen;
            fadeOutIdleTrack(smoothChaos, () => {
                if (_fadeGen === _idleAudioGen) stopIdleTrack();
            });
        }
        if (spectatorId) {
            const idx = activeSlots.findIndex(s => s.spectatorId === spectatorId);
            if (idx !== -1) {
                activeSlots.splice(idx, 1);
                uploadSpectatorSlots();
            }
            _activeNotesBySpectator.delete(spectatorId);
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
        note:       { sendToN8n: false },
    };

    socket.on('remote-event', (event) => {
        lastRemoteActivity = Date.now();
        if (event.type === 'spawner') {
            const slot = activeSlots.find(s => s.spectatorId === event.spectatorId);
            if (slot) {
                const { dx = 0, dy = 0, magnitude = 0, velocity = 0, active = true } = event.data ?? {};
                if (!active) {
                    if (slot.spawnerLocationActive === 1) triggerReleaseBurst(slot); // fireworks on release
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
        if (event.type === 'shake' || event.type === 'note') {
            const slot = activeSlots.find(s => s.spectatorId === event.spectatorId);
            if (slot) {
                triggerReleaseBurst(slot);
                uploadSpectatorSlots();
            }
            if (event.type === 'note' && event.data?.freq) addArpInfluence(event.data.freq);
            if (event.type === 'note' && typeof event.data?.index === 'number') {
                _activeNotesBySpectator.set(event.spectatorId, event.data.index);
                _recalcNoteFormulas();
            }
        }
        if (event.type === 'note-off') {
            _activeNotesBySpectator.delete(event.spectatorId);
        }
        if (event.type === 'pulse-tap') {
            pulseEnergy = Math.min(pulseEnergy + PULSE_INCREMENT, PULSE_MAX);
        }
        if (event.type === 'raise' || event.type === 'wave') {
            burstBrightness = BURST_BRIGHTNESS;
        }
        if (event.type === 'text' && event.data?.text && (!N8N_BASE || !params.n8nEnabled)) {
            const input = document.querySelector('#trace-text-input');
            if (input) input.value = event.data.text;
            renderTraceCanvas();
            scheduleAutoClear();
        }
        if (REMOTE_EVENTS[event.type]?.sendToN8n) callN8n(event);
    });

    // Running vote tally from server — update storyVoteResult to current leader.
    socket.on('story-vote-update', ({ optionA, votesA, optionB, votesB }) => {
        simState.votesA = votesA ?? 0;
        simState.votesB = votesB ?? 0;
        if      (votesA > votesB) simState.storyVoteResult = optionA;
        else if (votesB > votesA) simState.storyVoteResult = optionB;
        else                      simState.storyVoteResult = null;
    });

    socket.on('connect_error', () => console.warn('[socket] connection failed, will retry…'));

    socket.on('openai-audio', ({ base64, mimeType = 'audio/mpeg' } = {}) => {
        if (!base64) return;
        playAudio(base64, mimeType).catch(e => console.warn('[openai-audio]', e));
    });
}

const voteCountdownEl = document.querySelector('#vote-countdown');

function _remoteUiPayload() {
    const isVote      = simState.stepStatus === 'VOTE';
    const stepStatus  = simState.storyStep != null ? simState.stepStatus : null;
    return {
        stepStatus,
        optionA:       simState.optionA,
        optionB:       simState.optionB,
        color1:        params.color1,
        color2:        params.color2,
        ...(isVote && { voteDuration: params.voteDuration }),
    };
}

function _startVoteTimer(status) {
    if (status === 'VOTE') {
        simState.voteEndTime    = Date.now() + params.voteDuration * 1000;
        simState.voteResultSent = false;
    } else {
        simState.voteEndTime = null;
    }
}

// Merge n8n-provided params into the live simulation.
// Only numeric/boolean keys present in the payload are applied;
// if formulas are included they re-trigger pipeline compilation.
function applySimParams(data) {
    const { dir, wind, restart, clearTrace, showQR, traceText, clearText, traceImage, status, avoidMap,
            step, stepStatus, optionA, optionB, caption,
            audio, audioFormat, audiobg, audiobgFormat, audiobgLoop, mode, colorMode, ...rest } = data;

    if (audio    !== undefined) playAudio(audio    || null, audioFormat)                              .catch(e => console.warn('[audio]',    e));
    if (audiobg  !== undefined) playAudioBg(audiobg || null, audiobgFormat, audiobgLoop !== false)    .catch(e => console.warn('[audiobg]',  e));

    // Story step — a new step ID resets all completion state then applies the step's UI mode.
    if (step !== undefined) {
        simState.storyStep       = step;
        simState.storyVoteResult = null;
        simState.stepStatus      = stepStatus ?? 'IDLE';
        simState.optionA         = optionA    ?? null;
        simState.optionB         = optionB    ?? null;
        _startVoteTimer(simState.stepStatus);
        socket.emit('remote-ui', _remoteUiPayload());
    } else if (stepStatus !== undefined && (
        stepStatus !== simState.stepStatus ||
        optionA    !== simState.optionA    ||
        optionB    !== simState.optionB
    )) {
        // Mid-step status change — only emit when something actually changed.
        simState.stepStatus = stepStatus;
        if (optionA !== undefined) simState.optionA = optionA;
        if (optionB !== undefined) simState.optionB = optionB;
        _startVoteTimer(simState.stepStatus);
        socket.emit('remote-ui', _remoteUiPayload());
    }
    if (mode === 'SHOWCASE' || mode === 'STORY') {
        simState.mode = mode;
        updateStateDisplay();
    }
    if (colorMode === 'NORMAL' || colorMode === 'GRAYSCALE' || colorMode === 'GRAYSCALE_INVERTED') {
        simState.colorMode = colorMode;
        updateStateDisplay();
    }
    if (status === 'NORMAL' || status === 'FREEROAM' || status === 'DOT') {
        setStatus(status);
    }
    if (restart)              seedAgents();
    if (avoidMap === null)    clearAvoidMap();
    else if (typeof avoidMap === 'string') loadAvoidMap(avoidMap);
    if (clearTrace) {
        clearGif();
        imageBitmap = null;
        captionText = '';
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
        if (input) input.value = traceText || '';
        clearTimeout(autoClearTimer);
        autoClearTimer = null;
        renderTraceCanvas();
        if (traceText) scheduleAutoClear();
    }
    const changed = (k) => k in rest && rest[k] !== params[k];
    const needsRetrace = ['traceScale','qrSize','qrMargin','qrAlignX','qrAlignY',
                          'imageX','imageY','imageSize'].some(changed);
    const needsQRReseed = !params.qrOverlay &&
        ['qrAlignX','qrAlignY','qrSize','qrMargin'].some(changed);
    const needsQRRegen  = ['qrQuietZone','qrInvert'].some(changed);
    const needsReseed   = ['agentCount','weightSpread'].some(changed);
    const needsRebuild  = changed('renderScale');

    Object.entries(rest).forEach(([k, v]) => {
        if (k in params) params[k] = v;
    });
    if ('heartbeatInterval' in rest) restartHeartbeat();
    if (rest.triggerHeartbeat)       callN8nHeartbeat();
    if ('duckLevel'  in rest) setDuckLevel(params.duckLevel);
    if ('n8nTestMode' in rest) socket.emit('set-n8n-test-mode', params.n8nTestMode);
    if (needsReseed)  seedAgents();
    if (needsRebuild) applyResize();
    if (needsRetrace) renderTraceCanvas();
    if (needsQRReseed) seedAgents();
    if (needsQRRegen)  generateQR().then(renderTraceCanvas);
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
    modeCtrl, colorModeCtrl, stateCtrl, qrStateCtrl,
    dbgUsers, dbgPitch, dbgRoll, dbgTemp, dbgCoherence, dbgChaos,
    applyGUIVisibility, toggleGUI, updateGizmo,
} = initGUI({
    params, socket, simState, MAX_AGENTS,
    seedAgents, seedGoL, setSize, rebuildOffscreen, rebuildGridTex, applyResize,
    renderTraceCanvas, generateQR, loadFontSpec,
    clearMagnetImage, clearTraceText, clearAvoidMap,
    restartHeartbeat,
}));

stateCtrl.onChange(v => setStatus(v));
qrStateCtrl.onChange(() => { updateStateDisplay(); renderTraceCanvas(); });

window.addEventListener('keydown', e => {
    if (e.key === 'Control') toggleGUI();
    if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        _captureRequested = true;
    }
    if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        _narrateChaosVal         = smoothChaos;
        _narrateCaptureRequested = true;
    }
});

// ── Formula UI wiring ─────────────────────────────────────────────────────────
const dirInput  = document.querySelector('#dir-input');
const windInput = document.querySelector('#wind-input');
const applyBtn  = document.querySelector('#apply-btn');
const presetsEl = document.querySelector('#presets');

dirInput.value  = DOT_DIR;
windInput.value = DOT_WIND;

// ── Auto formula cycle — random pick every 30 s ───────────────────────────────
// Each flag is checked independently; both can fire in the same tick.
// STATUS=FREEROAM suspends cycling; followFormula / windEnabled guard the rest.
setInterval(() => {
    if (simState.status !== 'NORMAL') return;
    if (activeSlots.length > 0) return; // idle only — freeze formula while users are connected

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

// ── Audio unlock — any interaction anywhere ───────────────────────────────────
const _audioBanner = document.querySelector('#audio-unlock');

function _syncAudioBanner() {
    _audioBanner?.classList.toggle('unlocked', isAudioReady());
}

document.addEventListener('pointerdown', async () => {
    await unlockAudio();
    if (socket?.connected) socket.emit('audio-state', { locked: isAudioLocked() });
    _syncAudioBanner();
    startSynth().then(() => setSynthState(1.0, smoothCoherence, smoothBiasX, smoothBiasY, smoothTemp));
    if (simState.userCount > 0) loadIdleAudio(true);
}, { once: true });

// ── File input for trace image ────────────────────────────────────────────────

document.querySelector('#image-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) loadMagnetImage(file);
    e.target.value = '';
});

// ── Avoidance map upload ──────────────────────────────────────────────────────
async function loadAvoidMap(source) {
    _qrOwnedAvoidMap = false; // user-loaded map; QR must not clear it
    const blob = typeof source === 'string'
        ? await fetch(source).then(r => r.blob())
        : source; // File is a Blob
    clearAvoidGif();
    const anim = await decodeAnimatedImage(blob);
    let bmp;
    if (anim) {
        avoidGifFrames = anim.frames; avoidGifDurations = anim.durations;
        avoidGifFrameIdx = 0; avoidGifNextFrameAt = performance.now() + avoidGifDurations[0];
        bmp = avoidGifFrames[0];
    } else {
        bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
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
    rebuildRenderBG();
    if (!_inQROverlayUpdate && params.qrOverlay && simState.qrStatus === 'SHOW' && qrBitmap) updateQROverlay();
}

function clearAvoidMap() {
    clearAvoidGif();
    if (avoidMapTex) { avoidMapTex.destroy(); avoidMapTex = null; }
    avoidMapTexView = null;
    hasAvoidMap     = false;
    rebuildSimBG();
    rebuildRenderBG();
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

// ── Font UI wiring ────────────────────────────────────────────────────────────
// Paste a Google Fonts family (or the relevant part of its URL) and apply on
// Enter or blur. The default family is loaded once at startup.
const fontInput = document.querySelector('#font-input');
if (fontInput) {
    fontInput.value = params.fontFamily;
    const applyFontInput = () => loadFontSpec(fontInput.value);
    fontInput.addEventListener('change', applyFontInput);
    fontInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyFontInput(); });
}
loadFontSpec(params.fontFamily); // load the default Google Font on boot

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
let collectiveChaos   = 1;   // target chaos [0=armonia … 1=max noise] (from device rotation average)

let smoothBiasX       = 0;   // smoothed versions
let smoothBiasY       = 0;
let smoothTemp        = 0.5;
let smoothCoherence   = 0.5;
let smoothChaos       = 1;
let _lastSynthTick    = 0;    // throttle: call setSynthState at most every 200ms

// ── Join burst state ──────────────────────────────────────────────────────────
// When a spectator joins, a single brightness pulse fires across the field.
const REST_BRIGHTNESS  = 0.1;   // fixed brightness scale — former audio "silence floor" (audio now drives color, not brightness)
const BURST_BRIGHTNESS = 0.4;   // peak brightness boost added to params.brightness
const BURST_DECAY      = 0.88;  // per frame — fully dissipated in ~0.5 s at 60 fps
const BURST_THRESHOLD  = 0.001;
let burstBrightness = 0;

const PULSE_INCREMENT  = 0.015; // brightness added per tap event
const PULSE_MAX        = 0.5;   // cap so a full crowd at full speed doesn't blow out
const PULSE_DECAY      = 0.96;  // per frame — dissipates in ~1.5 s at 60 fps
const PULSE_THRESHOLD  = 0.001;
let pulseEnergy = 0;

// ── Uniform writers ───────────────────────────────────────────────────────────
function writeSoloUB(dt, time) {
    // Smooth collective state toward targets (~0.8 s time constant)
    const a = Math.exp(-dt / 0.8);
    smoothBiasX     = smoothBiasX     * a + collectiveBiasX     * (1 - a);
    smoothBiasY     = smoothBiasY     * a + collectiveBiasY     * (1 - a);
    smoothTemp      = smoothTemp      * a + collectiveTemp      * (1 - a);
    smoothCoherence = smoothCoherence * a + collectiveCoherence * (1 - a);
    smoothChaos     = smoothChaos     * a + collectiveChaos     * (1 - a);

    // Decay join brightness pulse exponentially each frame
    burstBrightness *= BURST_DECAY;
    if (burstBrightness < BURST_THRESHOLD) burstBrightness = 0;

    // Decay collective pulse energy from PULSE step taps
    pulseEnergy *= PULSE_DECAY;
    if (pulseEnergy < PULSE_THRESHOLD) pulseEnergy = 0;

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
    const isIdle = simState.status === 'FREEROAM';
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
    f[35] = params.spectatorAgentShare / 100.0;
    u[36] = isDot ? 1 : 0;
    f[37] = params.dotCenterRadius;
    f[38] = params.dotRespawnChance;
    u[39] = params.respawnOnQR ? 1 : 0;
    f[40] = params.qrRespawnChance;
    const isQRActive = simState.qrStatus === 'SHOW';
    if (isQRActive) {
        const _minDim = Math.min(canvas.width, canvas.height);
        const _sz     = params.qrSize   * _minDim;
        const _margin = params.qrMargin * _minDim + _sz / 2;
        const _cx = params.qrAlignX === 'left'   ? _margin
                  : params.qrAlignX === 'right'  ? canvas.width  - _margin
                  :                                canvas.width  / 2;
        const _cy = params.qrAlignY === 'top'    ? _margin
                  : params.qrAlignY === 'bottom' ? canvas.height - _margin
                  :                                canvas.height / 2;
        f[41] = _cx - _sz / 2;
        f[42] = _cy - _sz / 2;
        f[43] = _cx + _sz / 2;
        f[44] = _cy + _sz / 2;
    } else {
        f[41] = 0; f[42] = 0; f[43] = 0; f[44] = 0;
    }
    u[45] = params.avoidMapInvert ? 1 : 0;
    // GoL activated automatically when collective chaos exceeds the freeroam threshold
    params.golEnabled = smoothChaos > 0.3;
    u[46] = params.golEnabled ? 1 : 0;
    f[47] = params.golStrength;
    f[48] = params.releaseBurstSpeed;
    const chaosGPU = activeSlots.length > 0 ? Math.min(smoothChaos / 0.3, 1.0) : 0;
    f[49] = chaosGPU;
    const teleportActive = !params.randomTeleportOnAvoidMap || hasAvoidMap;
    f[50] = teleportActive ? params.randomTeleportChance : 0;
    setChaos(chaosGPU);
    const _synthNow = performance.now();
    if (_synthNow - _lastSynthTick >= 200) {
        _lastSynthTick = _synthNow;
        setSynthState(smoothChaos, smoothCoherence, smoothBiasX, smoothBiasY, smoothTemp);
        setIdleChaos(smoothChaos);
    }
    if (Math.random() < 0.01) console.log('[chaos] smoothChaos→GPU:', smoothChaos.toFixed(4));
    device.queue.writeBuffer(soloUB, 0, ab);
}

function writeRenderUB() {
    const ab = _renderAB;
    const u  = _renderU;
    const f  = _renderF;
    const c1 = hexToF(params.color1);
    const c2 = hexToF(params.color2);

    // Blend c1 toward warm orange as collective chaos rises (no param change — GPU only)
    const _cw = smoothChaos;
    const _c1r = c1[0] + (1.0 - c1[0]) * _cw;
    const _c1g = c1[1] + (0.25 - c1[1]) * _cw;
    const _c1b = c1[2] + (0.0  - c1[2]) * _cw;

    const { x0, y0, x1, y1 } = getImageRegion();
    u[0] = params.agentCount;
    f[1] = canvas.width;
    f[2] = canvas.height;
    f[3] = params.pointSize;
    f[4] = _c1r;
    f[5] = _c1g;
    f[6] = _c1b;
    f[7] = params.maxSpeed;
    u[8]  = hasImage ? 1 : 0;
    f[9]  = x0;
    f[10] = y0;
    f[11] = x1;
    f[12] = y1;
    f[13] = c2[0];
    f[14] = c2[1];
    f[15] = c2[2];
    // Audio no longer affects brightness — it leans the palette toward color2 instead (f[38]).
    // Audio used to multiply brightness by audioMult ∈ [0.1, 1.0] (0.1 at rest). Keep that
    // former resting level as a fixed scale so the at-rest look is unchanged; brightness,
    // burst and pulse stay in the same balance they had before.
    f[16] = (params.brightness + burstBrightness + pulseEnergy) * REST_BRIGHTNESS;
    f[17] = params.alphaThreshold;
    f[18] = params.blackThreshold;
    f[19] = simState.qrStatus === 'SHOW' ? 0 : params.vignetteEdge;
    u[20] = simState.qrStatus === 'SHOW' ? 1 : 0;
    f[21] = params.homingProximityRange;
    f[22] = params.homingMinAlpha;
    u[23] = activeSlots.length;
    u[24] = params.additiveBlend ? 1 : 0;
    f[25] = params.spectatorAgentShare / 100.0;
    // Pixel-grid mode: when on, vertex shader snaps agents to gridTex cells and
    // draws 1-cell quads. cellsW/cellsH must match the gridTex that the same
    // frame's render pass will target — see frame loop where the attachment
    // selection mirrors this condition.
    const usingPixel = !!(params.pixelGrid && gridTex);
    u[26] = usingPixel ? 1 : 0;
    if (usingPixel) {
        const [cellsW, cellsH] = gridCellDims();
        f[27] = cellsW;
        f[28] = cellsH;
    } else {
        f[27] = 1;
        f[28] = 1;
    }
    f[29] = params.blendAmount;
    // Avoid map options for per-particle color sampling. hasAvoidMap mirrors the
    // global flag so the shader can early-out when no map is loaded (the binding
    // is still valid — it falls back to placeholderTexView).
    u[30] = hasAvoidMap ? 1 : 0;
    f[31] = params.avoidMapScale;
    u[32] = params.avoidMapInvert ? 1 : 0;
    u[33] = params.avoidMapSampleColor ? 1 : 0;
    u[34] = params.avoidMapFixedColor  ? 1 : 0;
    f[35] = params.avoidMapBlackCutoff;
    u[36] = params.championsEnabled ? params.champions : 0;
    f[37] = params.championSize;
    // Room audio leans the base palette toward color2: 0 at silence, → color2AudioStr at peak.
    f[38] = (isActive() ? getVolume() : 0) * params.color2AudioStr;
    // AvoidMap color sampling probability: 0.30 + chaos*0.70 (30% at harmony, 100% at full chaos)
    f[39] = smoothChaos;
    // Chaos color override — fraction of all agents forced to chaosColor, scales with chaos
    const cc = hexToF(params.chaosColor);
    f[40] = cc[0];
    f[41] = cc[1];
    f[42] = cc[2];
    f[43] = params.chaosColorFraction;
    // Idle color override — only active when no spectators connected (JS zeroes fraction when active)
    const ic = hexToF(params.idleColor);
    f[44] = ic[0];
    f[45] = ic[1];
    f[46] = ic[2];
    f[47] = activeSlots.length === 0 ? params.idleColorFraction : 0.0;
    device.queue.writeBuffer(renderUB, 0, ab);
}


function writeFadeUB() {
    _fadeF[0] = params.trailDecay;
    device.queue.writeBuffer(fadeUB, 0, _fadeAB);
}

function writeDownsampleUB(cellsW, cellsH) {
    _downsampleF[0] = cellsW;
    _downsampleF[1] = cellsH;
    device.queue.writeBuffer(downsampleUB, 0, _downsampleAB);
}

function writeBlitUB() {
    _blitF[0] = params.bgBlackCutoff;
    _blitF[1] = params.toneBlack;
    _blitF[2] = params.toneWhite;
    _blitF[3] = params.toneGamma;
    _blitF[4] = params.shadowBoost;
    _blitU[5] = simState.colorMode === 'GRAYSCALE'          ? 1
              : simState.colorMode === 'GRAYSCALE_INVERTED' ? 2
              : 0;
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
    _shadowU[7] = params.championsEnabled ? params.champions : 0;
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
const _soloAB  = new ArrayBuffer(208); const _soloU  = new Uint32Array(_soloAB);  const _soloF  = new Float32Array(_soloAB);
const _renderAB= new ArrayBuffer(192); const _renderU= new Uint32Array(_renderAB); const _renderF= new Float32Array(_renderAB);
const _fadeAB  = new ArrayBuffer(16);  const _fadeF  = new Float32Array(_fadeAB);
const _blitAB  = new ArrayBuffer(32);  const _blitF  = new Float32Array(_blitAB); const _blitU  = new Uint32Array(_blitAB);
const _downsampleAB = new ArrayBuffer(16); const _downsampleF = new Float32Array(_downsampleAB);
const _contamAB= new ArrayBuffer(176); const _contamU= new Uint32Array(_contamAB); const _contamF= new Float32Array(_contamAB);
const _shadowAB= new ArrayBuffer(32);  const _shadowF= new Float32Array(_shadowAB); const _shadowU= new Uint32Array(_shadowAB);
const _golAB   = new ArrayBuffer(16);  const _golU   = new Uint32Array(_golAB);   const _golF   = new Float32Array(_golAB);
const _imgDbgAB= new ArrayBuffer(32);  const _imgDbgF= new Float32Array(_imgDbgAB);
const _windVisAB=new ArrayBuffer(32);  const _windVisF=new Float32Array(_windVisAB); const _windVisU=new Uint32Array(_windVisAB);

// ── Screenshot capture ───────────────────────────────────────────────────────
// Press 's' to capture the current frame at canvas backing-store resolution.
// The flag is consumed inside frame() — copy happens in the same command encoder
// as the frame, after the blit pass, so we always grab what was just on screen.
let _captureRequested = false;

// Press 'f' to narrate — captures frame first, then emits with base64 image.
let _narrateCaptureRequested = false;
let _narrateChaosVal         = 0;

// Trigger a browser download of a Blob under the given filename.
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// Build an uncompressed baseline CMYK TIFF from straight-alpha RGBA pixels.
// Naive, device-independent RGB→CMYK (no ICC profile, per project decision) —
// final print conversion is expected to happen in pro software. When withAlpha
// is true a 5th unassociated-alpha sample is written so transparency survives.
function encodeCmykTiff(rgba, w, h, withAlpha) {
    const spp    = withAlpha ? 5 : 4;        // samples per pixel
    const px      = w * h * spp;              // pixel data byte count (8-bit samples)
    const tags    = withAlpha ? 12 : 11;      // IFD entry count
    const ifd     = 2 + 12 * tags + 4;        // count + entries + next-IFD offset
    const bpsOff  = 8 + ifd;                  // BitsPerSample array sits after the IFD
    const pixOff  = bpsOff + spp * 2;         // pixel data follows
    const ab = new ArrayBuffer(pixOff + px);
    const dv = new DataView(ab);
    const u8 = new Uint8Array(ab);

    // Header (little-endian)
    dv.setUint16(0, 0x4949, true);  // 'II'
    dv.setUint16(2, 42, true);
    dv.setUint32(4, 8, true);       // first IFD offset

    // IFD — entries must be in ascending tag order
    dv.setUint16(8, tags, true);
    let o = 10;
    const SHORT = 3, LONG = 4;
    const entry = (tag, type, count, value) => {
        dv.setUint16(o, tag, true);
        dv.setUint16(o + 2, type, true);
        dv.setUint32(o + 4, count, true);
        dv.setUint32(o + 8, value, true); // inline value (SHORT count-1 uses low 2 bytes) or offset
        o += 12;
    };
    entry(256, LONG,  1, w);        // ImageWidth
    entry(257, LONG,  1, h);        // ImageLength
    entry(258, SHORT, spp, bpsOff); // BitsPerSample → out-of-line array (spp×8)
    entry(259, SHORT, 1, 1);        // Compression = none
    entry(262, SHORT, 1, 5);        // PhotometricInterpretation = Separated (CMYK)
    entry(273, LONG,  1, pixOff);   // StripOffsets
    entry(277, SHORT, 1, spp);      // SamplesPerPixel
    entry(278, LONG,  1, h);        // RowsPerStrip (single strip)
    entry(279, LONG,  1, px);       // StripByteCounts
    entry(284, SHORT, 1, 1);        // PlanarConfiguration = chunky
    entry(332, SHORT, 1, 1);        // InkSet = CMYK
    if (withAlpha) entry(338, SHORT, 1, 2); // ExtraSamples = unassociated alpha
    dv.setUint32(o, 0, true);       // no next IFD

    for (let s = 0; s < spp; s++) dv.setUint16(bpsOff + s * 2, 8, true); // BitsPerSample = 8 each

    // Pixel data — naive RGB→CMYK
    let d = pixOff;
    for (let i = 0; i < w * h; i++) {
        const r = rgba[i * 4] / 255, g = rgba[i * 4 + 1] / 255, b = rgba[i * 4 + 2] / 255;
        const k = 1 - Math.max(r, g, b);
        let c = 0, m = 0, y = 0;
        if (k < 1) { c = (1 - r - k) / (1 - k); m = (1 - g - k) / (1 - k); y = (1 - b - k) / (1 - k); }
        u8[d++] = Math.round(c * 255);
        u8[d++] = Math.round(m * 255);
        u8[d++] = Math.round(y * 255);
        u8[d++] = Math.round(k * 255);
        if (withAlpha) u8[d++] = rgba[i * 4 + 3];
    }
    return new Blob([ab], { type: 'image/tiff' });
}

async function finalizeCapture(buf, w, h, padded) {
    try {
        await buf.mapAsync(GPUMapMode.READ);
        const src = new Uint8Array(buf.getMappedRange());
        const isBGRA = canvasFormat === 'bgra8unorm';
        const transparent = params.exportTransparent;
        const out = new Uint8ClampedArray(w * h * 4);
        const stride = w * 4;
        for (let y = 0; y < h; y++) {
            const srcOff = y * padded;
            const dstOff = y * stride;
            for (let x = 0; x < stride; x += 4) {
                const r = isBGRA ? src[srcOff + x + 2] : src[srcOff + x];
                const g = src[srcOff + x + 1];
                const b = isBGRA ? src[srcOff + x]     : src[srcOff + x + 2];
                if (transparent) {
                    // Additive light on true black → brightness is a perfect alpha
                    // mask. Un-premultiply so the glow keeps its full intensity.
                    const a = Math.max(r, g, b);
                    if (a > 0) {
                        out[dstOff + x]     = Math.min(255, Math.round(r * 255 / a));
                        out[dstOff + x + 1] = Math.min(255, Math.round(g * 255 / a));
                        out[dstOff + x + 2] = Math.min(255, Math.round(b * 255 / a));
                    }
                    out[dstOff + x + 3] = a;
                } else {
                    out[dstOff + x]     = r;
                    out[dstOff + x + 1] = g;
                    out[dstOff + x + 2] = b;
                    out[dstOff + x + 3] = 255;
                }
            }
        }
        buf.unmap();
        buf.destroy();

        // Composite the QR overlay (separate 2D canvas) — but not for a transparent
        // export, where its black modules would punch holes in the alpha.
        const qrOpacity   = parseFloat(qrOverlayEl.style.opacity) || 0;
        const compositeQR = !transparent && qrOpacity > 0 && qrOverlayEl.width > 0 && qrOverlayEl.height > 0;

        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const c2d = tmp.getContext('2d');
        c2d.putImageData(new ImageData(out, w, h), 0, 0);
        if (compositeQR) {
            c2d.globalAlpha = qrOpacity;
            c2d.drawImage(qrOverlayEl, 0, 0, w, h);
            c2d.globalAlpha = 1;
        }

        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        if (params.exportCMYK) {
            const rgba = compositeQR ? c2d.getImageData(0, 0, w, h).data : out;
            downloadBlob(encodeCmykTiff(rgba, w, h, transparent), `thesis-sim-${ts}.tif`);
        } else {
            tmp.toBlob(blob => { if (blob) downloadBlob(blob, `thesis-sim-${ts}.png`); }, 'image/png');
        }
    } catch (e) {
        console.warn('[screenshot]', e);
    }
}

async function finalizeNarrateCapture(buf, w, h, padded, chaosVal) {
    try {
        await buf.mapAsync(GPUMapMode.READ);
        const src    = new Uint8Array(buf.getMappedRange());
        const isBGRA = canvasFormat === 'bgra8unorm';
        const out    = new Uint8ClampedArray(w * h * 4);
        const stride = w * 4;
        for (let y = 0; y < h; y++) {
            const srcOff = y * padded;
            const dstOff = y * stride;
            for (let x = 0; x < stride; x += 4) {
                out[dstOff + x]     = isBGRA ? src[srcOff + x + 2] : src[srcOff + x];
                out[dstOff + x + 1] = src[srcOff + x + 1];
                out[dstOff + x + 2] = isBGRA ? src[srcOff + x]     : src[srcOff + x + 2];
                out[dstOff + x + 3] = 255;
            }
        }
        buf.unmap();
        buf.destroy();

        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const c2d = tmp.getContext('2d');
        c2d.putImageData(new ImageData(out, w, h), 0, 0);

        const dataUrl = tmp.toDataURL('image/jpeg', 0.7);
        const base64  = dataUrl.slice(dataUrl.indexOf(',') + 1);

        socket.emit('openai-narrate', { chaos: chaosVal, image: base64 });
    } catch (e) {
        console.warn('[narrate-capture]', e);
        socket.emit('openai-narrate', { chaos: chaosVal });
    }
}

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

    // Vote countdown — update display and fire result when timer expires.
    if (simState.stepStatus === 'VOTE' && simState.voteEndTime) {
        const wallNow   = Date.now();
        const remaining = Math.max(0, Math.ceil((simState.voteEndTime - wallNow) / 1000));
        if (voteCountdownEl) { voteCountdownEl.textContent = remaining; voteCountdownEl.classList.add('visible'); }
        if (wallNow >= simState.voteEndTime && !simState.voteResultSent) {
            simState.voteResultSent = true;
            simState.voteEndTime    = null;
            const winner         = simState.storyVoteResult === simState.optionA ? 'A'
                                 : simState.storyVoteResult === simState.optionB ? 'B'
                                 : null;
            callN8n({ type: 'vote-result', winner, winning_option: simState.storyVoteResult ?? null });
        }
    } else if (voteCountdownEl) {
        voteCountdownEl.classList.remove('visible');
    }

    // Move each spectator's spawner along the last joystick direction, check inactivity timeout.
    if (activeSlots.length) {
        const wallNow = Date.now();
        let dirty = false;
        for (const slot of activeSlots) {
            if (slot.spawnerLocationActive === 1) {
                if (wallNow - slot.lastInputTime > params.spawnerInactiveTimeout * 1000) {
                    triggerReleaseBurst(slot); // fireworks when the joystick goes silent
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

    // ── Advance animated GIF frames ───────────────────────────────────────────
    {
        const perfNow = performance.now();
        if (gifFrames && perfNow >= gifNextFrameAt) {
            gifFrameIdx    = (gifFrameIdx + 1) % gifFrames.length;
            gifNextFrameAt = perfNow + gifDurations[gifFrameIdx];
            imageBitmap    = gifFrames[gifFrameIdx];
            renderTraceCanvas();
        }
        if (avoidGifFrames && avoidMapTex && perfNow >= avoidGifNextFrameAt) {
            avoidGifFrameIdx    = (avoidGifFrameIdx + 1) % avoidGifFrames.length;
            avoidGifNextFrameAt = perfNow + avoidGifDurations[avoidGifFrameIdx];
            const bmp = avoidGifFrames[avoidGifFrameIdx];
            device.queue.copyExternalImageToTexture(
                { source: bmp },
                { texture: avoidMapTex },
                [bmp.width, bmp.height],
            );
        }
    }

    writeSoloUB(dt, now);
    writeRenderUB();
    writeFadeUB();
    writeBlitUB();
    writeContamUB();
    writeAgentShadowUB();

    const enc = device.createCommandEncoder();

    // Game of Life step: advance the automaton every golStepInterval frames, then copy
    // the new generation back over the state texture that the compute pass reads.
    if (params.golEnabled && golStepBG && golScratchView && golStateTex) {
        golTick++;
        const interval = Math.max(1, params.golStepInterval | 0);
        if (golTick % interval === 0) {
            _golU[0] = golTick >>> 0;
            _golF[1] = params.golSpark;
            device.queue.writeBuffer(golUB, 0, _golAB);
            const gp = enc.beginRenderPass({
                colorAttachments: [{
                    view: golScratchView,
                    loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
                }],
            });
            gp.setPipeline(golStepPipe);
            gp.setBindGroup(0, golStepBG);
            gp.draw(3);
            gp.end();
            enc.copyTextureToTexture(
                { texture: golScratchTex },
                { texture: golStateTex },
                [golW, golH, 1],
            );
        }
    }

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

    // Pixel-grid mode renders particles snapped-to-cell directly into the small
    // gridTex; non-pixel mode draws full-resolution particles into offscreenTex
    // as before. Both targets are rgba16float so the pipelines work on either.
    const usingPixel = !!(params.pixelGrid && gridTexView);
    const renderTargetView = usingPixel ? gridTexView : offscreenView;

    // Render: fade old trail + draw new particles
    const rp = enc.beginRenderPass({
        colorAttachments: [{
            view: renderTargetView, loadOp: 'load', storeOp: 'store',
        }],
    });
    rp.setPipeline(fadePipe);
    rp.setBindGroup(0, fadeBG);
    rp.draw(3);
    // Agent shadow is a soft splat — incoherent with chunky cells, skip in pixel mode.
    // Runs when an image is loaded (homing shadows) or champions are active (constant shadows).
    if ((hasImage || (params.championsEnabled && params.champions > 0)) && agentShadowBG && !usingPixel) {
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

    // (Pixel-grid mode now renders particles directly into gridTex above, so no
    // downsample pass is needed — gridTex already holds the chunky cell-aligned
    // image. The blit still reads it with a nearest sampler for the upscale.)

    // Blit offscreen (or gridTex when pixelGrid on) → canvas, then optional overlays
    const curTex = ctx.getCurrentTexture();
    const bp = enc.beginRenderPass({
        colorAttachments: [{
            view: curTex.createView(),
            loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
        }],
    });
    bp.setPipeline(blitPipe);
    bp.setBindGroup(0, params.pixelGrid && gridBlitBG ? gridBlitBG : blitBG);
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

    // Champion lines — LINE_STRIP overlay on the swap-chain texture
    if (params.championsEnabled && params.champions > 0) {
        const champCount = Math.floor(params.agentCount / params.champions);
        if (champCount >= 2) {
            const clAB = new ArrayBuffer(32);
            const clF  = new Float32Array(clAB);
            const clU  = new Uint32Array(clAB);
            clF[0] = canvas.width; clF[1] = canvas.height;
            clU[2] = params.agentCount; clU[3] = params.champions;
            clF[4] = params.champLinesAlpha;
            device.queue.writeBuffer(champLinesUB, 0, clAB);
            const lp = enc.beginRenderPass({
                colorAttachments: [{
                    view: curTex.createView(),
                    loadOp: 'load', storeOp: 'store',
                }],
            });
            lp.setPipeline(champLinesPipe);
            lp.setBindGroup(0, champLinesBG);
            lp.draw(champCount);
            lp.end();
        }
    }

    // Screenshot: copy the just-blitted swap-chain texture into a staging buffer
    // within the same encoder, then map and download asynchronously after submit.
    let captureBuf = null, captureW = 0, captureH = 0, capturePadded = 0;
    if (_captureRequested) {
        _captureRequested = false;
        captureW       = curTex.width;
        captureH       = curTex.height;
        capturePadded  = Math.ceil(captureW * 4 / 256) * 256;
        captureBuf     = device.createBuffer({
            size:  capturePadded * captureH,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        enc.copyTextureToBuffer(
            { texture: curTex },
            { buffer: captureBuf, bytesPerRow: capturePadded, rowsPerImage: captureH },
            [captureW, captureH, 1],
        );
    }

    // Narrator capture: same GPU readback but returns base64 JPEG without download.
    let narrateBuf = null, narrateW = 0, narrateH = 0, narratePadded = 0;
    if (_narrateCaptureRequested) {
        _narrateCaptureRequested = false;
        narrateW      = curTex.width;
        narrateH      = curTex.height;
        narratePadded = Math.ceil(narrateW * 4 / 256) * 256;
        narrateBuf    = device.createBuffer({
            size:  narratePadded * narrateH,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        enc.copyTextureToBuffer(
            { texture: curTex },
            { buffer: narrateBuf, bytesPerRow: narratePadded, rowsPerImage: narrateH },
            [narrateW, narrateH, 1],
        );
    }

    device.queue.submit([enc.finish()]);

    if (captureBuf) finalizeCapture(captureBuf, captureW, captureH, capturePadded);
    if (narrateBuf) finalizeNarrateCapture(narrateBuf, narrateW, narrateH, narratePadded, _narrateChaosVal);

    // Fireworks burst is one-shot — this frame's compute consumed it, so clear the
    // flags now and re-upload, leaving the scattered agents to fly out on their own.
    if (activeSlots.length) {
        let burstDirty = false;
        for (const slot of activeSlots) { if (slot.burst) { slot.burst = 0; burstDirty = true; } }
        if (burstDirty) uploadSpectatorSlots();
    }

    fpsFrames++;
}

// ── simAss image fetch — shared by harmony prefetch ──────────────────────────
async function _fetchIdleImageBytes() {
    const res = await fetch(`${_apiBase}/simAss-image`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}

// Harmony images are fetched on demand and cached in localStorage by note sum.

// ── simAss audio loader — chains tracks via Tone.js radio chain ──────────────
// Plays when users are connected. fadeIn=true on first track (user join).
let _idleAudioGen = 0;

async function loadIdleAudio(fadeIn = false) {
    const gen = ++_idleAudioGen;
    try {
        const res = await fetch(`${_apiBase}/simAss-audio`);
        if (!res.ok) { console.warn('[simAss-audio] HTTP', res.status); return; }
        if (gen !== _idleAudioGen) return;
        const buf = await res.arrayBuffer();
        console.log(`[simAss-audio] loaded ${buf.byteLength}B — playing${fadeIn ? ' (fade in)' : ''}`);
        await playIdleTrack(buf, () => {
            if (gen === _idleAudioGen) loadIdleAudio(false);
        }, fadeIn ? smoothChaos : null);
    } catch (e) {
        console.warn('[simAss-audio]', e);
    }
}

requestAnimationFrame(frame);
