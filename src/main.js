// ─── Main Entry Point — WebGPU Ant Simulation ────────────────────────────────
import './style.css';
import { io }           from 'socket.io-client';
import QRCode           from 'qrcode';
import { Simulation }   from './simulation.js';
import { params, baseParams, refreshGUI, GUI } from './tunables.js';
import { deepReplace, isDEV, hexToRgb }        from './utils.js';
import { uuid, rndImage }                       from './client-api.js';

// ── Session UUID ──────────────────────────────────────────────────────────────
const UUID = isDEV() ? 'test' : await uuid();

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const socket = io(import.meta.env.VITE_API_HOSTNAME);

socket.on('connect', () => {
    socket.emit('register-host', { room: UUID });
});

// n8n response: full simulation parameter set
socket.on('sim-params', (data) => {
    if (!data) return;
    nuke = true;
    if (data.simulation) {
        deepReplace(params, data.simulation);
        refreshGUI();
    }
    // If n8n produced an image URL or base64, load it as media trail
    if (data.image_data) {
        loadMediaFromDataURL(data.image_data);
    }
});

// Raw text forwarded for display (optional)
socket.on('text-input', (text) => {
    console.log('[input]', text);
});

// Quick colour override from mobile
socket.on('color', (hex) => {
    const rgb = hexToRgb(hex);
    params.COLOR.POINT_COLOR = rgb;
    refreshGUI();
});

// Motion intensity → step length multiplier
socket.on('motion', (value) => {
    params.STEP_LEN = baseParams.STEP_LEN * (value * 2);
});

// ── Canvas & WebGPU bootstrap ─────────────────────────────────────────────────
const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:block;';
document.body.prepend(canvas);

function setCanvasSize() {
    canvas.width  = Math.floor(window.innerWidth  * window.devicePixelRatio);
    canvas.height = Math.floor(window.innerHeight * window.devicePixelRatio);
}
setCanvasSize();

const canvasFormat = navigator.gpu?.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
const N            = params.TEX_SIDE * params.TEX_SIDE;

const sim = new Simulation(canvas);
await sim.init(N, params.TRAIL_TEX_SIZE, canvasFormat);
sim.seedAgents(params.SPAWN_RADIUS);

// Compute initial image area params based on canvas size
const minDim = Math.min(canvas.width, canvas.height);
params.IMAGE_AREA   = minDim * 0.25;
params.IMAGE_REVEAL = minDim * 0.4;

// ── QR code ───────────────────────────────────────────────────────────────────
const qrData = `${import.meta.env.VITE_USER_URL}?s=${UUID}`;
const qrEl   = document.querySelector('#qrcode');
QRCode.toDataURL(qrData).then(dataURL => {
    if (qrEl) {
        qrEl.src     = dataURL;
        qrEl.onclick = () => window.open(qrData, '_blank');
    }
});

// ── HUD ───────────────────────────────────────────────────────────────────────
const fpsEl       = document.querySelector('#fps');
const agentsEl    = document.querySelector('#agentsCount');
const buildDateEl = document.querySelector('#buildDate');
if (agentsEl)    agentsEl.textContent   = `${N.toLocaleString()} agents`;
if (buildDateEl) buildDateEl.textContent = BUILD_DATE;

// ── Input state ───────────────────────────────────────────────────────────────
let mouseDown  = false;
let mouseX     = 0;
let mouseY     = 0;
let mouseOnCanvas = false;
let nuke       = false;

document.addEventListener('mousemove', e => {
    // Store in canvas-pixel coordinates (Y-down)
    mouseX = e.clientX * window.devicePixelRatio;
    mouseY = e.clientY * window.devicePixelRatio;
});
document.addEventListener('mouseenter', () => { mouseOnCanvas = true; });
document.addEventListener('mouseleave', () => { mouseOnCanvas = false; });
document.addEventListener('mousedown',  e => {
    mouseDown = e.target === canvas && params.ENABLE_MOUSE;
});
document.addEventListener('mouseup', () => { mouseDown = false; });

document.addEventListener('keydown', e => { if (e.key === 'n') nuke = true; });
document.addEventListener('keyup',   e => { if (e.key === 'n') nuke = false; });

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
    setCanvasSize();
    sim.resize();
});

// ── Media trail (image/video as pheromone source) ─────────────────────────────
let activeVideo = null;

async function loadMediaFromDataURL(dataURL) {
    const img = new Image();
    img.src = dataURL;
    await img.decode();
    const bmp = await createImageBitmap(img);
    sim.loadMedia(bmp);
    bmp.close();
    mediaActive = true;
}

