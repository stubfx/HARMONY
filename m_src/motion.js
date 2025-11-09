/**
 * Device Motion/Orientation Utilities
 * Plain JS functions. No frameworks. No bundlers required.
 *
 * External API:
 *   - getMovement(freqHz?: number): returns normalized snapshot { alpha, beta, gamma, accel, gyro, motion }
 *     • All fields in [0,1]. alpha/beta/gamma are tilt deltas normalized from an initial baseline.
 *     • motion is aggregate movement measured over the last MOTION_WINDOW_MS.
 *     • Calling with a frequency starts recording if not already running (or updates frequency).
 *   - startRecording(freqHz?: number): explicitly start/update sampling (last function in file as requested).
 *   - stopRecording(): stops sampling.
 *   - requestMotionPermission(): call in a user gesture on iOS to enable sensors.
 *   - getSupportStatus(): returns { orientation, motion } booleans + notes.
 *
 * Notes:
 *   - iOS requires a user gesture for motion/orientation permission. Call requestMotionPermission() from a tap/click.
 *   - On platforms lacking sensors, returns zeros.
 */

// ===== Configuration =====
const MOTION_WINDOW_MS = 1000; // \"last second\" horizon for the aggregated motion metric
const DEFAULT_FREQ_HZ = 30;    // sampling loop frequency

// Normalization heuristics (empirical, clamp aggressively)
const MAX_LINEAR_ACCEL = 15;   // m/s^2 ~ brisk shaking gets near this; clamp beyond
const MAX_GYRO_DPS   = 720;    // deg/s threshold for \"full\" rotation activity
const FULL_TILT_DEG  = 90;     // degrees delta from baseline treated as 1.0 for beta/gamma/alpha

const MOTION_WEIGHTS = { accel: 0.6, gyro: 0.3, orient: 0.1 };

// ===== Internal State =====
let recording = false;
let freqHz = DEFAULT_FREQ_HZ;
let timerId = null;

let baseline = { alpha: null, beta: null, gamma: null };

// Last raw readings captured from events (best-effort)
let lastOri = { alpha: null, beta: null, gamma: null, absolute: null, ts: 0 };
let lastMotion = {
  ax: null, ay: null, az: null,           // acceleration (without gravity) if available
  aix: null, aiy: null, aiz: null,        // accelerationIncludingGravity fallback
  rrAlpha: null, rrBeta: null, rrGamma: null, // rotationRate deg/s
  ts: 0,
};

// Gravity estimate for high-pass (when only includingGravity is available)
let gravity = { x: 0, y: 0, z: 0 };
const GRAVITY_LP_ALPHA = 0.8; // low-pass smoothing factor for gravity segregation

// Ring buffer for recent motion samples (normalized 0..1)
let motionBuffer = []; // entries: { t: epochMs, v: normalizedSampleMovement }

// Latest public snapshot (normalized 0..1)
let latestSnapshot = {
  alpha: 0, // [0,1]
  beta: 0,  // [0,1]
  gamma: 0, // [0,1]
  accel: 0, // [0,1]
  gyro: 0,  // [0,1]
  motion: 0 // [0,1] over last MOTION_WINDOW_MS
};

// ===== Utilities =====
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

const angularDelta = (a, b) => {
  if (a == null || b == null) return 0;
  // shortest distance on a circle (degrees)
  let d = Math.abs(((a - b + 540) % 360) - 180);
  return d; // [0,180]
};

const normAngleDelta = (a, b) => clamp01(angularDelta(a, b) / FULL_TILT_DEG);

const vecMag = (x, y, z) => Math.sqrt((x||0)*(x||0) + (y||0)*(y||0) + (z||0)*(z||0));

function pruneMotionBuffer(cutoff) {
  while (motionBuffer.length && motionBuffer[0].t < cutoff) motionBuffer.shift();
}

