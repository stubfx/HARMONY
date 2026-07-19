// ─── Solo — Formula-Driven Wind Particle System ───────────────────────────────
// Agents are independent particles moved by two mathematical fields:
//   dirFormula  — the heading each particle wants to follow
//   windFormula — a force field that pushes them off course
// A magnet image layer guides particles toward bright areas via image gradient.
// Particles overlapping the image region are coloured by the image itself.
// Speed drives brightness. A fading trail accumulates on an offscreen texture.

import { initGUI }      from './gui.js';
import { stopAudio, isActive, getVolume, playAudio, playAudioBg, unlockAudio, setDuckLevel, isAudioLocked, isAudioReady, onAudioStateChange } from './audio.js';
import QRCode           from 'qrcode';
import { io as ioConnect } from 'socket.io-client';
import soloSimTemplate  from './shaders/compute.wgsl?raw';
import soloRenderWGSL   from './shaders/render.wgsl?raw';
import fadeWGSL         from './shaders/fade.wgsl?raw';
import blitWGSL         from './shaders/blit.wgsl?raw';
import downsampleWGSL   from './shaders/downsample.wgsl?raw';
import windVisWGSL      from './shaders/wind-vis.wgsl?raw';
import colorPrepassWGSL from './shaders/colorPrepass.wgsl?raw';
import champLinesWGSL   from './shaders/champLines.wgsl?raw';
import golStepWGSL      from './shaders/gol-step.wgsl?raw';
import bloomWGSL        from './shaders/bloom.wgsl?raw';
import glareWGSL        from './shaders/glare.wgsl?raw';
import { startSynth, setSynthState, setSynthDroneOnly, setSynthBusVolume, setSynthEnergy, addArpInfluence, blinker, BLINKER_TYPES, playRiser, triggerImpact, resolveRiser, speakBinary, binaryCueDurationMs, isSpeaking, speakingRemainingMs, setShapePersonality, clearShapePersonality } from './synth.js';
import * as ambience from './ambience.js';
import { StoryEngine } from './storyEngine.js';
import { STORY }       from './story.js';
import { RESEED }      from './constants.js';

// ── Config ────────────────────────────────────────────────────────────────────
const MAX_AGENTS = 5_000_000;
// Game of Life grid width in cells (height derived from canvas aspect).
const GOL_W = 192;

