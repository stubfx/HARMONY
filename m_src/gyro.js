export function startGyro(freq = 1, cb) {
    // const s = new RelativeOrientationSensor({ frequency: freq });
    // s.addEventListener("reading", () => {
    //     const q = s.quaternion;           // [x, y, z, w]
    //     console.log(q);
    // });
    // s.start();
    window.addEventListener("deviceorientation", e => {
        cb({a: e.alpha, b: e.beta, g: e.gamma});   // yaw, pitch, roll
    });
}