function computeMotionAggregate() {
  const cutoff = now() - MOTION_WINDOW_MS;
  pruneMotionBuffer(cutoff);
  if (motionBuffer.length === 0) return 0;
  // Mean of normalized per-sample motion values in the window
  let sum = 0;
  for (const s of motionBuffer) sum += s.v;
  return clamp01(sum / motionBuffer.length);
}

function ensureBaselines() {
  if (baseline.alpha == null && lastOri.alpha != null) baseline.alpha = lastOri.alpha;
  if (baseline.beta  == null && lastOri.beta  != null) baseline.beta  = lastOri.beta;
  if (baseline.gamma == null && lastOri.gamma != null) baseline.gamma = lastOri.gamma;
}

// ===== Permissions (iOS Safari) =====
function requestMotionPermission() {
  // Call this inside a user gesture (e.g., click) on iOS 13+
  let p1 = Promise.resolve('granted');
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    p1 = DeviceMotionEvent.requestPermission().catch(() => 'denied');
  }
  let p2 = Promise.resolve('granted');
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    p2 = DeviceOrientationEvent.requestPermission().catch(() => 'denied');
  }
  return Promise.all([p1, p2]).then(([m, o]) => (m === 'granted' && o === 'granted'));
}

// ===== Support Introspection =====
function getSupportStatus() {
  return {
    orientation: typeof window !== 'undefined' && 'DeviceOrientationEvent' in window,
    motion: typeof window !== 'undefined' && 'DeviceMotionEvent' in window,
    notes: (function(){
      const arr = [];
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        arr.push('iOS permission required');
      }
      if (!('DeviceMotionEvent' in window) && !('DeviceOrientationEvent' in window)) {
        arr.push('No sensor events available');
      }
      return arr;
    })()
  };
}

// ===== Event Listeners (broadest support) =====
function onDeviceOrientation(evt) {
  lastOri.alpha = (evt.alpha == null) ? lastOri.alpha : evt.alpha; // [0,360)
  lastOri.beta  = (evt.beta  == null) ? lastOri.beta  : evt.beta;  // [-180,180]
  lastOri.gamma = (evt.gamma == null) ? lastOri.gamma : evt.gamma; // [-90,90]
  lastOri.absolute = !!evt.absolute;
  lastOri.ts = now();
}

function onDeviceMotion(evt) {
  const dm = evt.acceleration;
  const dmg = evt.accelerationIncludingGravity;
  const rr = evt.rotationRate || {};

  // Prefer gravity-free acceleration if provided
  if (dm && (dm.x != null || dm.y != null || dm.z != null)) {
    lastMotion.ax = dm.x; lastMotion.ay = dm.y; lastMotion.az = dm.z;
  } else if (dmg && (dmg.x != null || dmg.y != null || dmg.z != null)) {
    // High-pass filter to estimate linear acceleration from includingGravity
    gravity.x = GRAVITY_LP_ALPHA * gravity.x + (1 - GRAVITY_LP_ALPHA) * (dmg.x || 0);
    gravity.y = GRAVITY_LP_ALPHA * gravity.y + (1 - GRAVITY_LP_ALPHA) * (dmg.y || 0);
    gravity.z = GRAVITY_LP_ALPHA * gravity.z + (1 - GRAVITY_LP_ALPHA) * (dmg.z || 0);
    lastMotion.ax = (dmg.x || 0) - gravity.x;
    lastMotion.ay = (dmg.y || 0) - gravity.y;
    lastMotion.az = (dmg.z || 0) - gravity.z;
  }

  lastMotion.aix = (dmg && dmg.x != null) ? dmg.x : lastMotion.aix;
  lastMotion.aiy = (dmg && dmg.y != null) ? dmg.y : lastMotion.aiy;
  lastMotion.aiz = (dmg && dmg.z != null) ? dmg.z : lastMotion.aiz;

  lastMotion.rrAlpha = (rr.alpha != null) ? rr.alpha : lastMotion.rrAlpha; // deg/s
  lastMotion.rrBeta  = (rr.beta  != null) ? rr.beta  : lastMotion.rrBeta;
  lastMotion.rrGamma = (rr.gamma != null) ? rr.gamma : lastMotion.rrGamma;

  lastMotion.ts = now();
}