// ── Tunable parameters (mutated by lil-gui) ───────────────────────────────────
const params = {
    // Agents
    agentCount:  2_000_000,
    autoScale:   false,      // adaptive quality: reduce renderScale then agentCount to hold 60 fps
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
    trailDecay:     0.02,
    trailEnabled:   true,  // false = no trail; buffer cleared each frame
    bgBlackCutoff:  0.05, // luminance below which trail pixels are clamped to 0 at display time
    pointSize:      3.5,
    color1:      '#ffffff',   // first palette colour
    color2:      '#ffffff',   // second palette colour (assigned by agent index % 2)
    idleColor:          '#ffffff',  // colour shown when no spectators connected
    idleColorFraction:  0,          // fraction of agents that take idleColor when idle
    brightness:  0.06,        // per-particle alpha; prevents additive saturation to white
    additiveBlend: true,      // true = additive (glow, accumulates); false = max blend (no over-brightness)
    blendAmount:   1.0,       // 0–1 multiplier on per-particle fragment output; lowers contribution in both blend modes
    toneBlack:   0.0,         // input level mapped to black (lifts lone-particle visibility)
    toneWhite:   1.0,         // input level mapped to white (HDR saturation point)
    toneGamma:   1.0,         // power curve: <1 boosts darks, >1 crushes darks
    shadowBoost: 0.0,         // inverse-brightness boost: peaks at ~12% luminance, negligible above 60%
    pixelGrid:      false,    // chunky low-res grid (downsample → nearest-sample blit) — final stage before canvas
    pixelGridCells: 700,      // cell count along the X axis; Y count is derived from canvas aspect ratio
    glareEnabled:    false,   // additive bloom/glare pass over the final blit
    glareIntensity:  0.15,    // composite strength (0 = off, 1 = full)
    glareThreshold:  0.6,     // luminance threshold — only pixels above this feed into the bloom
    // Text avoid-map placement (particles are repelled by the text glyphs)
    imageX:         0.5,  // text center X in screen-space 0–1
    imageY:         0.5,  // text center Y in screen-space 0–1
    // Text/QR avoid-map canvas resolution relative to main canvas (perf control)
    traceScale:   1.0,
    // QR placement
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
    // Champions — every Nth agent (agentId % champions == 0) renders larger and is
    // linked by the champion-lines overlay. 1 = every agent, 2 = one in two…
    championsEnabled:       true,  // master on/off for the whole champions feature
    champions:         1000,
    championSize:      15,   // point size for a champion agent
    champLinesAlpha:   0.02,
    // Game of Life mode — toggle
    golEnabled:      false,
    golStrength:     0.5,  // attraction of particles toward live cells
    golStepInterval: 4,    // frames between Game-of-Life generations (higher = slower)
    golSpark:        0.001, // random life injection per generation (0 = pure Conway; prevents freezing)
    // Avoidance
    avoidForceStr:        1.0,  // multiplier on avoidance-map deflection forces
    avoidMapScale:        1.0,  // avoidance map coverage as fraction of canvas (1.0 = full)
    avoidMapInvert:  false, // true = read the map as 1 - r, so light areas become non-avoid and dark areas become the avoid signal
    avoidMapSampleColor: true,  // true = particles take their base color from the avoid map sample at their position
    avoidMapFixedColor:  true,  // true (paired with sampleColor) = use the sampled pixel exactly
    avoidMapBlackCutoff: 0.05,  // luminance floor for the color sample: pixels below this are skipped (particle keeps base color)
    showAvoidMapImage: false, // debug: overlay avoidmap image on canvas
    qrOverlay:       false, // true = QR on a 2D overlay canvas; agents freed from QR area
    // Font — Google Fonts family used for the text avoid map, loaded at runtime
    // (nothing installed on the host machine). Empty string = system sans-serif.
    fontFamily:    'Bellefair',
    // Export ('s' screenshot) — both off by default
    exportTransparent: false, // make the black background transparent (alpha = brightness)
    exportCMYK:        false, // convert to CMYK and save as TIFF instead of PNG
    // DOT mode
    dotCenterRadius:     50,   // px — agents within this radius of centre are candidates for respawn (0 = disabled)
    dotRespawnChance:    0.01, // per-frame probability that a centre-zone agent is respawned to an edge
    spawnFadeRate:       1.0,   // per-second weight increment after respawn (0 = stay dark, 1.0 = ~1s to full)
    limitAtCenter:       false, // if true: agents outside limitAtCenterRadius are raw-teleported to canvas centre
    limitAtCenterRadius: 300,   // radius in canvas pixels for limitAtCenter
    // Freeroam lock — when on, FREEROAM auto-reverts to NORMAL after a delay
    freeroamLock:        true,
    freeroamLockDelay:   30,   // seconds in FREEROAM before reverting to NORMAL (timer resets each time FREEROAM is re-entered)
    // Spectator partitioning
    spectatorAgentShare:       80,   // % of agents assigned to spectators (0 = sim only, 100 = full user control)
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
    voteDuration:      30,   // seconds the vote panel stays open before the sim fires the result
    chladniBlend:      0.15, // 0–1 blend weight of the note-driven Chladni perturbation
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
// ?s=<uuid>        — pin the sim to a specific session room (survives reloads via URL)
// ?n=<n>           — override the starting agent count (still adjustable in the GUI)
// ?pixelGrid=true  — start with the chunky low-res pixel-grid mode enabled
// ?r=<0-1>         — initial render scale (clamped to 0.1–1.0)
// ?b=<n>           — per-particle brightness/alpha (e.g. 0.01, 0.06, 1.4)
// ?autoscale=true  — enable adaptive quality (reduces renderScale / agentCount to hold 60 fps)
// ?hideGUI=true    — hard-disable the HUD/GUI (toggle key inert; stays hidden regardless of ?gui)
const _urlParams     = new URLSearchParams(location.search);
const _forcedSession = _urlParams.get('s') || null;
{
    const v = _urlParams.get('pixelGrid');
    if (v === 'true' || v === '1') params.pixelGrid = true;
}
{
    const n = parseInt(_urlParams.get('n') ?? '', 10);
    if (Number.isFinite(n) && n > 0)
        params.agentCount = Math.max(1_000, Math.min(MAX_AGENTS, n));
}
{
    // resolution: initial render scale, 0–1 (clamped to the slider's 0.1–1.0 range).
    const r = parseFloat(_urlParams.get('r') ?? '');
    if (Number.isFinite(r)) params.renderScale = Math.max(0.1, Math.min(1.0, r));
}
{
    // brightness: per-particle alpha (e.g. 0.01, 0.06, 1.4).
    const b = parseFloat(_urlParams.get('b') ?? '');
    if (Number.isFinite(b) && b > 0) params.brightness = b;
}
{
    const v = _urlParams.get('autoscale');
    if (v === 'true' || v === '1') params.autoScale = true;
}
const _savedPhase = parseInt(_urlParams.get('phase') ?? '', 10); // 1–9 or NaN

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
    'sin(x * 0.009 + sin(y * 0.006 + t)) * TWO_PI',
    'sin((x + y) * 0.005 + t * 0.3) * TWO_PI',
    'sin(y * 0.007 + t * 0.25) * PI',
    'atan2(y-cy,x-cx) + cos(length(vec2(x-cx,y-cy)) * 0.008 - t * 0.8) * PI',
    'atan2(y - cy, x - cx) + sin(t * 1.2) * PI * 0.5',
    'sin(x * 0.005 + sin(y * 0.007 + t * 0.3) * 2.0) * TWO_PI',
    'sin(x * 0.008) * cos(y * 0.008) * PI + t * 0.15',
    'atan2(y-cy,x-cx) + length(vec2(x-cx,y-cy)) * 0.003 + t * 0.5',
    'sin(x * 0.004 + cos(y * 0.006 + t * 0.3) * 3.0) * TWO_PI',
    'sin(x * 0.004 + t * 0.2) * cos(y * 0.004 - t * 0.15) * TWO_PI',
    'sin(length(vec2(x-cx,y-cy)) * 0.015 - t * 2.5) * TWO_PI',
    'atan2(y - cy, x - cx) * 2.0 + t * 0.2',
    'sin(x * 0.003 + y * 0.002 + t * 0.15) * TWO_PI',
    // sinusoidal — varie direzioni
    'sin(y * 0.010 + t * 0.5) * TWO_PI',
    'sin((x - y) * 0.006 + t * 0.3) * TWO_PI',
    'sin((x + y) * 0.007 - t * 0.4) * TWO_PI',
    'sin(x * 0.005 + t * 0.3) * PI + sin(y * 0.007 - t * 0.25) * PI',
    'sin(x * cos(t * 0.15) * 0.006 + y * sin(t * 0.15) * 0.006) * TWO_PI',
    'sin(x * 0.004 - t * 0.3) * PI + cos(y * 0.006 + t * 0.2) * PI',
    'sin(x * 0.003 + t * 0.1) * TWO_PI',
    'cos(x * 0.005 - y * 0.003 + t * 0.35) * TWO_PI',
    'sin(x * 0.007 + t * 0.45) * PI + sin(y * 0.005 + t * 0.3) * PI',
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

// Per-spectator direction bank — one distinct flow field per note index (0–8),
// so each spectator's note picks the movement of their share of the dots. This
// is compiled once into a switch in the shader; changing which index a spectator
// uses is just a buffer write (no recompile). Keep length aligned with KEYS (9).
const SPECTATOR_DIR_FORMULAS = [
    'sin(x * 0.006) * cos(y * 0.006) * TWO_PI',                              // 0 — cells
    'sin(x * 0.006) * PI',                                                   // 1 — vertical lines
    'sin(y * 0.006) * PI',                                                   // 2 — horizontal lines
    'atan2(y - cy, x - cx) + t * 0.3',                                       // 3 — spiral CW
    'atan2(y - cy, x - cx) - t * 0.4',                                       // 4 — spiral CCW
    'sin((x + y) * 0.005) * TWO_PI',                                         // 5 — diagonal bands
    'sin(x * 0.009 + sin(y * 0.006 + t)) * TWO_PI',                          // 6 — turbulence
    'sin(length(vec2(x-cx,y-cy)) * 0.015 - t * 2.5) * TWO_PI',              // 7 — radial waves
    'atan2(y-cy,x-cx) + sin(length(vec2(x-cx,y-cy))*0.012 - t*1.5)*PI',     // 8 — radial pulse
];

// 20 wind formulas cycled automatically when params.autoWind is true.
// Variables: x, y, t, cx, cy, PI, TWO_PI
const WIND_FORMULAS = [
    'sin(x * 0.004 - y * 0.003 + t * 0.4) * TWO_PI',
    'sin(y * 0.005 + t * 0.5) * PI',
    'cos(x * 0.005 + t * 0.3) * PI',
    'sin((x + y) * 0.004 + t * 0.3) * TWO_PI',
    'sin((x - y) * 0.004 - t * 0.3) * TWO_PI',
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

// Avoidmap debug overlay: semi-transparent 2D canvas showing the active avoidmap.
const _avoidMapOverlayEl = document.createElement('canvas');
_avoidMapOverlayEl.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:11;opacity:0;';
document.body.appendChild(_avoidMapOverlayEl);
let _avoidMapBitmap = null;

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

// ── WebGPU init ───────────────────────────────────────────────────────────────
if (!navigator.gpu) { showError('WebGPU not supported in this browser.'); throw new Error(); }

// requestAdapter() can return null right after a GPU device loss while the driver
// is recovering (Windows TDR, power-management reset, etc.). Retry with backoff
// rather than hard-failing — the adapter always comes back within a few seconds.
let adapter = null;
for (let attempt = 0; attempt < 10 && !adapter; attempt++) {
    if (attempt > 0) {
        showError(`GPU adapter unavailable — reconnecting… (attempt ${attempt}/9)`);
        await new Promise(r => setTimeout(r, 3000));
    }
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
}
if (!adapter) { location.reload(); throw new Error(); }
hideError();
const device = await adapter.requestDevice({
    requiredLimits: {
        maxStorageBufferBindingSize:      adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize:                    adapter.limits.maxBufferSize,
        maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
    },
});
// One-time report of the true device ceilings — the real agent cap on this GPU is
// derived from these, not the WebGPU spec defaults (65535 wg/dim, 128 MiB buffer).
console.log('[WebGPU limits]', {
    maxStorageBufferBindingSize:      adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize:                    adapter.limits.maxBufferSize,
    maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
    maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
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
    // Wait 10 s before reloading — Windows TDR / driver recovery typically takes
    // 5–10 s; reloading too early means requestAdapter() returns null again.
    showError('GPU lost — reconnecting…');
    setTimeout(() => location.reload(), 10_000);
});

// Proactive reload every hour to prevent Vulkan semaphore FD exhaustion
// (vkGetSemaphoreFdKHR fails after thousands of queue.submit() calls).
// A bare location.reload() is NOT enough: the leaked FDs live in Chrome's
// shared GPU process, which survives a page reload. Explicitly destroying the
// device tears down every buffer/texture it owns and gives Dawn a deterministic
// chance to release the FDs before we reload.
// Deferred until the room is empty so a live show is never interrupted.
function hardReset() {
    deviceLost = true;                      // stop the RAF loop from issuing more GPU work
    try { ctx.unconfigure(); } catch {}
    try { device.destroy(); } catch {}
    // Let the GPU process actually reclaim the resources before tearing down the page.
    setTimeout(() => location.reload(), 500);
}
(function scheduleHardReset() {
    setTimeout(() => {
        function reloadWhenIdle() {
            if (activeSlots.length === 0) { hardReset(); return; }
            setTimeout(reloadWhenIdle, 60_000);
        }
        reloadWhenIdle();
    }, 3600 * 1000);
})();

const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
const ctx = canvas.getContext('webgpu');
ctx.configure({
    device, format: canvasFormat, alphaMode: 'opaque',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
});

// ── Persistent GPU buffers ────────────────────────────────────────────────────
const agentBuf = device.createBuffer({
    // 16 bytes/agent: [pos.x f32, pos.y f32, vel u32 (pack2x16float), wp u32 (weight+primed)]
    size: MAX_AGENTS * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
// One packed rgba8unorm u32 per agent — written by colorPrepass, read by render vertex shader.
const colorBuf = device.createBuffer({
    size: MAX_AGENTS * 4,
    usage: GPUBufferUsage.STORAGE,
});
const soloUB = device.createBuffer({
    size: 240, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const renderUB = device.createBuffer({
    size: 208, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
// Game of Life step uniform: seed, spark, pad, pad (16 bytes)
const golUB = device.createBuffer({
    size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
// ContamParams: 16-byte header + 10 × vec4<f32> (16 bytes each) = 176 bytes
const contamUB = device.createBuffer({
    size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
// SpectatorSlots: 16 slots × 44 bytes (11 × f32/u32 per slot) = 704 bytes
const spectatorSlotsBuf = device.createBuffer({
    size: 704, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

// Pack two f32 values as IEEE-754 binary16 halves into one u32 (low 16 = x, high 16 = y),
// matching WGSL pack2x16float. setFloat16 gives spec-correct round-to-nearest-even; the sim
// already hard-requires WebGPU, which implies a browser new enough to have it (Chrome ≥129).
const _halfDV = new DataView(new ArrayBuffer(4));
function packHalf2(x, y) {
    _halfDV.setFloat16(0, x, true);
    _halfDV.setFloat16(2, y, true);
    return _halfDV.getUint32(0, true);
}

function seedAgents({ mode = RESEED.NORMAL } = {}) {
    const fadeInPhase2 = mode === RESEED.FADE_FROM_EDGES;
    const count = params.agentCount;
    const buf   = new ArrayBuffer(count * 16);   // [pos.x f32, pos.y f32, vel u32, wp u32]
    const f32   = new Float32Array(buf);
    const u32   = new Uint32Array(buf);
    const TAU   = Math.PI * 2;

    const perim = 2 * (canvas.width + canvas.height);

    for (let i = 0; i < count; i++) {
        const w  = i * 4;
        const a  = Math.random() * TAU;
        const s  = 0.5 + Math.random() * 1.5;

        // fadeInPhase2: place on canvas perimeter at weight=0 so spawnFadeRate fades them in.
        // Normal: random interior position at full weight.
        let sx, sy;
        if (fadeInPhase2) {
            const t = Math.random() * perim;
            if      (t < canvas.width)                          { sx = t;                              sy = 0; }
            else if (t < canvas.width + canvas.height)          { sx = canvas.width;                   sy = t - canvas.width; }
            else if (t < 2 * canvas.width + canvas.height)      { sx = t - canvas.width - canvas.height; sy = canvas.height; }
            else                                                 { sx = 0;                              sy = t - 2 * canvas.width - canvas.height; }
        } else {
            sx = Math.random() * canvas.width;
            sy = Math.random() * canvas.height;
        }

        const weight = fadeInPhase2 ? 0.0 : Math.max(0.05, 1.0 + (Math.random() * 2 - 1) * params.weightSpread);
        f32[w]     = sx;
        f32[w + 1] = sy;
        u32[w + 2] = packHalf2(Math.cos(a) * s, Math.sin(a) * s);   // vel
        u32[w + 3] = packHalf2(weight, 0.0);                        // weight + primed
    }
    device.queue.writeBuffer(agentBuf, 0, buf);
}
seedAgents({ mode: RESEED.FADE_FROM_EDGES });

// Raw teleport: move `fraction` of agents to (x, y) with random velocities.
// No fade — agents keep full weight and appear instantly at the target.
function _rawTeleport(x, y, fraction = 0.1) {
    const count     = params.agentCount;
    const chunkSize = Math.max(1, Math.ceil(count * fraction));
    const start     = Math.floor(Math.random() * (count - chunkSize));
    const TAU       = Math.PI * 2;
    const buf = new ArrayBuffer(chunkSize * 16);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    for (let i = 0; i < chunkSize; i++) {
        const w = i * 4;
        const a = Math.random() * TAU;
        const s = 0.5 + Math.random() * 1.5;
        f32[w]     = x;
        f32[w + 1] = y;
        u32[w + 2] = packHalf2(Math.cos(a) * s, Math.sin(a) * s);
        u32[w + 3] = packHalf2(1.0, 0.0);   // weight — full, no fade
    }
    device.queue.writeBuffer(agentBuf, start * 16, buf);
}

// ── Story facade & engine ────────────────────────────────────────────────────
// sim.js exposes low-level primitives. Story steps (story.js) compose them.

const simFacade = {
    // Seed all agents dormant (weight=0), storing original weights for later restore.
    dormantSeed() {
        _preshowActive   = true;
        _preshowLitCount = 0;
        const count  = params.agentCount;
        const buf = new ArrayBuffer(count * 16);
        const f32 = new Float32Array(buf);
        const u32 = new Uint32Array(buf);
        const TAU    = Math.PI * 2;
        _preshowWeights = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const w = i * 4;
            const a = Math.random() * TAU;
            const s = 0.5 + Math.random() * 1.5;
            f32[w]     = Math.random() * canvas.width;
            f32[w + 1] = Math.random() * canvas.height;
            u32[w + 2] = packHalf2(Math.cos(a) * s, Math.sin(a) * s);
            _preshowWeights[i] = Math.max(0.05, 1.0 + (Math.random() * 2 - 1) * params.weightSpread);
            u32[w + 3] = packHalf2(0.0, 0.0);   // weight = 0 → invisible
        }
        device.queue.writeBuffer(agentBuf, 0, buf);
    },

    // Activate the next `fraction` of dormant agents, spawning from canvas center.
    activateChunk(fraction = 0.10) {
        if (!_preshowActive || !_preshowWeights) return;
        const total     = params.agentCount;
        const start     = _preshowLitCount;
        const end       = Math.min(start + Math.ceil(total * fraction), total);
        if (start >= total) return;
        const cx  = canvas.width  / 2;
        const cy  = canvas.height / 2;
        const TAU = Math.PI * 2;
        const buf = new ArrayBuffer((end - start) * 16);
        const f32 = new Float32Array(buf);
        const u32 = new Uint32Array(buf);
        const burstSpeed = params.releaseBurstSpeed || 30;
        for (let i = 0; i < end - start; i++) {
            const w = i * 4;
            const angle = Math.random() * TAU;
            const va    = Math.random() * TAU;
            f32[w]     = cx + Math.cos(angle) * (Math.random() * 8);
            f32[w + 1] = cy + Math.sin(angle) * (Math.random() * 8);
            u32[w + 2] = packHalf2(Math.cos(va) * burstSpeed, Math.sin(va) * burstSpeed);
            u32[w + 3] = packHalf2(_preshowWeights[start + i], 0.0);
        }
        device.queue.writeBuffer(agentBuf, start * 16, buf);
        _preshowLitCount = end;
    },

    // Save current values of the given params and apply overrides immediately.
    freezeParams(overrides) {
        _preshowSavedParams = {};
        for (const [key, val] of Object.entries(overrides)) {
            _preshowSavedParams[key] = params[key];
            params[key] = val;
        }
    },

    // Restore params saved by freezeParams().
    thawParams() {
        if (!_preshowSavedParams) return;
        for (const [key, val] of Object.entries(_preshowSavedParams)) params[key] = val;
        _preshowSavedParams = null;
    },

    // Clear preshow state and do a full reseed.
    // Pass { mode: RESEED.FADE_FROM_EDGES } to place all agents on the canvas perimeter
    // at weight=0 so spawnFadeRate fades them in gradually instead of a snap to full.
    reseed({ mode = RESEED.NORMAL } = {}) {
        _preshowActive   = false;
        _preshowLitCount = 0;
        _preshowWeights  = null;
        seedAgents({ mode });
    },

    next: () => storyEngine.next(),

    setParam(key, val) { params[key] = val; },
    setStatus(s) { setStatus(s); },
    setColorMode(mode) {
        simState.colorMode = mode;
        if (mode === 'NORMAL') {
            _targetColorBlend = 1.0;
        } else {
            _targetColorBlend = 0.0;
            smoothColorBlend  = 0.0;
        }
        updateStateDisplay();
        colorModeCtrl?.updateDisplay();
    },

    suppressImages()  { _avoidMapSuppressed = true;  },
    restoreImages()   { _avoidMapSuppressed = false; },

    enableHarmonyImages()  {
        _harmonyImagesEnabled = true;
        if (_harmonyActive) _loadCurrentHarmonyImage();
    },
    disableHarmonyImages() {
        _harmonyImagesEnabled = false;
        _harmonyHeld = false;
        clearTimeout(_harmonyHoldTimer);
        if (_harmonyActive) clearAvoidMap();
    },

    // When set, _exitHarmony() loads this static image instead of clearing the
    // avoidmap — keeps e.g. the AANT logo visible whenever no harmony image is shown.
    setHarmonyFallback(filename) { _harmonyFallback = filename; },
    clearHarmonyFallback()       { _harmonyFallback = null; },
    // Register a callback that fires whenever a harmony riser starts, so external
    // phases (e.g. PHASE 9) can reset their own riser timers to avoid overlaps.
    setHarmonyRiserResetCallback(fn) { _harmonyRiserResetFn = fn; },

    setTraceText(text) {
        const input = document.querySelector('#trace-text-input');
        if (input) { input.value = text; renderTextAvoidMap(); }
    },

    loadStaticAvoidMap(filename) {
        loadAvoidMap(`${_apiBase}/simAss-static/${filename}`);
        setShapePersonality(filename.replace(/\.[^.]+$/, '')); // key = filename without extension
    },
    clearAvoidMap() { clearAvoidMap(); clearShapePersonality(); },

    // Set direction and wind formulas (WGSL expressions). Fire-and-forget async.
    setFormulas(dir, wind) { applyFormulas(dir, wind); },

    // Unlock noise/pad/arp — call when the story is ready for the full synth.
    enableFullSynth() { setSynthDroneOnly(false); },

    // Start the ambience music and the synth together.
    // Safe to call multiple times — no-op if already started.
    startBackgroundMusic() {
        ambience.start();
        startSynth().then(() => setSynthState(smoothCoherence, 0, 0, smoothTemp));
    },

    // Generative "drop" — the PHASE 3 red reveal build-up and impact.
    // playRiser starts the build; triggerImpact resolves it and adds a visual punch.
    // resolveRiser() is the lighter resolution for PHASE 9 and harmony risers.
    //
    // WARNING — playRiser calls `await rev.ready` (Tone.Reverb IR generation) which
    // can block the compositor for tens of milliseconds on the audio thread. This was
    // the root cause of a visible frame freeze that was incorrectly attributed to the
    // harmony image decode/upload. Image decode is now done via _predecodeBitmap
    // (see _enterHarmony) but the riser before harmony images was removed entirely
    // because the Reverb IR spike was the actual culprit. Do NOT reinstate a playRiser
    // call immediately before a loadAvoidMap call — the IR stall lands at reveal time.
    playRiser(durationMs, variant) { playRiser(durationMs, variant); },
    resolveRiser() { resolveRiser(); },
    triggerImpact() {
        triggerImpact();
        burstBrightness = BURST_BRIGHTNESS;
        ambience.burstBlinkers(6, 90);
    },
    // Set the synth energy level (0 = calm bed, 1 = post-drop). Used to reset the
    // energetic body back to calm when the show restarts.
    setSynthEnergy(e, rampSec) { setSynthEnergy(e, rampSec); },

    // The simulation "speaks" its phase number as a short binary tone sequence,
    // replacing recorded narration in the later phases.
    speakPhase(n) { console.log('[audio] speakBinary n=%d dur=%dms', n, binaryCueDurationMs(n)); speakBinary(n); },

    startBlinkersLoop() {
        ambience.startBlinkersLoop(() => {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            _rawTeleport(x, y, 0.1);
        });
    },
    stopBlinkersLoop()  { ambience.stopBlinkersLoop();  },
    burstBlinkers(count, intervalMs) { ambience.burstBlinkers(count, intervalMs); },

    // Play a narrator audio file from simAss/narrator/.
    // Pass { autoNext: true } to advance to the next step when playback ends.
    // Returns the Audio element so the caller can pause it on exit if needed.
    playNarratorAudio(filename, { autoNext = false } = {}) {
        const DUCK_DB = -10; // duck the generative bed (synth + ambience) under narration
        const audio = new Audio(`${_apiBase}/simAss-narrator/${filename}`);
        const restoreBed = () => { setSynthBusVolume(0); ambience.setVolume(0); };
        const onEnd = () => { restoreBed(); if (autoNext) storyEngine.next(); };
        audio.addEventListener('play', () => {
            setSynthBusVolume(DUCK_DB);
            ambience.setVolume(DUCK_DB);
        }, { once: true });
        audio.addEventListener('ended', onEnd, { once: true });
        audio.addEventListener('error', (e) => {
            console.warn(`[narrator] failed to load "${filename}" — skipping.`, e);
            // Treat a missing/broken file as an instant end: dispatch 'ended' so both the
            // bed restore above and any caller 'ended' logic (e.g. PHASE 3's build→drop) run.
            audio.dispatchEvent(new Event('ended'));
        }, { once: true });
        audio.play().catch(e => console.warn('[narrator] play() rejected:', e));
        return audio;
    },
};
const storyEngine = new StoryEngine(STORY, simFacade);
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
// Additive-mode fade: pure multiplicative scale — src zeroed out, dst scaled by (1-alpha).
// Avoids injecting black into the HDR accumulation buffer.
const fadePipeAdditive = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: fadeMod, entryPoint: 'vs' },
    fragment: {
        module: fadeMod, entryPoint: 'fs',
        targets: [{
            format: 'rgba16float',
            blend: {
                color: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
        }],
    },
    primitive: { topology: 'triangle-list' },
});
const fadeBG = device.createBindGroup({
    layout: fadePipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: fadeUB } }],
});
const fadeBGAdditive = device.createBindGroup({
    layout: fadePipeAdditive.getBindGroupLayout(0),
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

// Color prepass — computes per-agent color once per frame; render vertex shader reads colorBuf.
const colorPrepassMod  = device.createShaderModule({ code: colorPrepassWGSL });
const colorPrepassPipe = device.createComputePipeline({
    layout: 'auto',
    compute: { module: colorPrepassMod, entryPoint: 'main' },
});
let colorPrepassBG = null;

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

// Bloom + glare: threshold → downsample → blur H → blur V → additive composite onto swap-chain.
const bloomMod            = device.createShaderModule({ code: bloomWGSL });
const bloomDownsamplePipe = device.createComputePipeline({
    layout: 'auto',
    compute: { module: bloomMod, entryPoint: 'downsample' },
});
const bloomBlurPipe = device.createComputePipeline({
    layout: 'auto',
    compute: { module: bloomMod, entryPoint: 'blur' },
});
const glareMod  = device.createShaderModule({ code: glareWGSL });
const glarePipe = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: glareMod, entryPoint: 'vs' },
    fragment: {
        module: glareMod, entryPoint: 'fs',
        targets: [{
            format: canvasFormat,
            blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'one',        dstFactor: 'one', operation: 'add' },
            },
        }],
    },
    primitive: { topology: 'triangle-list' },
});
// bloomUB: BloomParams (32 bytes); glareUB: BloomCompositeParams (16 bytes)
const bloomUB = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const glareUB = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const _bloomAB = new ArrayBuffer(32); const _bloomU32 = new Uint32Array(_bloomAB); const _bloomF32 = new Float32Array(_bloomAB);
const _glareAB = new ArrayBuffer(16); const _glareF32 = new Float32Array(_glareAB);
let bloomTexA = null, bloomTexB = null;
let bloomDownsampleBG = null, bloomBlurHBG = null, bloomBlurVBG = null, glareBG = null;

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


// ── Offscreen texture (rebuilt on resize) ─────────────────────────────────────
let offscreenTex       = null;
let offscreenView      = null;
let blitBG             = null;
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

    rebuildBloomTex();
    // Grid resources depend on offscreenView, so rebuild them whenever offscreen changes.
    rebuildGridTex();
}
rebuildOffscreen();

function rebuildBloomTex() {
    if (bloomTexA) bloomTexA.destroy();
    if (bloomTexB) bloomTexB.destroy();
    const bw = Math.max(1, Math.ceil(canvas.width  / 2));
    const bh = Math.max(1, Math.ceil(canvas.height / 2));
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
    bloomTexA = device.createTexture({ size: [bw, bh], format: 'rgba8unorm', usage });
    bloomTexB = device.createTexture({ size: [bw, bh], format: 'rgba8unorm', usage });
    bloomDownsampleBG = device.createBindGroup({
        layout: bloomDownsamplePipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: bloomUB } },
            { binding: 1, resource: screenSmp },
            { binding: 2, resource: offscreenView },
            { binding: 3, resource: bloomTexA.createView() },
        ],
    });
    bloomBlurHBG = device.createBindGroup({
        layout: bloomBlurPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: bloomUB } },
            { binding: 1, resource: screenSmp },
            { binding: 2, resource: bloomTexA.createView() },
            { binding: 3, resource: bloomTexB.createView() },
        ],
    });
    bloomBlurVBG = device.createBindGroup({
        layout: bloomBlurPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: bloomUB } },
            { binding: 1, resource: screenSmp },
            { binding: 2, resource: bloomTexB.createView() },
            { binding: 3, resource: bloomTexA.createView() },
        ],
    });
    glareBG = device.createBindGroup({
        layout: glarePipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: glareUB } },
            { binding: 1, resource: screenSmp },
            { binding: 2, resource: bloomTexA.createView() },
        ],
    });
}