async function loadMediaFromFile(file) {
    const bmp = await createImageBitmap(file);
    sim.loadMedia(bmp);
    bmp.close();
    mediaActive = true;
}

function startVideoMedia(videoEl) {
    activeVideo = videoEl;
    mediaActive = true;
}

function clearMediaTrail() {
    sim.clearMedia();
    if (activeVideo) {
        activeVideo.pause();
        activeVideo = null;
    }
    mediaActive = false;
}

let mediaActive = false;

// ── Test buttons (temporary helpers for B&W media trail) ─────────────────────
const testImageBtn = document.querySelector('#testImage');
const testVideoBtn = document.querySelector('#testVideo');
const clearMediaBtn= document.querySelector('#clearMedia');
const imageFileIn  = document.querySelector('#imageFile');
const videoFileIn  = document.querySelector('#videoFile');

testImageBtn?.addEventListener('click', () => imageFileIn?.click());
testVideoBtn?.addEventListener('click', () => videoFileIn?.click());
clearMediaBtn?.addEventListener('click', clearMediaTrail);

imageFileIn?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadMediaFromFile(file);
    e.target.value = '';
});

videoFileIn?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url  = URL.createObjectURL(file);
    const vid  = document.createElement('video');
    vid.src    = url;
    vid.loop   = true;
    vid.muted  = true;
    vid.play();
    startVideoMedia(vid);
    e.target.value = '';
});

// ── Random cached image (placeholder, every 10 s) ─────────────────────────────
let lastImgName = null;
const placeholderTick = setInterval(async () => {
    if (mediaActive) return;           // don't overwrite intentional media
    const data = await rndImage();
    if (!data || data.name === lastImgName) return;
    lastImgName = data.name;
    await loadMediaFromDataURL(data.data);
}, 10000);

// ── Frame loop ────────────────────────────────────────────────────────────────
const TIME_MULT = 0.001;
let prevTime    = performance.now() * TIME_MULT;
let frameCount  = 0;
let fpsFrames   = 0;
let fpsLast     = performance.now();

function frame(ts) {
    requestAnimationFrame(frame);

    const now = ts * TIME_MULT;
    const dt  = Math.min(Math.max(now - prevTime, TIME_MULT), 0.05);
    prevTime  = now;

    // Upload current video frame to GPU (if video media is active)
    if (activeVideo && !activeVideo.paused && activeVideo.readyState >= 2) {
        createImageBitmap(activeVideo).then(bmp => {
            sim.loadMedia(bmp);
            bmp.close();
        });
    }

    sim.frame({
        // Timing
        dt, time: now, frameCount,
        // Physics
        stepLen:         params.STEP_LEN,
        drag:            params.DRAG,
        turnJitter:      params.TURN_JITTER,
        senseDist:       params.SENSE_DIST,
        senseAngle:      params.SENSE_ANGLE,
        turnRate:        params.TURN_RATE,
        // Deposit
        depositSize:     params.DEPOSIT_SIZE,
        depositStrength: params.DEPOSIT_STRENGTH,
        depositEdgeSoft: params.DEPOSIT_EDGE_SOFT,
        champInterval:   params.CHAMP_SAMPLE_INTERVAL,
        champMultiplier: params.CHAMP_IMP_MULTIPLIER,
        // Trail
        trailDecay:      params.TRAIL_DECAY,
        trailBrightness: params.TRAIL_BRIGHTNESS,
        // Render
        showTrail:       params.SHOW_TRAIL,
        pointSize:       params.POINT_SIZE,
        COLOR:           params.COLOR,
        // Post-FX
        bloomStrength:   params.BLOOM_STRENGTH,
        bloomThreshold:  params.BLOOM_THRESHOLD,
        bloomRadius:     params.BLOOM_RADIUS,
        gamma:           params.GAMMA,
        // Input
        mouseDown:       mouseDown && params.ENABLE_MOUSE,
        mouseX,  mouseY,
        mouseRadius:     80 * window.devicePixelRatio,
        nuke,
        // Media
        mediaStrength:   params.MEDIA_STRENGTH,
        imageArea:       params.IMAGE_AREA,
        imageReveal:     params.IMAGE_REVEAL,
    });

    // Reset nuke after one frame
    nuke = false;
    frameCount++;

    // FPS counter
    fpsFrames++;
    const nowMs = performance.now();
    if (nowMs - fpsLast >= 1000) {
        const fps = (fpsFrames * 1000) / (nowMs - fpsLast);
        if (fpsEl) fpsEl.textContent = `${fps.toFixed(1)} fps`;
        fpsLast   = nowMs;
        fpsFrames = 0;
    }
}

requestAnimationFrame(frame);
