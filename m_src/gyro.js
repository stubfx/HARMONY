/**
 * requestMotionOrientationPermission() -> Promise<boolean>
 * Call this from a user gesture (tap/click/keydown) on iOS to enable sensors.
 * Returns true if any permission was granted or not required.
 */
export async function requestMotionOrientationPermission() {
  let granted = false;
  try {
    if (typeof DeviceMotionEvent !== "undefined" &&
        typeof DeviceMotionEvent.requestPermission === "function") {
      granted = (await DeviceMotionEvent.requestPermission()) === "granted" || granted;
    }
  } catch {}
  try {
    if (typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function") {
      granted = (await DeviceOrientationEvent.requestPermission()) === "granted" || granted;
    }
  } catch {}
  return granted;
}

/**
 * startDeviceTilt(frequencyHz, cb) -> stop()
 * cb(payload):
 *  - enabled: true  => { a, b, g, motion, enabled:true }  // a/b/g,motion ∈ [0,1]
 *  - enabled: false => { enabled:false }                  // keep emitting; never auto-stop
 */
export function startDeviceTilt(frequencyHz, cb) {
  if (typeof cb !== "function") throw new Error("callback required");

  // config
  const freq = Number.isFinite(frequencyHz) && frequencyHz > 0 ? Math.min(frequencyHz, 60) : 30;
  const intervalMs = 1000 / freq;

  const decaySec = 1.0;        // EMA for "recent tilt" → motion
  const angleSmoothSec = 0.08; // EMA for displayed a/b/g
  const agcFallSec = 2.0;      // AGC peak decay
  const minRefDegPerSec = 30;  // normalization floor
  const deadbandDegPerSec = 2; // ignore tiny angular speeds (noise)
  const zeroSnap = 1e-3;       // snap motion to zero below this
  const agcTarget = 0.8;       // ~0.8×peak ⇒ normSpeed≈1

  // helpers
  const DEG2RAD = Math.PI / 180;
  const TAU = 2 * Math.PI;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const expDecay = (dt, tau) => Math.exp(-Math.max(0, dt) / Math.max(1e-6, tau));
  const norm2 = (x, y) => { const n = Math.hypot(x, y) || 1; return [x / n, y / n]; };
  const wrapTau = (r) => { r %= TAU; return r < 0 ? r + TAU : r; };
  const qMul = (a, b) => [
    a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3],
    a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2],
    a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1],
    a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0],
  ];
  const qFromEulerZXY = (aDeg, bDeg, gDeg) => {
    const hz = (aDeg * DEG2RAD) / 2, hx = (bDeg * DEG2RAD) / 2, hy = (gDeg * DEG2RAD) / 2;
    const qz = [Math.cos(hz), 0, 0, Math.sin(hz)];
    const qx = [Math.cos(hx), Math.sin(hx), 0, 0];
    const qy = [Math.cos(hy), 0, Math.sin(hy), 0];
    return qMul(qMul(qz, qx), qy); // Rz * Rx * Ry
  };

  // state
  let stopped = false;
  let enabled = false;

  let prevQ = null;
  let prevEventT = null;
  let lastDecayT = performance.now() * 1e-3;
  let motion = 0;

  // a/b/g smoothing
  let yawVec = [1, 0]; // cosθ, sinθ
  let pitchNorm = 0.5;
  let rollNorm  = 0.5;

  // yaw sources
  let lastDOEvt = null;
  let alphaPrev = null, alphaStuckCount = 0;
  const ALPHA_EPS = 0.5, STUCK_N = 15;
  let gyroYaw = 0, gyroT = null;

  // AGC
  const minRef = minRefDegPerSec * DEG2RAD;
  const deadband = deadbandDegPerSec * DEG2RAD;
  let speedPeak = minRef;

  // handlers
  const onDO = (e) => {
    if (stopped) return;
    lastDOEvt = e;

    const aDeg = e.alpha, bDeg = e.beta, gDeg = e.gamma;
    if (bDeg == null || gDeg == null) return;

    if (aDeg != null) {
      if (alphaPrev == null) alphaPrev = aDeg;
      const d = ((aDeg - alphaPrev + 540) % 360) - 180;
      if (Math.abs(d) < ALPHA_EPS) alphaStuckCount++; else alphaStuckCount = 0;
      alphaPrev = aDeg;
    }

    const now = performance.now() * 1e-3;
    const dt = prevEventT == null ? 0 : Math.max(0, now - prevEventT);
    prevEventT = now;

    const q = qFromEulerZXY(aDeg || 0, bDeg, gDeg);
    if (prevQ) {
      let dot = prevQ[0]*q[0] + prevQ[1]*q[1] + prevQ[2]*q[2] + prevQ[3]*q[3];
      dot = Math.min(1, Math.max(-1, Math.abs(dot)));
      const deltaAngle = 2 * Math.acos(dot);          // rad
      const rawSpeed = dt > 0 ? deltaAngle / dt : 0;  // rad/s

      const effSpeed = Math.max(0, rawSpeed - deadband);
      speedPeak = Math.max(effSpeed, speedPeak * expDecay(dt, agcFallSec));
      if (speedPeak < minRef) speedPeak = minRef;

      const ref = Math.max(minRef, agcTarget * speedPeak);
      const normSpeed = ref > 0 ? clamp01(effSpeed / ref) : 0;

      const a = expDecay(dt, decaySec);
      motion = motion * a + (1 - a) * normSpeed;
    }
    prevQ = q;

    const aa = expDecay(dt, angleSmoothSec);
    pitchNorm = aa * pitchNorm + (1 - aa) * clamp01((bDeg + 180) / 360);
    rollNorm  = aa * rollNorm  + (1 - aa) * clamp01((gDeg + 90) / 180);

    lastDecayT = now;
    enabled = true;
  };

  const onDM = (e) => {
    if (stopped) return;
    if (!e.rotationRate || e.rotationRate.alpha == null) return;
    const now = performance.now() * 1e-3;
    const dt = e.interval ? e.interval / 1000 : (gyroT == null ? 0 : Math.max(0, now - gyroT));
    gyroT = now;
    gyroYaw = wrapTau(gyroYaw + (e.rotationRate.alpha * DEG2RAD) * dt);
  };

  // attach listeners (keep running even if the APIs are missing)
  if (typeof window !== "undefined") {
    if (typeof DeviceOrientationEvent !== "undefined") {
      window.addEventListener("deviceorientation", onDO, { passive: true });
    }
    if (typeof DeviceMotionEvent !== "undefined") {
      window.addEventListener("devicemotion", onDM, { passive: true });
    }
  }

  // emit loop — never auto-stops
  const intervalId = setInterval(() => {
    if (stopped) return;

    const now = performance.now() * 1e-3;
    const dtInc = Math.max(0, now - lastDecayT);
    motion *= expDecay(dtInc, decaySec);
    if (motion < zeroSnap) motion = 0;
    lastDecayT = now;

    if (!enabled) { cb({ enabled: false }); return; }

    // yaw: compass > alpha (if not stuck) > gyro
    let yawRad = 0;
    if (lastDOEvt && typeof lastDOEvt.webkitCompassHeading === "number" && isFinite(lastDOEvt.webkitCompassHeading)) {
      yawRad = wrapTau(lastDOEvt.webkitCompassHeading * DEG2RAD);
    } else if (lastDOEvt && lastDOEvt.alpha != null && alphaStuckCount < STUCK_N) {
      yawRad = wrapTau(((lastDOEvt.alpha % 360) + 360) % 360 * DEG2RAD);
    } else {
      yawRad = gyroYaw;
    }

    const ay = expDecay(dtInc, angleSmoothSec);
    const yawNew = [Math.cos(yawRad), Math.sin(yawRad)];
    yawVec = norm2(ay * yawVec[0] + (1 - ay) * yawNew[0], ay * yawVec[1] + (1 - ay) * yawNew[1]);
    let aNorm = wrapTau(Math.atan2(yawVec[1], yawVec[0])) / TAU;
    if (aNorm >= 1) aNorm = 0;

    cb({ a: aNorm, b: pitchNorm, g: rollNorm, motion: clamp01(motion), enabled: true });
  }, intervalMs);

  return function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(intervalId);
    if (typeof window !== "undefined") {
      if (typeof DeviceOrientationEvent !== "undefined") {
        window.removeEventListener("deviceorientation", onDO);
      }
      if (typeof DeviceMotionEvent !== "undefined") {
        window.removeEventListener("devicemotion", onDM);
      }
    }
  };
}