// Full resolution-change rebuild: recreate every canvas-sized resource AND every
// bind group that samples those textures. rebuildOffscreen alone rebuilds only a
// subset (blit/grid/gol step) — simBG still references the recreated shadow-density
// and GoL textures (bindings 5 and 7), so it must be rebuilt too or the next submit
// uses a destroyed texture. Used on resize and on every renderScale change.
function applyResize({ skipSeed = false } = {}) {
    setSize();
    rebuildOffscreen();
    rebuildSimBG();
    updateQROverlay();
    if (skipSeed) return;
    if (_preshowActive) {
        const prevLit = _preshowLitCount;
        simFacade.dormantSeed();
        if (prevLit > 0) simFacade.activateChunk(prevLit / params.agentCount);
    } else {
        seedAgents();
    }
}
window.addEventListener('resize', applyResize);

// ── Animated image state ──────────────────────────────────────────────────────
let avoidGifFrames    = null;  // avoidance-map GIF frames
let avoidGifDurations = null;
let avoidGifFrameIdx  = 0;
let avoidGifNextFrameAt = 0;

// Rebuilds particle render bind group — called after pipeline creation and on
// avoid-map change (the color prepass reads the avoid map for per-particle color).
function rebuildRenderBG() {
    const entries = [
        { binding: 0, resource: { buffer: renderUB } },
        { binding: 1, resource: { buffer: agentBuf } },
        { binding: 4, resource: { buffer: colorBuf } },
    ];
    renderBG       = device.createBindGroup({ layout: renderPipe.getBindGroupLayout(0),       entries });
    renderBGNormal = device.createBindGroup({ layout: renderPipeNormal.getBindGroupLayout(0), entries });
    rebuildColorPrepassBG();
}

