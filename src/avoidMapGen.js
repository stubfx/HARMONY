// Animated Voronoi avoidance-map generator.
// A GRID×GRID tiling of Voronoi cells whose feature points move with two
// independent sinusoidal frequencies each — conceptually a 4-dimensional
// parameter space (x, y, ω1·t, ω2·t) that produces continuously evolving
// Chladni-like nodal patterns.

const W     = 256;
const H     = 256;
const GRID  = 4;     // cells per axis (4×4 = 16 cells)
const THRESH = 0.06; // F2-F1 threshold for nodal-line membership
const SOFT   = 0.02; // antialiasing width around threshold

export function createAvoidMapGen() {
    const canvas = new OffscreenCanvas(W, H);
    const ctx    = canvas.getContext('2d');
    const img    = ctx.createImageData(W, H);
    const buf    = img.data;

    // Random seed per cell — stable across the session
    const N      = GRID * GRID;
    const freq1  = new Float32Array(N);
    const phase1 = new Float32Array(N);
    const freq2  = new Float32Array(N);
    const phase2 = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        freq1[i]  = 0.05 + Math.random() * 0.15;  // 0.05–0.20 rad/s  (~30–126 s period)
        phase1[i] = Math.random() * Math.PI * 2;
        freq2[i]  = 0.04 + Math.random() * 0.10;  // 0.04–0.14 rad/s
        phase2[i] = Math.random() * Math.PI * 2;
    }

    // Extended grid (GRID+2)² to handle wrap-around in one flat array
    const EX  = GRID + 2;
    const ptx = new Float32Array(EX * EX);
    const pty = new Float32Array(EX * EX);

    function update(t) {
        // Recompute feature-point positions for this frame
        for (let gy = -1; gy <= GRID; gy++) {
            for (let gx = -1; gx <= GRID; gx++) {
                const wx  = ((gx % GRID) + GRID) % GRID;
                const wy  = ((gy % GRID) + GRID) % GRID;
                const ci  = wy * GRID + wx;
                const ox  = 0.5 + 0.45 * Math.sin(freq1[ci] * t + phase1[ci]);
                const oy  = 0.5 + 0.45 * Math.cos(freq2[ci] * t + phase2[ci]);
                const idx = (gy + 1) * EX + (gx + 1);
                ptx[idx]  = (gx + ox) / GRID;
                pty[idx]  = (gy + oy) / GRID;
            }
        }

        // Render pixels
        let bi = 0;
        for (let y = 0; y < H; y++) {
            const py  = y / H;
            const gy0 = Math.floor(py * GRID);
            for (let x = 0; x < W; x++) {
                const px  = x / W;
                const gx0 = Math.floor(px * GRID);
                let f1 = 1e9, f2 = 1e9;

                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const exi = (gy0 + dy + 1) * EX + (gx0 + dx + 1);
                        const qx  = ptx[exi] - px;
                        const qy  = pty[exi] - py;
                        const d   = qx * qx + qy * qy;
                        if (d < f1)      { f2 = f1; f1 = d; }
                        else if (d < f2) { f2 = d; }
                    }
                }

                const edge = Math.sqrt(f2) - Math.sqrt(f1);
                // Soft threshold: 0 = fully inside cell, 1 = on nodal line
                const v = Math.round(Math.max(0, Math.min(1, (THRESH - edge) / SOFT)) * 255);
                buf[bi++] = v;
                buf[bi++] = v;
                buf[bi++] = v;
                buf[bi++] = 255;
            }
        }

        ctx.putImageData(img, 0, 0);
        return canvas;
    }

    return { update, canvas, width: W, height: H };
}
