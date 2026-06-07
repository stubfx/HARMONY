// ─── Game of Life step ────────────────────────────────────────────────────────
// Conway's rules on a toroidal grid. Reads the current state (alive = r > 0.5)
// from inTex, counts the 8 wrapped neighbours, and writes the next generation.
// Rendered into a scratch texture, then copied back over the state texture so the
// particle compute shader always reads from a single, stable binding.

@group(0) @binding(0) var inTex: texture_2d<f32>;

// seed changes every generation; spark = per-cell probability of a random birth.
struct GolParams { seed: u32, spark: f32, _p0: u32, _p1: u32 }
@group(0) @binding(1) var<uniform> gp: GolParams;

fn rngCell(x: u32, y: u32, seed: u32) -> f32 {
    var h = x * 374761393u + y * 668265263u + seed * 2246822519u;
    h = (h ^ (h >> 13u)) * 1274126177u;
    h = h ^ (h >> 16u);
    return f32(h) * (1.0 / 4294967296.0);
}

struct V { @builtin(position) pos: vec4<f32> }

@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
    var pts = array<vec2<f32>, 3>(vec2(-1., 3.), vec2(3., -1.), vec2(-1., -1.));
    return V(vec4<f32>(pts[i], 0., 1.));
}

fn aliveAt(c: vec2<i32>, dims: vec2<i32>) -> i32 {
    let w = ((c.x % dims.x) + dims.x) % dims.x;   // toroidal wrap
    let h = ((c.y % dims.y) + dims.y) % dims.y;
    let v = textureLoad(inTex, vec2<i32>(w, h), 0).r;
    return select(0, 1, v > 0.5);
}

@fragment fn fs(v: V) -> @location(0) vec4<f32> {
    let dims = vec2<i32>(textureDimensions(inTex, 0));
    let c    = vec2<i32>(i32(floor(v.pos.x)), i32(floor(v.pos.y)));

    var n = 0;
    n += aliveAt(c + vec2<i32>(-1, -1), dims);
    n += aliveAt(c + vec2<i32>( 0, -1), dims);
    n += aliveAt(c + vec2<i32>( 1, -1), dims);
    n += aliveAt(c + vec2<i32>(-1,  0), dims);
    n += aliveAt(c + vec2<i32>( 1,  0), dims);
    n += aliveAt(c + vec2<i32>(-1,  1), dims);
    n += aliveAt(c + vec2<i32>( 0,  1), dims);
    n += aliveAt(c + vec2<i32>( 1,  1), dims);

    let cur = aliveAt(c, dims);
    // Survive with 2 or 3 live neighbours; a dead cell is born with exactly 3.
    var next = 0.0;
    if (cur == 1 && (n == 2 || n == 3)) { next = 1.0; }
    if (cur == 0 && n == 3)             { next = 1.0; }
    // Random "spark": inject a few births each generation so the automaton never
    // freezes into still lifes and oscillators. spark = 0 → pure Conway.
    if (gp.spark > 0.0 && rngCell(u32(c.x), u32(c.y), gp.seed) < gp.spark) {
        next = 1.0;
    }
    return vec4<f32>(next, next, next, 1.0);
}