function rebuildColorPrepassBG() {
    const avoidView = (hasAvoidMap && avoidMapTexView) ? avoidMapTexView : placeholderTexView;
    colorPrepassBG = device.createBindGroup({
        layout: colorPrepassPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: renderUB } },
            { binding: 1, resource: { buffer: agentBuf } },
            { binding: 2, resource: { buffer: spectatorSlotsBuf } },
            { binding: 3, resource: avoidView },
            { binding: 4, resource: { buffer: colorBuf } },
        ],
    });
}
rebuildRenderBG();

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
let _textOwnedAvoidMap = false; // true when the current avoid map was rendered from the text input
let _currentAvoidMapSrc = null; // URL of the currently-loaded avoid map (null for Blob/dynamic), used to dedup reloads
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
    if (!parsed) { params.fontFamily = ''; renderTextAvoidMap(); return; }
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
    renderTextAvoidMap();
}

// ── Text avoid map ────────────────────────────────────────────────────────────
// Renders the trace text input as white glyphs on black directly into avoidMapTex
// so agents are repelled by the text shape. No homing involved.
let _textAvoidCanvas = null;

function renderTextAvoidMap() {
    if (!device) return;
    const text = document.querySelector('#trace-text-input')?.value.trim() ?? '';

    // No text — teardown inline (no clearAvoidMap call to avoid cycles)
    if (!text) {
        if (_textOwnedAvoidMap) {
            _textOwnedAvoidMap = false;
            clearAvoidGif();
            if (avoidMapTex) { avoidMapTex.destroy(); avoidMapTex = null; }
            avoidMapTexView = null;
            hasAvoidMap     = false;
            rebuildSimBG();
            rebuildRenderBG();
        }
        return;
    }

    const MAX_DIM = device.limits.maxTextureDimension2D;
    const w = Math.min(Math.max(1, Math.round(canvas.width  * params.traceScale)), MAX_DIM);
    const h = Math.min(Math.max(1, Math.round(canvas.height * params.traceScale)), MAX_DIM);
    const fontStack = params.fontFamily ? `"${params.fontFamily}", sans-serif` : 'sans-serif';

    if (!_textAvoidCanvas) _textAvoidCanvas = document.createElement('canvas');
    _textAvoidCanvas.width  = w;
    _textAvoidCanvas.height = h;
    const ctx = _textAvoidCanvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle    = 'white';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    const cx = params.imageX * w;
    const cy = params.imageY * h;

    // Layout is computed in full-canvas space, then scaled to the avoidmap canvas.
    const scale   = w / canvas.width;
    const maxW    = canvas.width * 0.75 * scale; // 75% of full screen, scaled to avoidmap px

    // Pass 1: word-wrap at an initial font size to determine line breaks
    const initFontSize = Math.round(Math.min(canvas.width, canvas.height) * 0.10 * scale);
    ctx.font = `bold ${initFontSize}px ${fontStack}`;
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const word of words) {
        const test = cur ? `${cur} ${word}` : word;
        if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = word; }
        else cur = test;
    }
    if (cur) lines.push(cur);

    // Pass 2: fit font so the longest line fills exactly maxW
    const longestMeasured = Math.max(...lines.map(l => ctx.measureText(l).width));
    const fontSize = longestMeasured > 0
        ? Math.floor(initFontSize * maxW / longestMeasured)
        : initFontSize;
    ctx.font = `bold ${fontSize}px ${fontStack}`;

    // Pass 3: re-wrap at fitted font size (longer font → fewer words per line)
    const lines2 = [];
    let cur2 = '';
    for (const word of words) {
        const test = cur2 ? `${cur2} ${word}` : word;
        if (ctx.measureText(test).width > maxW && cur2) { lines2.push(cur2); cur2 = word; }
        else cur2 = test;
    }
    if (cur2) lines2.push(cur2);

    const lineH  = Math.round(fontSize * 1.35);
    const startY = cy - ((lines2.length - 1) * lineH) / 2;
    lines2.forEach((ln, i) => ctx.fillText(ln, cx, startY + i * lineH));

    // Upload to avoidMapTex
    clearAvoidGif();
    if (avoidMapTex) avoidMapTex.destroy();
    avoidMapTex = device.createTexture({
        size:   [w, h],
        format: 'rgba8unorm',
        usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: _textAvoidCanvas }, { texture: avoidMapTex }, [w, h]);
    avoidMapTexView    = avoidMapTex.createView();
    hasAvoidMap        = true;
    _qrOwnedAvoidMap   = false;
    _textOwnedAvoidMap = true;
    rebuildSimBG();
    rebuildRenderBG();
}

// ── Auto-clear timer ──────────────────────────────────────────────────────────
// Started whenever user-added content (image or text) appears in the trace layer.

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

const AVOID_MAP_MAX_PX = 1024;

async function _capBitmap(bmp) {
    const longest = Math.max(bmp.width, bmp.height);
    if (longest <= AVOID_MAP_MAX_PX) return bmp;
    const scale = AVOID_MAP_MAX_PX / longest;
    const resized = await createImageBitmap(bmp, {
        resizeWidth:   Math.round(bmp.width  * scale),
        resizeHeight:  Math.round(bmp.height * scale),
        resizeQuality: 'medium',
    });
    bmp.close();
    return resized;
}

// Decode blob → { frames: ImageBitmap[], durations: number[]|null }.
// Handles SVG, animated GIF, and static images. Applies _capBitmap to
// every frame so the result is always upload-ready at a bounded size.
async function _predecodeBitmap(blob) {
    const isSvg = blob.type === 'image/svg+xml' || blob.name?.toLowerCase().endsWith('.svg');
    if (isSvg) {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        URL.revokeObjectURL(url);
        const cw = canvas.width, ch = canvas.height;
        const offscreen = new OffscreenCanvas(cw, ch);
        const ctx2 = offscreen.getContext('2d');
        ctx2.fillStyle = '#000000';
        ctx2.fillRect(0, 0, cw, ch);
        const imgW = img.naturalWidth  || cw;
        const imgH = img.naturalHeight || ch;
        const scale = Math.min(cw / imgW, ch / imgH);
        const dw = imgW * scale, dh = imgH * scale;
        ctx2.filter = 'invert(1)';
        ctx2.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        ctx2.filter = 'none';
        const bmp = await createImageBitmap(offscreen);
        return { frames: [await _capBitmap(bmp)], durations: null };
    }
    const anim = await decodeAnimatedImage(blob);
    if (anim) {
        const frames = [];
        for (const f of anim.frames) frames.push(await _capBitmap(f));
        return { frames, durations: anim.durations };
    }
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    return { frames: [await _capBitmap(bmp)], durations: null };
}

function clearAvoidGif() {
    if (avoidGifFrames) avoidGifFrames.forEach(b => b.close());
    avoidGifFrames = null; avoidGifDurations = null; avoidGifFrameIdx = 0; avoidGifNextFrameAt = 0;
}

function clearTraceText() {
    const input = document.querySelector('#trace-text-input');
    if (input) input.value = '';
    renderTextAvoidMap();
}

// Restore the session QR as the active display.
// Called when all spectators leave or the inactivity timeout fires.
// No-op if QR is already showing or hasn't been generated yet.
function restoreQR() {
    if (simState.qrStatus === 'SHOW' || !qrBitmap) return;
    const input = document.querySelector('#trace-text-input');
    if (input) input.value = '';
    renderTextAvoidMap(); // clears text-owned avoidmap since input is now empty
    simState.qrStatus = 'SHOW';
    updateStateDisplay();
    updateQROverlay();
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
    const avoidMapView      = (hasAvoidMap && avoidMapTexView) ? avoidMapTexView : placeholderTexView;
    simBG = device.createBindGroup({
        layout: simPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: soloUB } },
            { binding: 1, resource: { buffer: agentBuf } },
            { binding: 3, resource: { buffer: contamUB } },
            { binding: 4, resource: avoidMapView },
            { binding: 6, resource: { buffer: spectatorSlotsBuf } },
            { binding: 7, resource: golStateView ?? placeholderTexView },
        ],
    });
}