function attachListeners() {
  if (typeof window === 'undefined') return;
  if ('DeviceOrientationEvent' in window) {
    window.addEventListener('deviceorientation', onDeviceOrientation, true);
  }
  if ('DeviceMotionEvent' in window) {
    window.addEventListener('devicemotion', onDeviceMotion, true);
  }
}

function detachListeners() {
  if (typeof window === 'undefined') return;
  if ('DeviceOrientationEvent' in window) {
    window.removeEventListener('deviceorientation', onDeviceOrientation, true);
  }
  if ('DeviceMotionEvent' in window) {
    window.removeEventListener('devicemotion', onDeviceMotion, true);
  }
}

// ===== Sampling Loop =====
function sampleOnce() {
  ensureBaselines();

  // Orientation normalization relative to baseline
  const aN = (baseline.alpha == null || lastOri.alpha == null) ? 0 : normAngleDelta(lastOri.alpha, baseline.alpha);
  const bN = (baseline.beta  == null || lastOri.beta  == null)  ? 0 : clamp01(Math.abs(lastOri.beta  - baseline.beta ) / FULL_TILT_DEG);
  const gN = (baseline.gamma == null || lastOri.gamma == null) ? 0 : clamp01(Math.abs(lastOri.gamma - baseline.gamma) / FULL_TILT_DEG);

  // Linear acceleration magnitude normalization
  const aMag = vecMag(lastMotion.ax, lastMotion.ay, lastMotion.az);
  const accelN = clamp01((aMag || 0) / MAX_LINEAR_ACCEL);

  // Gyro magnitude normalization (deg/s)
  const gMag = vecMag(lastMotion.rrAlpha, lastMotion.rrBeta, lastMotion.rrGamma);
  const gyroN = clamp01((gMag || 0) / MAX_GYRO_DPS);

  // Orientation delta magnitude as additional motion proxy
  const orientDeltaN = clamp01((aN + bN + gN) / 3);

  // Composite per-sample motion metric
  const perSampleMotion = clamp01(
    MOTION_WEIGHTS.accel * accelN +
    MOTION_WEIGHTS.gyro  * gyroN +
    MOTION_WEIGHTS.orient * orientDeltaN
  );

  motionBuffer.push({ t: now(), v: perSampleMotion });
  const motionAgg = computeMotionAggregate();

  latestSnapshot.alpha = aN;
  latestSnapshot.beta  = bN;
  latestSnapshot.gamma = gN;
  latestSnapshot.accel = accelN;
  latestSnapshot.gyro  = gyroN;
  latestSnapshot.motion = motionAgg;

  return latestSnapshot;
}

function startTimer() {
  const periodMs = Math.max(1, Math.floor(1000 / Math.max(1, freqHz)));
  if (timerId) clearInterval(timerId);
  timerId = setInterval(sampleOnce, periodMs);
}

// ===== Public API =====
export function getMovement(requestedFreqHz = 60) {
  if (!recording) {
    attachListeners();
    recording = true;
    freqHz = (requestedFreqHz && isFinite(requestedFreqHz)) ? requestedFreqHz : DEFAULT_FREQ_HZ;
    startTimer();
  } else if (requestedFreqHz && isFinite(requestedFreqHz) && requestedFreqHz !== freqHz) {
    freqHz = requestedFreqHz;
    startTimer();
  }
  // Always return the latest snapshot; fields are guaranteed in [0,1]
  return { ...latestSnapshot };
}

function stopRecording() {
  recording = false;
  if (timerId) { clearInterval(timerId); timerId = null; }
  detachListeners();
}

function startRecording(requestedFreqHz) {
  // Convenience explicit starter; mirrors getMovement side-effect
  return getMovement(requestedFreqHz);
}

