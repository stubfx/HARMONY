// ─── Raw WebGPU Simulation Engine ─────────────────────────────────────────────
// Owns ALL GPU resources: buffers, textures, pipelines, bind groups.
// Call init() once, then frame(params) every animation frame.

import simWGSL        from './shaders/sim.wgsl?raw';
import depositWGSL    from './shaders/deposit.wgsl?raw';
import normalizeWGSL  from './shaders/normalize.wgsl?raw';
import decayWGSL      from './shaders/decay.wgsl?raw';
import renderWGSL     from './shaders/render.wgsl?raw';
import bloomWGSL      from './shaders/bloom.wgsl?raw';
import blitWGSL       from './shaders/blit.wgsl?raw';

// ─── Uniform-buffer helpers ───────────────────────────────────────────────────
function makeUniformBuf(device, size) {
    return device.createBuffer({
        size,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
}

// Write a plain ArrayBuffer into a GPUBuffer at offset 0
function writeUniform(device, gpuBuf, arrayBuf) {
    device.queue.writeBuffer(gpuBuf, 0, arrayBuf);
}

export class Simulation {
    constructor(canvas) {
        this.canvas = canvas;
        this.device = null;
        this.context = null;

        // Dimensions
        this.W = 0; this.H = 0;
        this.trailW = 0; this.trailH = 0;
        this.agentCount = 0;

        // GPU resources
        this.agentBuf      = null;  // storage: [pos.xy, vel.xy] per agent
        this.accumBuf      = null;  // storage atomic<i32>: deposit accumulator
        this.depositTex    = null;  // r32float: normalised deposits this frame
        this.trailTexA     = null;  // r32float ping-pong
        this.trailTexB     = null;
        this.offscreenTex  = null;  // rgba8unorm: agent+trail render
        this.bloomTexA     = null;  // rgba16float: half-res bloom intermediate
        this.bloomTexB     = null;
        this.zeroAccumBuf  = null;  // COPY_SRC zeroed buf for accum reset (not used; reset in normalize)

        // Pipelines
        this.simPipeline        = null;
        this.depositPipeline    = null;
        this.normalizePipeline  = null;
        this.decayPipeline      = null;
        this.trailRenderPipeline= null;
        this.agentRenderPipeline= null;
        this.bloomDownPipeline  = null;
        this.bloomBlurPipeline  = null;
        this.blitPipeline       = null;

        // Uniform buffers
        this.simUB         = null;  // 64 bytes
        this.depositUB     = null;  // 48 bytes
        this.normalizeUB   = null;  // 16 bytes
        this.decayUB       = null;  // 64 bytes
        this.trailRenderUB = null;  // 32 bytes
        this.agentRenderUB = null;  // 64 bytes
        this.bloomDownUB   = null;  // 32 bytes – downsample pass
        this.bloomBlurHUB  = null;  // 32 bytes – H-blur pass
        this.bloomBlurVUB  = null;  // 32 bytes – V-blur pass
        this.blitUB        = null;  // 16 bytes

        // Samplers
        this.linearSampler  = null;
        this.screenSampler  = null;

        // Bind groups (A = trailA is "read", B = trailB is "read")
        this.simBG          = [null, null];   // [trailA as input, trailB as input]
        this.decayBG        = [null, null];   // [reads A writes B, reads B writes A]
        this.normalizeBG    = null;
        this.trailRenderBG  = [null, null];   // reads whichever trail was just written
        this.agentRenderBG  = null;
        this.bloomDownBG    = null;           // scene → bloomA
        this.bloomBlurHBG   = null;           // bloomA → bloomB  (H-blur)
        this.bloomBlurVBG   = null;           // bloomB → bloomA  (V-blur)
        this.blitBG         = null;           // scene + bloomA → canvas

        // Frame state
        this.trailIdx  = 0;          // 0 → read trailA, write trailB  |  1 → read trailB, write trailA
        this.frameCount = 0;

        // Media texture (optional B&W image or video)
        this.mediaTex  = null;
        this.mediaView = null;
        this.hasMedia  = false;
    }

    // ── Public: request WebGPU device and build all GPU resources ─────────────
    async init(agentCount, trailTexSize, canvasFormat) {
        if (!navigator.gpu) throw new Error('WebGPU not supported');
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) throw new Error('No WebGPU adapter found');
        this.device = await adapter.requestDevice();

        this.context = this.canvas.getContext('webgpu');
        this.context.configure({
            device: this.device,
            format: canvasFormat,
            alphaMode: 'opaque',
        });

        this.agentCount  = agentCount;
        this.trailTexSize = trailTexSize;
        this._resize();
        this._buildSamplers();
        await this._buildPipelines(canvasFormat);
        this._buildFrameResources();    // buffers/textures depend on W, H, trailW, trailH
        this._buildBindGroups();
    }

    // ── Resize: called on init and window resize ──────────────────────────────
    resize() {
        this._resize();
        this._buildFrameResources();
        this._buildBindGroups();
    }

    _resize() {
        this.W = this.canvas.width;
        this.H = this.canvas.height;
        // Trail texture: longest edge == trailTexSize, preserve aspect ratio
        const trailScale = Math.min(1, this.trailTexSize / Math.max(this.W, this.H));
        this.trailW = Math.max(1, Math.round(this.W * trailScale));
        this.trailH = Math.max(1, Math.round(this.H * trailScale));
    }

    // ── Samplers ──────────────────────────────────────────────────────────────
    _buildSamplers() {
        const d = this.device;
        this.linearSampler = d.createSampler({
            magFilter: 'linear', minFilter: 'linear',
            addressModeU: 'repeat', addressModeV: 'repeat',
        });
        this.screenSampler = d.createSampler({
            magFilter: 'linear', minFilter: 'linear',
            addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
        });
    }

    // ── Compile all pipelines (async shader compilation) ─────────────────────
    async _buildPipelines(canvasFormat) {
        const d = this.device;

        const simMod       = d.createShaderModule({ code: simWGSL });
        const depositMod   = d.createShaderModule({ code: depositWGSL });
        const normalizeMod = d.createShaderModule({ code: normalizeWGSL });
        const decayMod     = d.createShaderModule({ code: decayWGSL });
        const renderMod    = d.createShaderModule({ code: renderWGSL });
        const bloomMod     = d.createShaderModule({ code: bloomWGSL });
        const blitMod      = d.createShaderModule({ code: blitWGSL });

        // ── Compute pipelines ─────────────────────────────────────────────────
        this.simPipeline = d.createComputePipeline({
            layout: 'auto',
            compute: { module: simMod, entryPoint: 'main' },
        });
        this.depositPipeline = d.createComputePipeline({
            layout: 'auto',
            compute: { module: depositMod, entryPoint: 'main' },
        });
        this.normalizePipeline = d.createComputePipeline({
            layout: 'auto',
            compute: { module: normalizeMod, entryPoint: 'main' },
        });
        this.decayPipeline = d.createComputePipeline({
            layout: 'auto',
            compute: { module: decayMod, entryPoint: 'main' },
        });
        this.bloomDownPipeline = d.createComputePipeline({
            layout: 'auto',
            compute: { module: bloomMod, entryPoint: 'downsample' },
        });
        this.bloomBlurPipeline = d.createComputePipeline({
            layout: 'auto',
            compute: { module: bloomMod, entryPoint: 'blur' },
        });

        // ── Trail render pipeline (opaque, no blend) ──────────────────────────
        this.trailRenderPipeline = d.createRenderPipeline({
            layout: 'auto',
            vertex:   { module: renderMod, entryPoint: 'trailVs' },
            fragment: {
                module: renderMod, entryPoint: 'trailFs',
                targets: [{ format: 'rgba8unorm' }],
            },
            primitive: { topology: 'triangle-list' },
        });

        // ── Agent render pipeline (additive blend) ────────────────────────────
        this.agentRenderPipeline = d.createRenderPipeline({
            layout: 'auto',
            vertex:   { module: renderMod, entryPoint: 'agentVs' },
            fragment: {
                module: renderMod, entryPoint: 'agentFs',
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

        // ── Blit pipeline (to canvas swap-chain format) ───────────────────────
        this.blitPipeline = d.createRenderPipeline({
            layout: 'auto',
            vertex:   { module: blitMod, entryPoint: 'vs' },
            fragment: {
                module: blitMod, entryPoint: 'fs',
                targets: [{ format: canvasFormat }],
            },
            primitive: { topology: 'triangle-list' },
        });
    }

    // ── Create / recreate all size-dependent GPU resources ────────────────────
    _buildFrameResources() {
        const d = this.device;

        // Destroy previous resources if resizing
        this.agentBuf?.destroy();
        this.accumBuf?.destroy();
        this.depositTex?.destroy();
        this.trailTexA?.destroy();
        this.trailTexB?.destroy();
        this.offscreenTex?.destroy();
        this.bloomTexA?.destroy();
        this.bloomTexB?.destroy();

        // ── Agent buffer ──────────────────────────────────────────────────────
        const agentBytes = this.agentCount * 16; // vec4<f32>
        this.agentBuf = d.createBuffer({
            size:  agentBytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        // ── Accumulation buffer (atomic i32) ──────────────────────────────────
        const trailPx = this.trailW * this.trailH;
        this.accumBuf = d.createBuffer({
            size:  trailPx * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        // ── Deposit texture (r32float, written by normalize, read by decay) ───
        this.depositTex = d.createTexture({
            size:   [this.trailW, this.trailH],
            format: 'r32float',
            usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
                  | GPUTextureUsage.COPY_DST,
        });

        // ── Trail decay textures (ping-pong, r32float) ────────────────────────
        const trailUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
        this.trailTexA = d.createTexture({ size: [this.trailW, this.trailH], format: 'r32float', usage: trailUsage });
        this.trailTexB = d.createTexture({ size: [this.trailW, this.trailH], format: 'r32float', usage: trailUsage });

        // ── Off-screen render target (rgba8unorm) ─────────────────────────────
        this.offscreenTex = d.createTexture({
            size:   [this.W, this.H],
            format: 'rgba8unorm',
            usage:  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });

        // ── Bloom textures (half-res, rgba16float) ────────────────────────────
        const bW = Math.max(1, Math.floor(this.W / 2));
        const bH = Math.max(1, Math.floor(this.H / 2));
        this.bloomW = bW; this.bloomH = bH;
        const bloomUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
        this.bloomTexA = d.createTexture({ size: [bW, bH], format: 'rgba16float', usage: bloomUsage });
        this.bloomTexB = d.createTexture({ size: [bW, bH], format: 'rgba16float', usage: bloomUsage });

        // ── Uniform buffers ───────────────────────────────────────────────────
        this.simUB         = makeUniformBuf(d, 64);
        this.depositUB     = makeUniformBuf(d, 48);
        this.normalizeUB   = makeUniformBuf(d, 16);
        this.decayUB       = makeUniformBuf(d, 64);
        this.trailRenderUB = makeUniformBuf(d, 32);
        this.agentRenderUB = makeUniformBuf(d, 64);
        this.bloomDownUB   = makeUniformBuf(d, 32);
        this.bloomBlurHUB  = makeUniformBuf(d, 32);
        this.bloomBlurVUB  = makeUniformBuf(d, 32);
        this.blitUB        = makeUniformBuf(d, 16);

        // ── Ensure accum buf starts at 0 ─────────────────────────────────────
        // (GPU buffers are zero-initialised in WebGPU, so this is guaranteed)

        // Reset ping-pong index on resize
        this.trailIdx = 0;
    }

    // ── Build all bind groups (call after _buildFrameResources) ───────────────
    _buildBindGroups() {
        const d = this.device;

        const trailViews = [
            this.trailTexA.createView(),
            this.trailTexB.createView(),
        ];

        // ── Sim bind groups (one per ping-pong state) ─────────────────────────
        // simBG[i] reads trailTex[i] as the current decay trail
        for (let i = 0; i < 2; i++) {
            this.simBG[i] = d.createBindGroup({
                layout: this.simPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.simUB } },
                    { binding: 1, resource: { buffer: this.agentBuf } },
                    { binding: 2, resource: this.linearSampler },
                    { binding: 3, resource: trailViews[i] },
                ],
            });
        }

        // ── Deposit bind group ────────────────────────────────────────────────
        this.depositBG = d.createBindGroup({
            layout: this.depositPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.depositUB } },
                { binding: 1, resource: { buffer: this.agentBuf } },
                { binding: 2, resource: { buffer: this.accumBuf } },
            ],
        });

        // ── Normalize bind group ──────────────────────────────────────────────
        this.normalizeBG = d.createBindGroup({
            layout: this.normalizePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.normalizeUB } },
                { binding: 1, resource: { buffer: this.accumBuf } },
                { binding: 2, resource: this.depositTex.createView() },
            ],
        });

        // ── Decay bind groups (A→B, B→A) ─────────────────────────────────────
        const depositView = this.depositTex.createView();
        const mediaView   = this._getMediaView();

        for (let i = 0; i < 2; i++) {
            const readView  = trailViews[i];
            const writeView = trailViews[1 - i]; // storage write
            this.decayBG[i] = d.createBindGroup({
                layout: this.decayPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.decayUB } },
                    { binding: 1, resource: this.linearSampler },
                    { binding: 2, resource: readView },
                    { binding: 3, resource: depositView },
                    { binding: 4, resource: this.linearSampler },
                    { binding: 5, resource: mediaView },
                    { binding: 6, resource: writeView },
                ],
            });
        }

        // ── Trail render bind groups (reads the freshly-written trail) ────────
        // After decay writes trailTex[1-trailIdx], scene reads trailTex[1-trailIdx]
        for (let i = 0; i < 2; i++) {
            this.trailRenderBG[i] = d.createBindGroup({
                layout: this.trailRenderPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.trailRenderUB } },
                    { binding: 1, resource: this.linearSampler },
                    { binding: 2, resource: trailViews[i] },
                ],
            });
        }

        // ── Agent render bind group ───────────────────────────────────────────
        this.agentRenderBG = d.createBindGroup({
            layout: this.agentRenderPipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: this.agentRenderUB } },
                { binding: 1, resource: { buffer: this.agentBuf } },
            ],
        });

        // ── Bloom bind groups ─────────────────────────────────────────────────
        const sceneView  = this.offscreenTex.createView();
        const bloomAView = this.bloomTexA.createView();
        const bloomBView = this.bloomTexB.createView();

        // Downsample: scene → bloomA
        this.bloomDownBG = d.createBindGroup({
            layout: this.bloomDownPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.bloomDownUB } },
                { binding: 1, resource: this.screenSampler },
                { binding: 2, resource: sceneView },
                { binding: 3, resource: bloomAView },
            ],
        });
        // H-blur: bloomA → bloomB
        this.bloomBlurHBG = d.createBindGroup({
            layout: this.bloomBlurPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.bloomBlurHUB } },
                { binding: 1, resource: this.screenSampler },
                { binding: 2, resource: bloomAView },
                { binding: 3, resource: bloomBView },
            ],
        });
        // V-blur: bloomB → bloomA
        this.bloomBlurVBG = d.createBindGroup({
            layout: this.bloomBlurPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.bloomBlurVUB } },
                { binding: 1, resource: this.screenSampler },
                { binding: 2, resource: bloomBView },
                { binding: 3, resource: bloomAView },
            ],
        });

        // ── Blit bind group ───────────────────────────────────────────────────
        this.blitBG = d.createBindGroup({
            layout: this.blitPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.blitUB } },
                { binding: 1, resource: this.screenSampler },
                { binding: 2, resource: sceneView },
                { binding: 3, resource: bloomAView },
            ],
        });
    }

    // ── Fallback 1×1 white media texture when no image/video is loaded ────────
    _getMediaView() {
        if (this.mediaView) return this.mediaView;
        const d = this.device;
        if (!this._dummyMediaTex) {
            this._dummyMediaTex = d.createTexture({
                size: [1, 1], format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            d.queue.writeTexture(
                { texture: this._dummyMediaTex },
                new Uint8Array([255, 255, 255, 255]),
                { bytesPerRow: 4 }, [1, 1]
            );
        }
        return this._dummyMediaTex.createView();
    }

    // ── Load an ImageBitmap (from <img> or <video> frame) as media texture ────
    loadMedia(imageBitmap) {
        const d = this.device;
        const w = imageBitmap.width;
        const h = imageBitmap.height;

        if (!this.mediaTex || this.mediaTex.width !== w || this.mediaTex.height !== h) {
            this.mediaTex?.destroy();
            this.mediaTex = d.createTexture({
                size: [w, h], format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
                     | GPUTextureUsage.RENDER_ATTACHMENT,
            });
        }
        d.queue.copyExternalImageToTexture(
            { source: imageBitmap },
            { texture: this.mediaTex },
            [w, h]
        );
        this.mediaView = this.mediaTex.createView();
        this.hasMedia  = true;
        // Rebuild bind groups that reference mediaTex
        this._buildBindGroups();
    }

    clearMedia() {
        this.hasMedia  = false;
        this.mediaView = null;
        this._buildBindGroups();
    }

    // ── Seed agent buffer from CPU ────────────────────────────────────────────
    seedAgents(spawnRadius) {
        const N    = this.agentCount;
        const data = new Float32Array(N * 4);
        const cx   = this.W / 2;
        const cy   = this.H / 2;
        const R    = spawnRadius;
        for (let i = 0; i < N; i++) {
            const k     = i * 4;
            const theta = Math.random() * Math.PI * 2;
            const r     = Math.sqrt(Math.random()) * R;
            data[k]     = cx + r * Math.cos(theta);   // pos.x
            data[k + 1] = cy + r * Math.sin(theta);   // pos.y
            data[k + 2] = (Math.random() - 0.5);       // vel.x
            data[k + 3] = (Math.random() - 0.5);       // vel.y
        }
        this.device.queue.writeBuffer(this.agentBuf, 0, data);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MAIN RENDER FRAME
    // params: { dt, time, frameCount, stepLen, drag, turnJitter, senseDist,
    //           senseAngle, turnRate, depositSize, depositStrength,
    //           depositEdgeSoft, champInterval, champMultiplier, trailDecay,
    //           pointSize, primaryColor{r,g,b}, secondaryColor{r,g,b},
    //           secondaryAmount, tertiaryColor{r,g,b}, tertiaryAmount,
    //           showTrail, trailBrightness, bloomStrength, bloomThreshold,
    //           bloomRadius, gamma, mouseDown, mouseX, mouseY, mouseRadius,
    //           nuke, mediaStrength, imageArea, imageReveal }
    // ─────────────────────────────────────────────────────────────────────────
    frame(p) {
        const d = this.device;
        const ci = this.trailIdx;       // current: sim reads this trail
        const ni = 1 - ci;              // next:    decay writes this trail

        // ── Write uniform buffers ──────────────────────────────────────────────
        this._writeSimUB(p);
        this._writeDepositUB(p);
        this._writeNormalizeUB();
        this._writeDecayUB(p);
        this._writeTrailRenderUB(p);
        this._writeAgentRenderUB(p);
        this._writeBloomUB(p);
        this._writeBlitUB(p);

        // ── Encode command buffer ──────────────────────────────────────────────
        const enc = d.createCommandEncoder();

        // 1. Simulation compute
        {
            const pass = enc.beginComputePass();
            pass.setPipeline(this.simPipeline);
            pass.setBindGroup(0, this.simBG[ci]);
            pass.dispatchWorkgroups(Math.ceil(this.agentCount / 64));
            pass.end();
        }

        // 2. Deposit compute (accumulate into accumBuf)
        {
            const pass = enc.beginComputePass();
            pass.setPipeline(this.depositPipeline);
            pass.setBindGroup(0, this.depositBG);
            pass.dispatchWorkgroups(Math.ceil(this.agentCount / 64));
            pass.end();
        }

        // 3. Normalize compute (accumBuf → depositTex, clear accumBuf)
        {
            const pass = enc.beginComputePass();
            pass.setPipeline(this.normalizePipeline);
            pass.setBindGroup(0, this.normalizeBG);
            pass.dispatchWorkgroups(
                Math.ceil(this.trailW / 8),
                Math.ceil(this.trailH / 8)
            );
            pass.end();
        }

        // 4. Decay compute (trailRead + depositTex → trailWrite)
        {
            const pass = enc.beginComputePass();
            pass.setPipeline(this.decayPipeline);
            pass.setBindGroup(0, this.decayBG[ci]);
            pass.dispatchWorkgroups(
                Math.ceil(this.trailW / 8),
                Math.ceil(this.trailH / 8)
            );
            pass.end();
        }

        // 5. Scene render (trail background + agents → offscreenTex)
        {
            const pass = enc.beginRenderPass({
                colorAttachments: [{
                    view:       this.offscreenTex.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp:     'clear',
                    storeOp:    'store',
                }],
            });

            // 5a. Trail background (only if SHOW_TRAIL)
            if (p.showTrail) {
                pass.setPipeline(this.trailRenderPipeline);
                pass.setBindGroup(0, this.trailRenderBG[ni]);
                pass.draw(3); // fullscreen triangle
            }

            // 5b. Agent quads (additive blend)
            pass.setPipeline(this.agentRenderPipeline);
            pass.setBindGroup(1, this.agentRenderBG);
            pass.draw(this.agentCount * 6);
            pass.end();
        }

        // 6. Bloom: downsample → H-blur → V-blur
        {
            const bwg = [Math.ceil(this.bloomW / 8), Math.ceil(this.bloomH / 8)];

            const down = enc.beginComputePass();
            down.setPipeline(this.bloomDownPipeline);
            down.setBindGroup(0, this.bloomDownBG);
            down.dispatchWorkgroups(...bwg);
            down.end();

            const blurH = enc.beginComputePass();
            blurH.setPipeline(this.bloomBlurPipeline);
            blurH.setBindGroup(0, this.bloomBlurHBG);
            blurH.dispatchWorkgroups(...bwg);
            blurH.end();

            const blurV = enc.beginComputePass();
            blurV.setPipeline(this.bloomBlurPipeline);
            blurV.setBindGroup(0, this.bloomBlurVBG);
            blurV.dispatchWorkgroups(...bwg);
            blurV.end();
        }

        // 7. Blit to canvas
        {
            const swapTex = this.context.getCurrentTexture();
            const pass = enc.beginRenderPass({
                colorAttachments: [{
                    view:       swapTex.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp:     'clear',
                    storeOp:    'store',
                }],
            });
            pass.setPipeline(this.blitPipeline);
            pass.setBindGroup(0, this.blitBG);
            pass.draw(3);
            pass.end();
        }

        d.queue.submit([enc.finish()]);

        // ── Swap ping-pong ─────────────────────────────────────────────────────
        this.trailIdx = ni;
        this.frameCount++;
    }

    // ─── Uniform-buffer writers ───────────────────────────────────────────────
    _writeSimUB(p) {
        const ab = new ArrayBuffer(64);
        const u  = new Uint32Array(ab);
        const f  = new Float32Array(ab);
        u[0] = this.agentCount;
        u[1] = this.trailW;
        u[2] = this.trailH;
        u[3] = this.frameCount;
        f[4] = this.W;
        f[5] = this.H;
        f[6] = p.dt;
        f[7] = p.time;
        f[8] = p.stepLen;
        f[9] = p.drag;
        f[10]= p.turnJitter;
        f[11]= p.senseDist;
        f[12]= p.senseAngle;
        f[13]= p.turnRate;
        writeUniform(this.device, this.simUB, ab);
    }

    _writeDepositUB(p) {
        const ab = new ArrayBuffer(48);
        const u  = new Uint32Array(ab);
        const f  = new Float32Array(ab);
        u[0] = this.agentCount;
        u[1] = this.trailW;
        u[2] = this.trailH;
        u[3] = p.champInterval | 0;
        f[4] = this.W;
        f[5] = this.H;
        f[6] = p.depositSize;
        f[7] = p.depositStrength;
        f[8] = p.depositEdgeSoft;
        f[9] = p.champMultiplier;
        f[10]= p.dt;
        writeUniform(this.device, this.depositUB, ab);
    }

    _writeNormalizeUB() {
        const ab = new ArrayBuffer(16);
        const u  = new Uint32Array(ab);
        u[0] = this.trailW;
        u[1] = this.trailH;
        writeUniform(this.device, this.normalizeUB, ab);
    }

    _writeDecayUB(p) {
        const ab = new ArrayBuffer(64);
        const u  = new Uint32Array(ab);
        const f  = new Float32Array(ab);
        u[0] = this.trailW;
        u[1] = this.trailH;
        f[2] = this.W;
        f[3] = this.H;
        f[4] = p.trailDecay;
        f[5] = p.dt;
        u[6] = this.hasMedia ? 1 : 0;
        u[7] = p.nuke ? 1 : 0;
        u[8] = p.mouseDown ? 1 : 0;
        // u[9] = pad
        f[10]= p.mouseX ?? 0;
        f[11]= p.mouseY ?? 0;
        f[12]= p.mouseRadius ?? 80;
        f[13]= p.mediaStrength ?? 1.0;
        f[14]= p.imageArea ?? 400;
        f[15]= p.imageReveal ?? 300;
        writeUniform(this.device, this.decayUB, ab);
    }

    _writeTrailRenderUB(p) {
        const ab = new ArrayBuffer(32);
        const f  = new Float32Array(ab);
        f[0] = this.W;
        f[1] = this.H;
        f[2] = p.trailBrightness ?? 0.002;
        f[3] = p.showTrail ? 1.0 : 0.0;
        f[4] = p.trailColor?.r ?? 1.0;
        f[5] = p.trailColor?.g ?? 1.0;
        f[6] = p.trailColor?.b ?? 1.0;
        writeUniform(this.device, this.trailRenderUB, ab);
    }

    _writeAgentRenderUB(p) {
        const ab = new ArrayBuffer(64);
        const u  = new Uint32Array(ab);
        const f  = new Float32Array(ab);
        u[0] = this.agentCount;
        f[1] = this.W;
        f[2] = this.H;
        f[3] = p.pointSize;
        f[4] = p.COLOR.POINT_COLOR.r;
        f[5] = p.COLOR.POINT_COLOR.g;
        f[6] = p.COLOR.POINT_COLOR.b;
        u[7] = p.COLOR.SECONDARY_AMOUNT | 0;
        f[8] = p.COLOR.POINT_SECONDARY_COLOR.r;
        f[9] = p.COLOR.POINT_SECONDARY_COLOR.g;
        f[10]= p.COLOR.POINT_SECONDARY_COLOR.b;
        u[11]= p.COLOR.TERTIARY_AMOUNT | 0;
        f[12]= p.COLOR.POINT_TERTIARY_COLOR.r;
        f[13]= p.COLOR.POINT_TERTIARY_COLOR.g;
        f[14]= p.COLOR.POINT_TERTIARY_COLOR.b;
        writeUniform(this.device, this.agentRenderUB, ab);
    }

    _writeBloomUB(p) {
        const threshold = p.bloomThreshold ?? 0.8;
        const radius    = p.bloomRadius    ?? 4;

        const _fill = (horizontal) => {
            const ab = new ArrayBuffer(32);
            const u  = new Uint32Array(ab);
            const f  = new Float32Array(ab);
            u[0] = this.W;
            u[1] = this.H;
            u[2] = this.bloomW;
            u[3] = this.bloomH;
            f[4] = threshold;
            f[5] = p.bloomStrength ?? 0.08;
            u[6] = horizontal ? 1 : 0;
            u[7] = radius;
            return ab;
        };

        writeUniform(this.device, this.bloomDownUB,  _fill(1)); // horizontal irrelevant for downsample
        writeUniform(this.device, this.bloomBlurHUB, _fill(1)); // horizontal pass
        writeUniform(this.device, this.bloomBlurVUB, _fill(0)); // vertical pass
    }

    _writeBlitUB(p) {
        const ab = new ArrayBuffer(16);
        const f  = new Float32Array(ab);
        f[0] = p.bloomStrength ?? 0.08;
        f[1] = p.gamma ?? 1.0;
        writeUniform(this.device, this.blitUB, ab);
    }

    destroy() {
        this.agentBuf?.destroy();
        this.accumBuf?.destroy();
        this.depositTex?.destroy();
        this.trailTexA?.destroy();
        this.trailTexB?.destroy();
        this.offscreenTex?.destroy();
        this.bloomTexA?.destroy();
        this.bloomTexB?.destroy();
        this._dummyMediaTex?.destroy();
        this.mediaTex?.destroy();
        [this.simUB, this.depositUB, this.normalizeUB, this.decayUB,
         this.trailRenderUB, this.agentRenderUB,
         this.bloomDownUB, this.bloomBlurHUB, this.bloomBlurVUB,
         this.blitUB,
        ].forEach(b => b?.destroy());
    }
}