async function buildSimPipeline(dir, wind) {
    // Per-spectator direction bank: fixed set compiled once into a switch. Agents
    // owned by a spectator index into it via their slot's formulaIdx (a buffer
    // value), so a spectator changing their note costs a buffer write, not a recompile.
    const bankCases = SPECTATOR_DIR_FORMULAS
        .map((f, i) => `        case ${i}u: { return ${f}; }`)
        .join('\n');
    const bankFn =
        `fn evalDirFormulaBank(fi:u32,x:f32,y:f32,t:f32,idx:f32,cx:f32,cy:f32)->f32{\n`
        + `    switch fi {\n${bankCases}\n        default: { }\n    }\n`
        + `    return ${SPECTATOR_DIR_FORMULAS[0]};\n}`;
    const fnDefs = [
        `fn evalDirFormula(x:f32,y:f32,t:f32,idx:f32,cx:f32,cy:f32)->f32{ return ${dir}; }`,
        bankFn,
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
// mode:     'SHOWCASE' — ambient / exhibition mode
// status:   'NORMAL' — formula steering + wind active, auto-cycling runs
//           'FREEROAM' — no formula, no wind; particles drift freely on momentum
//           'DOT'    — fixed inward-spiral formulas; wind + formula forced on regardless of params
const simState = {
    mode:              'STORY',
    colorMode:         'GRAYSCALE',
    qrStatus:          'HIDE',
    status:            'NORMAL',
    storyStep:         null,
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

// ── Preshow state ──────────────────────────────────────────────────────────────
let _preshowActive      = false;
let _preshowLitCount    = 0;
let _preshowWeights     = null; // Float32Array(agentCount) of original weights
let _preshowSavedParams = null; // spawn params saved on enter, restored on exit
let _avoidMapSuppressed = false; // when true, loadAvoidMap is a no-op
const _decodedImageCache = new Map(); // URL → Promise<{frames,durations}> — see _cachedDecode

// GUI handles — assigned by initGUI() at the bottom of this file.
let stateCtrl     = null;
let qrStateCtrl   = null;
let modeCtrl      = null;
let colorModeCtrl = null;
let gui, swarmDebug, dbgUsers, dbgPitch, dbgRoll, dbgTemp, dbgCoherence;
let applyGUIVisibility, toggleGUI, updateGizmo;
let golEnabledCtrl  = null;
let storyPhaseCtrl  = null;
let agentCountCtrl  = null;
let autoScaleCtrl   = null;
let renderScaleCtrl = null;
let brightnessCtrl  = null;

function updateStateDisplay() {
    modeCtrl?.updateDisplay();
    colorModeCtrl?.updateDisplay();
    stateCtrl?.updateDisplay();
    qrStateCtrl?.updateDisplay();
    emitSimState();
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

// Single entry point for status changes (GUI dropdown and server both route here),
// so the freeroam lock timer is armed/reset wherever FREEROAM is (re)entered.
function setStatus(newStatus) {
    simState.status = newStatus;
    if (newStatus === 'DOT') applyFormulas(DOT_DIR, DOT_WIND);
    armFreeroamLock();
    updateStateDisplay();
}

let qrBitmap           = null;  // permanent reference to the session QR bitmap
let sessionRoom        = null;
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
//   dx, dy, magnitude, lastInputTime }
const activeSlots = [];

// Note-driven formula selection: sum of active note indices → modulo on formula arrays.
const _activeNotesBySpectator = new Map(); // spectatorId → noteIndex (0–8)
let _noteFormulaTimer  = null;
let _pendingFormulas   = null;        // latest { dir, wind } requested while throttled
let _lastFormulaApplyT = 0;           // timestamp of the last applied formula change
const _FORMULA_LEAD_MS      = 200;    // small settle delay before the first change after idle
const _FORMULA_MIN_INTERVAL = 5000;   // movement formulas change at most once every 5 s

// ── Harmony state ─────────────────────────────────────────────────────────────
// The cache key is the note sum bucketed into a small fixed set (see
// _HARMONY_IMAGE_KEYS): the same combination bucket maps to the same image within
// a session, and the number of images ever fetched is capped. An unbounded key
// (raw sum) would fetch a fresh image on every qualifying sum at show scale — a
// /simAss-image storm. Images are held in an in-memory Map (binary bytes) and
// fetched on demand, tagged so each bucket maps to one server image; no prefetch.
const _HARMONY_IMAGE_KEYS = 6;      // number of distinct harmony image buckets per session
let _harmonyActive        = false;
let _harmonyImagesEnabled = false;  // when false, harmony images are suppressed (enabled per-phase)
let _currentHarmonyKey    = -1;     // active bucketed key (0.._HARMONY_IMAGE_KEYS-1), -1 = no harmony
let _harmonyImageShown    = false;  // true only after loadAvoidMap completes; gates the exit cooldown
let _harmonyFallback      = null;   // static filename loaded when a harmony image exits (e.g. 'aant_logo.png')
let _harmonyRiserResetFn  = null;   // called when a harmony riser fires so PHASE 9 can reset its own timer
const _harmonyFetching    = new Set(); // bucketed keys currently being fetched
let _harmonyHeld          = false;  // pins the shown image so it can't flash away on rapid note changes
let _harmonyHoldTimer     = null;
const _HARMONY_HOLD_MIN   = 6000;   // once an image is shown, keep it 6–20 s even as notes change
const _HARMONY_HOLD_MAX   = 20000;
let _harmonyCooldownUntil = 0;      // after an image disappears, block a new one until this time
const _HARMONY_COOLDOWN_MIN = 15000; // 15–20 s quiet gap between images
const _HARMONY_COOLDOWN_MAX = 20000;
let _preConnectionFormulas = null;  // { dir, wind } saved when the first spectator connects
let _chladniSum = 0;                // current harmony sum driving Chladni mode params

// In-memory harmony image cache. Bounded by _HARMONY_IMAGE_KEYS (≤ 6 entries),
// starts empty each load — no explicit clear needed.
const _harmonyImageCache = new Map(); // bucket key -> { bytes, mime }

// Pin the currently shown harmony image for a random 3–10 s. While held,
// _evalHarmony() is a no-op, so rapid note changes can't swap or clear the
// image. On release the image disappears and _exitHarmony() opens the cooldown.
function _startHarmonyHold() {
    _harmonyHeld = true;
    clearTimeout(_harmonyHoldTimer);
    const ms = _HARMONY_HOLD_MIN + Math.random() * (_HARMONY_HOLD_MAX - _HARMONY_HOLD_MIN);
    _harmonyHoldTimer = setTimeout(() => {
        _harmonyHeld = false;
        if (_harmonyActive) _exitHarmony(); // hold done: image disappears, cooldown begins
    }, ms);
}

// Decide whether to show or clear the harmony image for the current notes.
// Gated by the hold (image stays 3–10 s) and the cooldown (15–20 s quiet gap
// after it disappears) so images don't spam on the busy note stream.
function _evalHarmony() {
    if (_harmonyHeld) return;
    let sum = 0;
    for (const idx of _activeNotesBySpectator.values()) sum += idx;
    const wantHarmony = _activeNotesBySpectator.size > 0 && (sum % 4 === 0);
    if (wantHarmony) {
        if (_harmonyActive) return;                     // one already showing/loading
        if (Date.now() < _harmonyCooldownUntil) return; // still in the quiet gap
        // Bucket the (multiple-of-4) sum into a small fixed key space so at most
        // _HARMONY_IMAGE_KEYS images are ever fetched/cached per session. Dividing
        // by 4 first spreads the qualifying sums across all buckets.
        const key = Math.floor(sum / 4) % _HARMONY_IMAGE_KEYS;
        _enterHarmony(key, sum);
    } else if (_harmonyActive) {
        _exitHarmony();
    }
}

// Draw the bitmap into a 4×2 grid, threshold each of the 8 pixel luminances
// against their mean → 8-bit integer (0–255). Deterministic per image content.
// FNV-1a over up to 512 bytes of raw compressed image data → 8-bit result (0–255).
// Raw file bytes differ strongly between images even when they look visually similar,
// giving each image a distinct melodic fingerprint via speakBinary.
function _imageHash8(bytes) {
    let h = 2166136261; // FNV-1a offset basis (32-bit)
    const len = Math.min(bytes.length, 512);
    for (let i = 0; i < len; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 16777619) >>> 0; // FNV prime, unsigned 32-bit
    }
    return h & 0xFF; // 8 bits → 0–255 → ~1.6 s cue at 200 ms/bit
}

async function _enterHarmony(key, sum) {
    if (_harmonyActive && _currentHarmonyKey === key) return;
    console.log('[harmony] found key=%d sum=%d speaking=%s', key, sum, isSpeaking());
    _harmonyActive     = true;
    _currentHarmonyKey = key;
    _harmonyImageShown = false;

    // Fetch/cache the image. Happens concurrently with the upcoming riser so the
    // reveal lands as soon as the riser finishes, even if the fetch takes a moment.
    let cached = _harmonyImageCache.get(key);
    if (!cached) {
        if (_harmonyFetching.has(key)) {
            // Another call is already fetching this bucket. Reset state and bail —
            // the in-flight call will complete and load the image when done.
            _harmonyActive     = false;
            _currentHarmonyKey = -1;
            return;
        }
        _harmonyFetching.add(key);
        try {
            cached = await _fetchIdleImageBytes(key);
            _harmonyImageCache.set(key, cached);
        } catch (e) {
            console.warn('[harmony] enter key', key, 'failed:', e.message);
            _harmonyActive     = false;
            _currentHarmonyKey = -1;
            return;
        } finally {
            _harmonyFetching.delete(key);
        }
    }

    // Guard: key or flag may have changed while awaiting the fetch
    if (!_harmonyImagesEnabled || _currentHarmonyKey !== key) return;

    // Play a riser to announce the combination, then reveal the image at the peak.
    // Reset any external riser timer (e.g. PHASE 9) to avoid simultaneous risers.
    // Let any ongoing binary speech cue finish before the riser starts — the two
    // fight over AudioContext scheduled values and cause silence if they overlap.
    const speechMs = speakingRemainingMs();
    if (speechMs > 0) {
        console.log('[harmony] waiting %dms for shape speech to finish', speechMs);
        await new Promise(r => setTimeout(r, speechMs + 100));
        if (!_harmonyImagesEnabled || _currentHarmonyKey !== key) return;
    }

    const blob = new Blob([cached.bytes], { type: cached.mime });
    const decoded = await _predecodeBitmap(blob);

    if (!_harmonyImagesEnabled || _currentHarmonyKey !== key) {
        decoded.frames.forEach(f => f.close());
        return;
    }
    await loadAvoidMap({ ...decoded, _preDecoded: true });
    _harmonyImageShown = true;
    speakBinary(_imageHash8(cached.bytes));
    // 50% chance of a visual+audio punch at the reveal moment
    if (Math.random() < 0.5) {
        triggerImpact();
        burstBrightness = BURST_BRIGHTNESS;
        ambience.burstBlinkers(6, 90);
    }
    setShapePersonality('h' + (sum % 5)); // personality keyed on the raw note sum
    _startHarmonyHold();
}


function _exitHarmony() {
    if (!_harmonyActive) return;
    _harmonyActive     = false;
    _currentHarmonyKey = -1;
    // Only enforce a quiet gap when an image was actually shown; releasing notes
    // during the riser (before the image appeared) should not impose a cooldown.
    if (_harmonyImageShown) {
        _harmonyCooldownUntil = Date.now() + _HARMONY_COOLDOWN_MIN
            + Math.random() * (_HARMONY_COOLDOWN_MAX - _HARMONY_COOLDOWN_MIN);
        _harmonyImageShown = false;
    }
    if (_harmonyImagesEnabled) {
        if (_harmonyFallback) {
            // Load the fallback static image (e.g. aant_logo) instead of going blank.
            const fbUrl = `${_apiBase}/simAss-static/${_harmonyFallback}`;
            if (_currentAvoidMapSrc !== fbUrl) { // already showing it → skip the reload
                loadAvoidMap(fbUrl);
                setShapePersonality(_harmonyFallback.replace(/\.[^.]+$/, ''));
            }
        } else {
            clearAvoidMap();
            clearShapePersonality();
        }
    } else {
        clearShapePersonality();
    }
}

// Load (or reload) the image for the currently-active harmony sum.
// Called when _harmonyImagesEnabled flips to true while harmony is already active.
async function _loadCurrentHarmonyImage() {
    const key = _currentHarmonyKey;
    if (key < 0) return;
    let cached = _harmonyImageCache.get(key);
    if (!cached) {
        try { cached = await _fetchIdleImageBytes(key); _harmonyImageCache.set(key, cached); }
        catch (e) { console.warn('[harmony] image reload failed:', e.message); return; }
    }
    if (_harmonyActive && _harmonyImagesEnabled && _currentHarmonyKey === key) {
        await loadAvoidMap(new Blob([cached.bytes], { type: cached.mime }));
        _harmonyImageShown = true;
        _startHarmonyHold();
    }
}

// Throttle movement-formula changes to at most once every 5 s. Unlike the
// harmony image there's no quiet gap — back-to-back changes are fine, they're
// just rate-limited. The first change after idle settles in quickly; while a
// change is pending, later notes only update the target, they don't reschedule.
function _scheduleFormulas(dir, wind) {
    _pendingFormulas = { dir, wind };
    if (_noteFormulaTimer) return;
    const sinceLast = Date.now() - _lastFormulaApplyT;
    const delay = Math.max(_FORMULA_LEAD_MS, _FORMULA_MIN_INTERVAL - sinceLast);
    _noteFormulaTimer = setTimeout(() => {
        _noteFormulaTimer  = null;
        _lastFormulaApplyT = Date.now();
        const f = _pendingFormulas;
        _pendingFormulas = null;
        applyFormulas(f.dir, f.wind);
    }, delay);
}

function _recalcNoteFormulas() {
    let sum = 0;
    for (const idx of _activeNotesBySpectator.values()) sum += idx;

    _evalHarmony();

    if (_activeNotesBySpectator.size === 0) {
        if (activeSlots.length > 0) _chladniSum = 0; // back to base mode, no recompile needed
        return;
    }

    // Chladni mode: the note sum drives the Chladni field via a uniform (no
    // shader recompile) and it blends into the direction. Wind is disabled while
    // any spectator is connected (see the wind uniform), so there's nothing to
    // cycle here — the field itself morphs with the crowd's note sum.
    if (activeSlots.length > 0) {
        _chladniSum = sum;
        return;
    }

    const newDir  = DIR_FORMULAS[sum % DIR_FORMULAS.length];
    const newWind = WIND_FORMULAS[sum % WIND_FORMULAS.length];
    if (dirInput)  dirInput.value  = newDir;
    if (windInput) windInput.value = newWind;
    _scheduleFormulas(newDir, newWind);
}

function uploadSpectatorSlots() {
    const ab = new ArrayBuffer(704);
    const f  = new Float32Array(ab);
    const u  = new Uint32Array(ab);
    for (let i = 0; i < activeSlots.length; i++) {
        const b = i * 11;
        const s = activeSlots[i];
        f[b + 0]  = s.colorR;
        f[b + 1]  = s.colorG;
        f[b + 2]  = s.colorB;
        u[b + 3]  = 1;
        f[b + 4]  = s.spawnerX;
        f[b + 5]  = s.spawnerY;
        u[b + 6]  = s.spawnerLocationActive;
        u[b + 7]  = (s.formulaIdx ?? 0) >>> 0;
        u[b + 8]  = s.burst ? 1 : 0;
        u[b + 9]  = s.burstSeed >>> 0;
        u[b + 10] = s.blip ? 1 : 0;
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
let socket;
// Base URL for server API calls — VITE_USER_URL in production, own origin as fallback.
const _apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
ambience.init(_apiBase);
loadAvoidMap(`${_apiBase}/simAss-static/full_square.png`);

// ── Collective swarm state (written by 'collective-state' socket events) ───────
// Smoothed each frame via exponential moving average to avoid jarring jumps.
// Declared here (before the socket block) so the handler never hits TDZ.
let collectiveTemp      = 0.5; // target temperature [0=cold … 1=warm] (from touch Y)
let collectiveCoherence = 0.5; // target coherence [0=chaos … 1=order] (from touch X)

let smoothTemp        = 0.5;
let smoothCoherence   = 0.5;
let smoothColorBlend  = 0.0;  // actual value sent to the shader each frame
let _targetColorBlend = 0.0;  // 0 = gray, 1 = color
const COLOR_BLEND_TC  = 2.0;  // EMA time constant in seconds (~6 s to reach 95%)
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
    socket.emit('register-host', { sessionId: _forcedSession || undefined });

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
            // The scannable bitmap still encodes sessionUrl (real single remote);
            // clicking it instead opens the synthetic-crowd load test page.
            uiQr.addEventListener('click', () =>
                window.open(`${window.location.origin}/simremotes/?s=${sessionId}`, '_blank'));
        }

        // ── Large QR bitmap — pre-rendered via generateQR(), stored for later activation.
        await generateQR();
        socket.emit('audio-state', { locked: isAudioLocked() });
    });

    socket.on('sim-params', (data) => {
        try { applySimParams(data); }
        catch { /* malformed payload — ignore */ }
    });

    // Collective swarm state — aggregated by the server from all spectators in the room.
    socket.on('collective-state', ({ avgTemp, avgCoherence, userCount }) => {
        collectiveTemp      = avgTemp      ?? 0.5;
        collectiveCoherence = avgCoherence ?? 0.5;
        swarmDebug.users     = userCount ?? 0;
        swarmDebug.temp      = +(avgTemp      ?? 0.5).toFixed(3);
        swarmDebug.coherence = +(avgCoherence ?? 0.5).toFixed(3);
        dbgUsers.updateDisplay();
        dbgTemp.updateDisplay();
        dbgCoherence.updateDisplay();
    });

    // A spectator joined — assign a slot, send them their color, brightness burst.
    socket.on('spectator-joined', ({ spectatorId, userCount } = {}) => {
        if (userCount !== undefined) simState.userCount = userCount;
        blinker(BLINKER_TYPES[Math.floor(Math.random() * BLINKER_TYPES.length)]);
        if (_preshowActive) {
            storyEngine.onSpectatorJoined(userCount);
        } else {
            lastRemoteActivity = Date.now();
            burstBrightness    = BURST_BRIGHTNESS;
        }
        if (spectatorId && activeSlots.length < MAX_SPECTATOR_SLOTS) {
            const isFirst = activeSlots.length === 0;
            // Start with a neutral white — the phone sends a 'color-pick' immediately
            // after joining with its locally generated palette color, which overwrites this.
            activeSlots.push({ spectatorId, colorR: 1, colorG: 1, colorB: 1, spawnerX: 0.5, spawnerY: 0.5, spawnerLocationActive: 0, dx: 0, dy: 0, magnitude: 0, velocity: 0, _smoothDx: 0, _smoothDy: 0, lastInputTime: 0, burst: 0, burstSeed: 0, blip: 0, formulaIdx: 0 });
            uploadSpectatorSlots();
            if (isFirst) {
                _preConnectionFormulas = {
                    dir:  dirInput?.value  || DEFAULT_DIR,
                    wind: windInput?.value || DEFAULT_WIND,
                };
                _chladniSum = 0;
            }
        }
        // Push current UI state so the new spectator shows the right screen immediately.
        socket.emit('remote-ui', _remoteUiPayload());
    });

    socket.on('spectator-left', ({ spectatorId, userCount } = {}) => {
        if (userCount !== undefined) simState.userCount = userCount;
        if (userCount === 0) {
            _exitHarmony();
            if (_preConnectionFormulas !== null) {
                const saved = _preConnectionFormulas;
                _preConnectionFormulas = null;
                _chladniSum = 0;
                applyFormulas(saved.dir, saved.wind);
            }
            collectiveCoherence = 0.5;
            collectiveTemp      = 0.5;
            setSynthState(0.5, 0, 0, 0.5);
            ambience.stop(); // last user left — fade out music
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
                // This spectator's note selects the movement formula for their dots.
                if (event.type === 'note' && typeof event.data?.index === 'number') {
                    slot.formulaIdx = event.data.index;
                }
                uploadSpectatorSlots();
            }
            if (event.type === 'note' && event.data?.freq) addArpInfluence(event.data.freq);
            if (event.type === 'note' && typeof event.data?.index === 'number') {
                _activeNotesBySpectator.set(event.spectatorId, event.data.index);
                _recalcNoteFormulas();
                storyEngine.onNote(event.data.index);
            }
        }
        if (event.type === 'note-off') {
            _activeNotesBySpectator.delete(event.spectatorId);
        }
        if (event.type === 'blip') {
            // A random chime (like the sim's own ambient blips) plus a one-shot
            // teleport of *this spectator's own* agents to a shared random point, so
            // the burst reads as the actual user making it. The point is derived on
            // the GPU from burstSeed; the flag is cleared after the frame consumes it.
            blinker(BLINKER_TYPES[Math.floor(Math.random() * BLINKER_TYPES.length)]);
            const slot = activeSlots.find(s => s.spectatorId === event.spectatorId);
            if (slot) {
                slot.blip      = 1;
                slot.burstSeed = (Math.random() * 0x7fffffff) >>> 0;
                uploadSpectatorSlots();
            }
        }
        if (event.type === 'pulse-tap') {
            pulseEnergy = Math.min(pulseEnergy + PULSE_INCREMENT, PULSE_MAX);
        }
        if (event.type === 'raise' || event.type === 'wave') {
            burstBrightness = BURST_BRIGHTNESS;
        }
        if (event.type === 'text' && event.data?.text) {
            const input = document.querySelector('#trace-text-input');
            if (input) input.value = event.data.text;
            renderTextAvoidMap();
        }
    });

    socket.on('connect_error', () => console.warn('[socket] connection failed, will retry…'));

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

// ── Live-state mirror for the admin panel ─────────────────────────────────────
// A full snapshot of the sim's authoritative state. The admin reflects this
// verbatim, so every operator-visible field lives here in one place.
function _simStatePayload() {
    return {
        phaseIndex: storyEngine.index,
        phaseId:    storyEngine.stepId,
        phaseLabel: storyEngine.current?.label ?? null,
        phaseCount: storyEngine.length,
        mode:       simState.mode,
        status:     simState.status,
        colorMode:  simState.colorMode,
        stepStatus: simState.stepStatus,
        qrStatus:   simState.qrStatus,
        qrAlignX:   params.qrAlignX,
        qrAlignY:   params.qrAlignY,
        optionA:    simState.optionA,
        optionB:    simState.optionB,
        votesA:     simState.votesA,
        votesB:     simState.votesB,
        voteEndTime: simState.voteEndTime,
        audioLocked: isAudioLocked(),
    };
}

function emitSimState() {
    if (socket?.connected) socket.emit('sim-state', _simStatePayload());
}

// Merge server-provided params into the live simulation.
// Only numeric/boolean keys present in the payload are applied;
// if formulas are included they re-trigger pipeline compilation.
function applySimParams(data) {
    const { dir, wind, restart, clearTrace, showQR, traceText, clearText, status, avoidMap,
            step, stepStatus, optionA, optionB, preshow,
            gotoPhase, storyNext, storyPrev, storyStart, capture,
            audio, audioFormat, audiobg, audiobgFormat, audiobgLoop, mode, colorMode,
            adminBlip, adminRiser, adminImpact, ...rest } = data;

    if (audio    !== undefined) { console.log('[audio] playAudio speaking=%s', isSpeaking()); playAudio(audio || null, audioFormat).catch(e => console.warn('[audio]', e)); }
    if (audiobg  !== undefined) { console.log('[audio] playAudioBg speaking=%s', isSpeaking()); playAudioBg(audiobg || null, audiobgFormat, audiobgLoop !== false).catch(e => console.warn('[audiobg]', e)); }

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
    // Story navigation — operator override. Mirrors the engine calls the GUI uses;
    // onGoto emits story-step + sim-state, so the admin gets immediate confirmation.
    if (typeof gotoPhase === 'number') storyEngine.goto(gotoPhase);
    if (storyNext  === true) storyEngine.next();
    if (storyPrev  === true) storyEngine.goto(storyEngine.index - 1);
    if (storyStart === true) storyEngine.start();
    if (capture    === true) _captureRequested = true;
    if (adminBlip === true) {
        blinker(BLINKER_TYPES[Math.floor(Math.random() * BLINKER_TYPES.length)]);
        for (const slot of activeSlots) {
            slot.blip      = 1;
            slot.burstSeed = (Math.random() * 0x7fffffff) >>> 0;
        }
        if (activeSlots.length) uploadSpectatorSlots();
    }
    if (adminRiser  === true) { console.log('[audio] adminRiser'); playRiser(4000); }
    if (adminImpact === true) { console.log('[audio] adminImpact'); triggerImpact(); }
    if (preshow === true)  storyEngine.start();
    if (preshow === false) simFacade.reseed();
    if (restart)              seedAgents();
    if (avoidMap === null)    clearAvoidMap();
    else if (typeof avoidMap === 'string') loadAvoidMap(avoidMap);
    if (clearTrace) {
        const clearInput = document.querySelector('#trace-text-input');
        if (clearInput) clearInput.value = '';
        simState.qrStatus = 'HIDE';
        updateStateDisplay();
        renderTextAvoidMap();
        updateQROverlay();
    }
    if (showQR === true)  restoreQR();
    if (showQR === false) {
        simState.qrStatus = 'HIDE';
        updateStateDisplay();
        updateQROverlay();
    }
    if (clearText)            clearTraceText();
    if (traceText !== undefined) {
        const input = document.querySelector('#trace-text-input');
        if (input) input.value = traceText || '';
        renderTextAvoidMap();
    }
    const changed = (k) => k in rest && rest[k] !== params[k];
    const needsRetrace = ['traceScale','imageX','imageY'].some(changed);
    const needsQRReseed = !params.qrOverlay &&
        ['qrAlignX','qrAlignY','qrSize','qrMargin'].some(changed);
    const needsQRRegen  = ['qrQuietZone','qrInvert'].some(changed);
    const needsReseed   = ['agentCount','weightSpread'].some(changed);
    const needsRebuild  = changed('renderScale');

    Object.entries(rest).forEach(([k, v]) => {
        if (k in params) params[k] = v;
    });
    if ('duckLevel'  in rest) setDuckLevel(params.duckLevel);
    if (needsReseed)  seedAgents();
    if (needsRebuild) applyResize();
    if (needsRetrace) renderTextAvoidMap();
    if (needsQRReseed) seedAgents();
    if (needsQRRegen)  generateQR().then(updateQROverlay);
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
    dbgUsers, dbgPitch, dbgRoll, dbgTemp, dbgCoherence,
    golEnabledCtrl,
    storyPhaseCtrl,
    agentCountCtrl, autoScaleCtrl, renderScaleCtrl, brightnessCtrl,
    applyGUIVisibility, toggleGUI, updateGizmo,
} = initGUI({
    params, socket, simState, MAX_AGENTS,
    storyEngine,
    seedAgents,
    seedGoL, setSize, rebuildOffscreen, rebuildGridTex, applyResize,
    generateQR, loadFontSpec, renderTextAvoidMap, updateQROverlay,
    clearTraceText, clearAvoidMap,
    updateAvoidMapOverlay: _updateAvoidMapOverlay,
}));

