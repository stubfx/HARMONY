// ─── Normalize + Clear Compute Shader ────────────────────────────────────────
// Runs once per frame AFTER deposit.wgsl.
// Converts the atomic integer accumulator to a float r32float storage texture
// and resets each cell to 0 in the same pass (no separate clear needed).
//
// Struct layout (16 bytes):
//   [0]  trailWidth  u32
//   [4]  trailHeight u32
//   [8]  _pad0       u32
//   [12] _pad1       u32

struct NormParams {
    trailWidth:  u32,
    trailHeight: u32,
    _pad0:       u32,
    _pad1:       u32,
}

@group(0) @binding(0) var<uniform>             params:     NormParams;
@group(0) @binding(1) var<storage, read_write> accum:      array<atomic<i32>>;
@group(0) @binding(2) var                      depositTex: texture_storage_2d<r32float, write>;

const SCALE: f32 = 1024.0;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let tx = gid.x;
    let ty = gid.y;
    if (tx >= params.trailWidth || ty >= params.trailHeight) { return; }

    let idx  = ty * params.trailWidth + tx;
    let ival = atomicLoad(&accum[idx]);
    let fval = f32(ival) / SCALE;

    textureStore(depositTex, vec2<i32>(i32(tx), i32(ty)), vec4<f32>(fval, 0.0, 0.0, 1.0));

    // Clear for next frame in the same pass — saves an extra dispatch
    atomicStore(&accum[idx], 0i);
}