// Sync GUI with URL params that were applied before initGUI ran.
autoScaleCtrl.updateDisplay();

storyEngine.onGoto = (i) => {
    _urlParams.set('phase', i + 1);
    history.replaceState(null, '', '?' + _urlParams.toString());
    storyPhaseCtrl.updateDisplay();
    socket?.emit('story-step', { step: i });
    emitSimState();
};

// Keep the admin's vote countdown fresh and re-hydrate it if it (re)connects
// mid-show. The state snapshot is cheap and the transport drops it when no admin
// is listening, so a steady 1 s cadence is fine.
setInterval(emitSimState, 1000);

stateCtrl.onChange(v => setStatus(v));
qrStateCtrl.onChange(() => { updateStateDisplay(); updateQROverlay(); });

window.addEventListener('keydown', e => {
    if (e.key === 'Control') toggleGUI();
    if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        _captureRequested = true;
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

    let newDir  = dirInput.value;
    let newWind = windInput.value;
    let changed = false;

    // Direction auto-cycle is idle-only: during the show each spectator drives
    // their own movement formula, so the global direction stays put.
    if (activeSlots.length === 0 && params.autoDir && params.followFormula) {
        newDir = rndPick(DIR_FORMULAS);
        dirInput.value = newDir;
        changed = true;
    }
    // Wind cycles constantly — a shared force over every dot, show or idle.
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

// ── Static image cache ────────────────────────────────────────────────────────
// _decodedImageCache is declared near _avoidMapSuppressed (before any loadAvoidMap call).
// _cachedDecode is a hoisted function so it can live here, close to loadAvoidMap.
function _cachedDecode(url) {
    if (!_decodedImageCache.has(url)) {
        const p = fetch(url).then(r => r.blob()).then(b => _predecodeBitmap(b)).then(decoded => {
            if (decoded.durations !== null) _decodedImageCache.delete(url); // don't cache animated GIFs
            return decoded;
        });
        _decodedImageCache.set(url, p);
    }
    return _decodedImageCache.get(url);
}

const _validSavedPhase = Number.isFinite(_savedPhase) && _savedPhase >= 1 && _savedPhase <= 9;

if (_validSavedPhase) {
    // Auto-resume: overlay already hidden by HTML default; replay state instantly.
    // Audio will unlock on the next user interaction (first Tone.start() call).
    const targetIdx = _savedPhase - 1; // convert to 0-indexed
    for (let i = 0; i <= targetIdx; i++) storyEngine.goto(i);
} else {
    _audioBanner?.classList.remove('unlocked'); // reveal the HARMONY banner
    document.addEventListener('pointerdown', async () => {
        await unlockAudio();
        if (socket?.connected) socket.emit('audio-state', { locked: isAudioLocked() });
        _syncAudioBanner();
        storyEngine.start();
    }, { once: true });
}

// ── Avoidance map overlay ─────────────────────────────────────────────────────
function _updateAvoidMapOverlay() {
    if (!params.showAvoidMapImage || !_avoidMapBitmap || !hasAvoidMap) {
        _avoidMapOverlayEl.style.opacity = '0';
        return;
    }
    const W = canvas.width, H = canvas.height;
    _avoidMapOverlayEl.width  = W;
    _avoidMapOverlayEl.height = H;
    const ctx2 = _avoidMapOverlayEl.getContext('2d');
    ctx2.clearRect(0, 0, W, H);
    const coverScale = Math.min(W / _avoidMapBitmap.width, H / _avoidMapBitmap.height) * params.avoidMapScale;
    const dw = _avoidMapBitmap.width  * coverScale;
    const dh = _avoidMapBitmap.height * coverScale;
    ctx2.globalAlpha = 0.5;
    ctx2.drawImage(_avoidMapBitmap, (W - dw) / 2, (H - dh) / 2, dw, dh);
    _avoidMapOverlayEl.style.opacity = '1';
}

// ── Avoidance map upload ──────────────────────────────────────────────────────
// source: string URL | Blob/File | { frames, durations, _preDecoded: true }
async function loadAvoidMap(source) {
    if (_avoidMapSuppressed) return;
    _currentAvoidMapSrc = typeof source === 'string' ? source : null;
    _qrOwnedAvoidMap   = false;
    _textOwnedAvoidMap = false;

    let decoded;
    if (source?._preDecoded) {
        decoded = source;
    } else if (typeof source === 'string') {
        decoded = await _cachedDecode(source);
    } else {
        decoded = await _predecodeBitmap(source);
    }

    clearAvoidGif();
    const { frames, durations } = decoded;
    const bmp = frames[0];
    if (durations && frames.length > 1) {
        avoidGifFrames      = frames;
        avoidGifDurations   = durations;
        avoidGifFrameIdx    = 0;
        avoidGifNextFrameAt = performance.now() + durations[0];
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
    _avoidMapBitmap = bmp;
    rebuildSimBG();
    rebuildRenderBG();
    _updateAvoidMapOverlay();
    if (!_inQROverlayUpdate && params.qrOverlay && simState.qrStatus === 'SHOW' && qrBitmap) updateQROverlay();
}

function clearAvoidMap() {
    _currentAvoidMapSrc = null;
    clearAvoidGif();
    if (avoidMapTex) { avoidMapTex.destroy(); avoidMapTex = null; }
    avoidMapTexView    = null;
    hasAvoidMap        = false;
    _avoidMapBitmap    = null;
    _textOwnedAvoidMap = false;
    _updateAvoidMapOverlay();
    rebuildSimBG();
    rebuildRenderBG();
    if (!_inQROverlayUpdate && params.qrOverlay && simState.qrStatus === 'SHOW' && qrBitmap) updateQROverlay();
    // Reapply text avoidmap if text is still present and no image is showing
    renderTextAvoidMap();
}

document.querySelector('#avoid-map-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) loadAvoidMap(file);
    e.target.value = '';
});

// ── Trace text input ──────────────────────────────────────────────────────────
// Debounced: re-renders the text avoid map 300 ms after the user stops typing.
// The text is drawn as white glyphs the particles are repelled by.
let traceTextTimer = null;
document.querySelector('#trace-text-input').addEventListener('input', () => {
    clearTimeout(traceTextTimer);
    traceTextTimer = setTimeout(() => {
        renderTextAvoidMap();
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
// No default text on boot — story sets it at the appropriate phase.
const _defaultTextInput = document.querySelector('#trace-text-input');
renderTextAvoidMap();
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

// ── Uniform writers ───────────────────────────────────────────────────────────
function writeSoloUB(dt, time) {
    // Smooth collective state toward targets (~0.8 s time constant)
    const a = Math.exp(-dt / 0.8);
    smoothTemp      = smoothTemp      * a + collectiveTemp      * (1 - a);
    smoothCoherence = smoothCoherence * a + collectiveCoherence * (1 - a);
    const colorA    = Math.exp(-dt / COLOR_BLEND_TC);
    smoothColorBlend = smoothColorBlend * colorA + _targetColorBlend * (1 - colorA);

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
    u[10] = 0;   // retired: trace homing
    f[11] = 0;
    f[12] = 0;
    f[13] = 0;
    f[14] = 0;
    f[15] = 0;
    u[16] = (!isIdle && (isDot || params.followFormula)) ? 1 : 0;
    f[17] = 0;
    f[18] = 0;
    const isQR = simState.qrStatus === 'SHOW';
    f[19] = 0;
    f[20] = 0;  // tilt bias removed
    f[21] = 0;
    f[22] = params.avoidForceStr;
    u[23] = isQR ? 1 : 0;  // qrMode — QR respawn rect active
    const avoidMapActive = hasAvoidMap;
    u[24] = avoidMapActive ? 1 : 0;
    f[25] = params.avoidMapScale;
    u[26] = params.bounceEdges ? 1 : 0;
    f[27] = 0;   // retired: shadow probe
    f[28] = 0;
    u[29] = 0;
    f[30] = 0;
    f[31] = 0;   // retired: homing
    f[32] = 0;
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
    u[46] = params.golEnabled ? 1 : 0;   // GoL stays GUI-only
    f[47] = params.golStrength;
    f[48] = params.releaseBurstSpeed;
    f[49] = 0;   // retired: chaos
    const teleportActive = !params.randomTeleportOnAvoidMap || hasAvoidMap;
    f[50] = teleportActive ? params.randomTeleportChance : 0;
    u[51] = _preConnectionFormulas !== null ? 1 : 0;
    // M and N stay in [1.0, 3.0) — low enough for smooth gentle patterns.
    // Different prime multipliers decorrelate M from N so same sum → unique field.
    f[52] = 1.0 + (_chladniSum * 0.07) % 2.0;
    f[53] = 1.0 + (_chladniSum * 0.11) % 2.0;
    f[54] = (_chladniSum % 2 === 0) ? 1.0 : -1.0;
    f[55] = params.chladniBlend;
    f[56] = params.spawnFadeRate;
    u[57] = params.limitAtCenter ? 1 : 0;
    f[58] = params.limitAtCenterRadius;
    const _synthNow = performance.now();
    if (_synthNow - _lastSynthTick >= 200) {
        _lastSynthTick = _synthNow;
        setSynthState(smoothCoherence, 0, 0, smoothTemp);
    }
    device.queue.writeBuffer(soloUB, 0, ab);
}

function writeRenderUB() {
    const ab = _renderAB;
    const u  = _renderU;
    const f  = _renderF;
    const c1 = hexToF(params.color1);
    const c2 = hexToF(params.color2);

    u[0] = params.agentCount;
    f[1] = canvas.width;
    f[2] = canvas.height;
    f[3] = params.pointSize;
    f[4] = c1[0];
    f[5] = c1[1];
    f[6] = c1[2];
    f[7] = params.maxSpeed;
    u[8]  = 0;   // retired: trace homing
    f[9]  = 0;
    f[10] = 0;
    f[11] = 0;
    f[12] = 0;
    f[13] = c2[0];
    f[14] = c2[1];
    f[15] = c2[2];
    // Audio no longer affects brightness — it leans the palette toward color2 instead (f[38]).
    // Audio used to multiply brightness by audioMult ∈ [0.1, 1.0] (0.1 at rest). Keep that
    // former resting level as a fixed scale so the at-rest look is unchanged; brightness,
    // burst and pulse stay in the same balance they had before.
    f[16] = (params.brightness + burstBrightness + pulseEnergy) * REST_BRIGHTNESS;
    f[17] = 0;
    f[18] = 0;
    f[19] = 0;
    u[20] = simState.qrStatus === 'SHOW' ? 1 : 0;
    f[21] = 0;   // retired: homing proximity
    f[22] = 0;
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
    // Avoid map options for per-particle color sampling.
    const avoidMapActive = hasAvoidMap;
    u[30] = avoidMapActive ? 1 : 0;
    f[31] = params.avoidMapScale;
    u[32] = params.avoidMapInvert ? 1 : 0;
    u[33] = params.avoidMapSampleColor ? 1 : 0;
    u[34] = params.avoidMapFixedColor  ? 1 : 0;
    f[35] = params.avoidMapBlackCutoff;
    u[36] = params.championsEnabled ? params.champions : 0;
    f[37] = params.championSize;
    // Room audio leans the base palette toward color2: 0 at silence, → color2AudioStr at peak.
    f[38] = (isActive() ? getVolume() : 0) * params.color2AudioStr;
    f[39] = 0;   // retired: avoidMapSampleChaos
    f[40] = 0;   // retired: chaosColorR
    f[41] = 0;   // retired: chaosColorG
    f[42] = 0;   // retired: chaosColorB
    f[43] = 0;   // retired: chaosColorFraction (0 → override disabled)
    // Idle color override — only active when no spectators connected (JS zeroes fraction when active)
    const ic = hexToF(params.idleColor);
    f[44] = ic[0];
    f[45] = ic[1];
    f[46] = ic[2];
    f[47] = activeSlots.length === 0 ? params.idleColorFraction : 0.0;
    u[48] = 0;   // retired: debug homing
    device.queue.writeBuffer(renderUB, 0, ab);
}


function writeFadeUB() {
    _fadeF[0] = params.trailEnabled ? params.trailDecay : 1.0;
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
    _blitF[5] = smoothColorBlend;
    _blitU[6] = simState.colorMode === 'GRAYSCALE_INVERTED' ? 1 : 0;
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
const _soloAB  = new ArrayBuffer(240); const _soloU  = new Uint32Array(_soloAB);  const _soloF  = new Float32Array(_soloAB);
const _renderAB= new ArrayBuffer(208); const _renderU= new Uint32Array(_renderAB); const _renderF= new Float32Array(_renderAB);
const _fadeAB  = new ArrayBuffer(16);  const _fadeF  = new Float32Array(_fadeAB);
const _blitAB  = new ArrayBuffer(32);  const _blitF  = new Float32Array(_blitAB); const _blitU  = new Uint32Array(_blitAB);
const _downsampleAB = new ArrayBuffer(16); const _downsampleF = new Float32Array(_downsampleAB);
const _contamAB= new ArrayBuffer(176); const _contamU= new Uint32Array(_contamAB); const _contamF= new Float32Array(_contamAB);
const _golAB   = new ArrayBuffer(16);  const _golU   = new Uint32Array(_golAB);   const _golF   = new Float32Array(_golAB);
const _windVisAB=new ArrayBuffer(32);  const _windVisF=new Float32Array(_windVisAB); const _windVisU=new Uint32Array(_windVisAB);

// ── Screenshot capture ───────────────────────────────────────────────────────
// Press 's' to capture the current frame at canvas backing-store resolution.
// The flag is consumed inside frame() — copy happens in the same command encoder
// as the frame, after the blit pass, so we always grab what was just on screen.
let _captureRequested = false;

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

// ── Adaptive quality ──────────────────────────────────────────────────────────
const AQ = {
    smoothedFPS:    60,
    cooldown:       0,
    LOW_FPS:        56,    // start stepping down when smoothed FPS falls below this
    ALPHA:          0.05,  // EMA coefficient (~20-frame time constant)
    SCALE_STEP:     0.05,  // renderScale reduction per step
    SCALE_MIN:      0.5,   // floor for render scale
    SCALE_COOLDOWN: 60,    // frames between render-scale steps
    AGENT_FACTOR:   0.90,  // agentCount multiplier per step (10% reduction)
    AGENT_MIN:      100_000,
    AGENT_COOLDOWN: 120,   // frames between agent-count steps
};

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

    // Adaptive quality — step down agentCount first, renderScale as last resort.
    if (params.autoScale) {
        AQ.smoothedFPS = AQ.ALPHA * (1 / rawDt) + (1 - AQ.ALPHA) * AQ.smoothedFPS;
        if (--AQ.cooldown <= 0 && AQ.smoothedFPS < AQ.LOW_FPS) {
            if (params.agentCount > AQ.AGENT_MIN) {
                const prevCount   = params.agentCount;
                params.agentCount = Math.max(AQ.AGENT_MIN,
                    Math.floor(params.agentCount * AQ.AGENT_FACTOR));
                agentCountCtrl?.updateDisplay();
                const cut = prevCount - params.agentCount;
                params.brightness = Math.min(0.5, params.brightness + Math.floor(cut / 100_000) * 0.02);
                brightnessCtrl?.updateDisplay();
                AQ.cooldown = AQ.AGENT_COOLDOWN;
            } else if (params.renderScale > AQ.SCALE_MIN + 0.001) {
                params.renderScale = Math.max(AQ.SCALE_MIN,
                    +(params.renderScale - AQ.SCALE_STEP).toFixed(2));
                applyResize({ skipSeed: true });
                renderScaleCtrl?.updateDisplay();
                AQ.cooldown = AQ.SCALE_COOLDOWN;
            }
        }
    }

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

    // ── Advance animated GIF frames (avoidance map) ───────────────────────────
    {
        const perfNow = performance.now();
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
        cp.dispatchWorkgroups(Math.ceil(params.agentCount / 256));
        cp.end();
    }

    // Color prepass: compute per-agent color once; render vertex shader reads colorBuf.
    if (colorPrepassBG) {
        const cp2 = enc.beginComputePass();
        cp2.setPipeline(colorPrepassPipe);
        cp2.setBindGroup(0, colorPrepassBG);
        cp2.dispatchWorkgroups(Math.ceil(params.agentCount / 256));
        cp2.end();
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
    rp.setPipeline(params.additiveBlend ? fadePipeAdditive : fadePipe);
    rp.setBindGroup(0, params.additiveBlend ? fadeBGAdditive : fadeBG);
    rp.draw(3);
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

    // Bloom: threshold-downsample → blur H → blur V into bloomTexA, ready for glare composite.
    if (params.glareEnabled && bloomTexA && !usingPixel) {
        const bw = bloomTexA.width, bh = bloomTexA.height;
        const wx = Math.ceil(bw / 8), wy = Math.ceil(bh / 8);
        // Downsample pass
        _bloomU32[0] = canvas.width; _bloomU32[1] = canvas.height;
        _bloomU32[2] = bw;           _bloomU32[3] = bh;
        _bloomF32[4] = params.glareThreshold; _bloomF32[5] = 0;
        _bloomU32[6] = 0; _bloomU32[7] = 4;
        device.queue.writeBuffer(bloomUB, 0, _bloomAB);
        const cp1 = enc.beginComputePass();
        cp1.setPipeline(bloomDownsamplePipe);
        cp1.setBindGroup(0, bloomDownsampleBG);
        cp1.dispatchWorkgroups(wx, wy);
        cp1.end();
        // Blur H
        _bloomU32[0] = bw; _bloomU32[1] = bh; _bloomU32[2] = bw; _bloomU32[3] = bh;
        _bloomU32[6] = 1;  // horizontal
        device.queue.writeBuffer(bloomUB, 0, _bloomAB);
        const cp2 = enc.beginComputePass();
        cp2.setPipeline(bloomBlurPipe);
        cp2.setBindGroup(0, bloomBlurHBG);
        cp2.dispatchWorkgroups(wx, wy);
        cp2.end();
        // Blur V
        _bloomU32[6] = 0;  // vertical
        device.queue.writeBuffer(bloomUB, 0, _bloomAB);
        const cp3 = enc.beginComputePass();
        cp3.setPipeline(bloomBlurPipe);
        cp3.setBindGroup(0, bloomBlurVBG);
        cp3.dispatchWorkgroups(wx, wy);
        cp3.end();
    }

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
    if (params.glareEnabled && glareBG && !usingPixel) {
        _glareF32[0] = 1; _glareF32[1] = 1; _glareF32[2] = 1;
        _glareF32[3] = params.glareIntensity;
        device.queue.writeBuffer(glareUB, 0, _glareAB);
        bp.setPipeline(glarePipe);
        bp.setBindGroup(0, glareBG);
        bp.draw(6);
    }
    if (params.showWindVis && windVisPipe) {
        bp.setPipeline(windVisPipe);
        bp.setBindGroup(0, windVisBG);
        bp.draw(visGridW * visGridH * 6);
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

    device.queue.submit([enc.finish()]);

    if (captureBuf) finalizeCapture(captureBuf, captureW, captureH, capturePadded);

    // Fireworks burst and blip teleport are one-shot — this frame's compute consumed
    // them, so clear the flags now and re-upload, leaving the moved agents on their own.
    if (activeSlots.length) {
        let burstDirty = false;
        for (const slot of activeSlots) {
            if (slot.burst) { slot.burst = 0; burstDirty = true; }
            if (slot.blip)  { slot.blip  = 0; burstDirty = true; }
        }
        if (burstDirty) uploadSpectatorSlots();
    }

    fpsFrames++;
}

// ── simAss image fetch — shared by harmony image loading ─────────────────────
// The bucket key is sent as ?id= so each bucket deterministically maps to one
// server image (and the same bucket keeps showing the same image).
async function _fetchIdleImageBytes(key) {
    const res = await fetch(`${_apiBase}/simAss-image?id=${key}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mime = res.headers.get('content-type')?.split(';')[0].trim() ?? 'image/webp';
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime };
}

// Harmony images are fetched on demand and held in the in-memory _harmonyImageCache by bucket key.

requestAnimationFrame(frame);
