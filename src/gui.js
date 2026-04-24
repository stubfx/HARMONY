import GUI from 'lil-gui';

// ── GUI initialisation ────────────────────────────────────────────────────────
// Call once after all sim functions are defined.
// Returns handles that sim.js needs to reference after initialisation.
export function initGUI({
    params,
    socket,
    simState,
    MAX_AGENTS,
    seedAgents,
    setSize,
    rebuildOffscreen,
    renderTraceCanvas,
    generateQR,
    clearMagnetImage,
    clearTraceText,
    clearAvoidMap,
    restartHeartbeat,
}) {
    // ── HUD visibility ────────────────────────────────────────────────────────
    let guiVisible = new URLSearchParams(location.search).get('gui') === 'true';
    const uiEl      = document.querySelector('#ui');
    const monitorEl = document.querySelector('#monitor');

    function applyGUIVisibility() {
        uiEl.style.display           = guiVisible ? 'flex' : 'none';
        monitorEl.style.display      = guiVisible ? 'flex' : 'none';
        gui.domElement.style.display = guiVisible ? ''     : 'none';
    }

    function toggleGUI() {
        guiVisible = !guiVisible;
        applyGUIVisibility();
    }

    // ── lil-gui instance ──────────────────────────────────────────────────────
    const swarmDebug = { users: 0, pitch: 0.5, roll: 0.5, temp: 0.5, coherence: 0.5 };
    const gui = new GUI({ title: 'Wind Particles', width: 260 });
    if (!guiVisible) gui.domElement.style.display = 'none';

    // ── Motion ────────────────────────────────────────────────────────────────
    const fMotion = gui.addFolder('Motion');
    fMotion.add(params, 'agentCount', 1_000, MAX_AGENTS, 1_000)
        .name('agents')
        .onChange(() => seedAgents());
    fMotion.add(params, 'stepLen',      0.1, 8,    0.1).name('base speed');
    fMotion.add(params, 'turnRate',     0.005, 0.3, 0.005).name('turn rate');
    fMotion.add(params, 'maxSpeed',     1,    15,   0.5).name('max speed');
    fMotion.add(params, 'minSpeed',     0,    2,    0.05).name('min speed');
    fMotion.add(params, 'weightSpread', 0, 1, 0.01).name('weight spread')
        .onChange(() => seedAgents());
    fMotion.add(params, 'followFormula').name('follow formula');
    fMotion.add(params, 'autoDir').name('auto-cycle formula');
    fMotion.add(params, 'bounceEdges').name('bounce edges');
    fMotion.add(params, 'useDeltaTime').name('delta time');

    // ── Wind ──────────────────────────────────────────────────────────────────
    const fWind = gui.addFolder('Wind');
    const windStrCtrl = fWind.add(params, 'windStr', 0, 2, 0.01).name('strength');
    fWind.add(params, 'windEnabled').name('enabled').onChange(v => windStrCtrl.enable(v));
    fWind.add(params, 'autoWind').name('auto-cycle formula');
    fWind.add(params, 'showWindVis').name('show arrows');

    // ── Visual ────────────────────────────────────────────────────────────────
    const fVis = gui.addFolder('Visual');
    fVis.add(params, 'renderScale', 0.1, 1.0, 0.05).name('render scale').onChange(() => {
        setSize();
        rebuildOffscreen();
        seedAgents();
    });
    fVis.add(params, 'traceScale', 0.1, 1.0, 0.05).name('trace res').onChange(renderTraceCanvas);
    fVis.add(params, 'trailDecay',    0.005, 0.4,  0.005).name('trail decay');
    fVis.add(params, 'bgBlackCutoff', 0,     0.05, 0.001).name('black cutoff');
    fVis.add(params, 'toneBlack',     0,     0.5,  0.005).name('tone black');
    fVis.add(params, 'toneWhite',     0.1,   4.0,  0.05 ).name('tone white');
    fVis.add(params, 'toneGamma',     0.2,   2.0,  0.05 ).name('tone gamma');
    fVis.add(params, 'shadowBoost',   0,     8.0,  0.1  ).name('shadow boost');
    fVis.add(params, 'pointSize',     1,     6,    0.1  ).name('agent size');
    fVis.addColor(params, 'color').name('base color');
    fVis.addColor(params, 'speedColor').name('fast color');
    fVis.add(params, 'brightness', 0.01, 0.5, 0.005).name('brightness');
    fVis.add(params, 'additiveBlend').name('additive blend');

    // ── Trace ─────────────────────────────────────────────────────────────────
    const fMagnet = gui.addFolder('Trace');
    fMagnet.add(params, 'magnetStr',      0, 50,   0.1  ).name('homing speed');
    fMagnet.add(params, 'alphaThreshold', 0,  1,   0.01 ).name('alpha threshold');
    fMagnet.add(params, 'blackThreshold', 0,  0.5, 0.005).name('black cutoff');
    fMagnet.add(params, 'vignetteEdge',   0,  0.5, 0.005).name('edge fade');
    fMagnet.add(params, 'avoidForceStr',  0,  5,   0.05 ).name('avoid force');
    fMagnet.add(params, 'showImage').name('show image');
    fMagnet.add(params, 'captionSize', 0.02, 0.15, 0.005).name('caption size').onChange(renderTraceCanvas);
    fMagnet.add(params, 'clearDelay', 0, 120, 5).name('auto clear (s)');
    fMagnet.add({ load: () => document.querySelector('#image-input').click() }, 'load').name('Load image…');
    fMagnet.add({ clear: clearMagnetImage }, 'clear').name('Clear image');
    fMagnet.add({ clear: clearTraceText },   'clear').name('Clear text');

    // ── Homing ────────────────────────────────────────────────────────────────
    const fHoming = gui.addFolder('Homing');
    fHoming.add(params, 'homingChance',         0, 1,    0.01).name('homing chance');
    fHoming.add(params, 'homingInfluence',      0, 1,    0.01).name('homing influence');
    fHoming.add(params, 'agentShadowStr',       0, 1,    0.005).name('shadow strength');
    fHoming.add(params, 'agentShadowRadius',    0, 300,  0.5  ).name('shadow radius');
    fHoming.add(params, 'homingProximityRange', 0, 2000, 10   ).name('proximity range (px)');
    fHoming.add(params, 'homingMinAlpha',       0, 1,    0.01 ).name('proximity min alpha');

    // ── Probe ─────────────────────────────────────────────────────────────────
    const fProbe = gui.addFolder('Probe');
    fProbe.add(params, 'probeLen',         5, 300,               1   ).name('probe distance');
    fProbe.add(params, 'probeForceStr',    0, 200,               1   ).name('probe force');
    fProbe.add(params, 'probeSensorAngle', 0.05, Math.PI * 0.75, 0.01).name('probe sensor angle');
    fProbe.add(params, 'respawnOnCollide').name('respawn on collide');

    // ── Eraser ────────────────────────────────────────────────────────────────
    const fEraser = gui.addFolder('Eraser');
    fEraser.add(params, 'contamMouse').name('mouse eraser');
    fEraser.add(params, 'contamPush').name('eraser push');
    fEraser.add(params, 'contamRadius', 10, 600, 5).name('eraser radius');

    // ── QR & Layout ───────────────────────────────────────────────────────────
    const fContent = gui.addFolder('QR & Layout');
    fContent.add(params, 'qrOverlay').name('QR overlay').onChange(renderTraceCanvas);
    fContent.add(params, 'qrFadeZone').name('QR fade zone');
    fContent.add(params, 'qrSize',      0.05, 0.5,  0.01).name('QR size').onChange(renderTraceCanvas);
    fContent.add(params, 'qrMargin',    0,    0.1,  0.005).name('QR margin').onChange(renderTraceCanvas);
    fContent.add(params, 'qrAlignX',    ['left', 'center', 'right']).name('QR align H').onChange(renderTraceCanvas);
    fContent.add(params, 'qrAlignY',    ['top',  'center', 'bottom']).name('QR align V').onChange(renderTraceCanvas);
    fContent.add(params, 'qrQuietZone', 0, 8, 1).name('QR quiet zone').onChange(() => generateQR().then(renderTraceCanvas));
    fContent.add(params, 'qrInvert').name('QR invert colors').onChange(() => generateQR().then(renderTraceCanvas));
    fContent.add(params, 'imageSize', 0.05, 1.0, 0.01).name('content size').onChange(renderTraceCanvas);
    fContent.add(params, 'imageX',    0,    1,   0.01).name('content X').onChange(renderTraceCanvas);
    fContent.add(params, 'imageY',    0,    1,   0.01).name('content Y').onChange(renderTraceCanvas);

    // ── Avoidance map ─────────────────────────────────────────────────────────
    const fAvoid = gui.addFolder('Avoidance map');
    fAvoid.add(params, 'avoidMapScale', 0.05, 1.0,  0.01 ).name('scale');
    fAvoid.add(params, 'qrAvoidMargin', 0,    0.3,  0.005).name('QR margin').onChange(renderTraceCanvas);
    fAvoid.add(params, 'qrAvoidFade',   0,    0.15, 0.005).name('QR fade').onChange(renderTraceCanvas);
    fAvoid.add({ load: () => document.querySelector('#avoid-map-input').click() }, 'load').name('Load map…');
    fAvoid.add({ clear: clearAvoidMap }, 'clear').name('Clear map');

    // ── Session ───────────────────────────────────────────────────────────────
    const fSession = gui.addFolder('Session');
    fSession.add(params, 'spectatorSpawnChance',     0,   1,  0.01).name('spawn chance (base)');
    fSession.add(params, 'spectatorSpawnMultiplier', 0,  10,  0.1 ).name('spawn multiplier');
    fSession.add(params, 'spawnerSpeed',             0,   2,  0.05).name('spawner speed');
    fSession.add(params, 'spawnerVelocityBoost',     0,   5,  0.1 ).name('spawner velocity boost');
    fSession.add(params, 'spawnerSteering',          1,  20,  0.5 ).name('spawner steering');
    fSession.add(params, 'spawnerInactiveTimeout',   1,  30,  1   ).name('spawner timeout (s)');
    fSession.add(params, 'remoteTimeout',            0, 180,  5   ).name('idle restore QR (s)');
    fSession.add(params, 'maxSpectators',            1,  50,  1   ).name('QR hides at N users');
    fSession.add(params, 'n8nTestMode').name('n8n test mode').onChange(v => socket.emit('set-n8n-test-mode', v));
    fSession.add(params, 'heartbeatInterval', 0, 120, 5).name('heartbeat (s)').onChange(() => restartHeartbeat());

    // ── Debug ─────────────────────────────────────────────────────────────────
    const fDebug = gui.addFolder('Debug');
    // No .listen() — controllers are refreshed manually inside the collective-state
    // socket handler (≤300 ms cadence) so there's no extra RAF loop competing with WebGPU.
    const dbgUsers     = fDebug.add(swarmDebug, 'users').name('remotes').disable();
    const dbgPitch     = fDebug.add(swarmDebug, 'pitch',     0, 1).name('avg pitch').disable();
    const dbgRoll      = fDebug.add(swarmDebug, 'roll',      0, 1).name('avg roll').disable();
    const dbgTemp      = fDebug.add(swarmDebug, 'temp',      0, 1).name('avg temp').disable();
    const dbgCoherence = fDebug.add(swarmDebug, 'coherence', 0, 1).name('avg coherence').disable();

    // ── Tilt gizmo ────────────────────────────────────────────────────────────
    let gizmoCtx   = null;
    let gizmoPitch = 0.75;
    let gizmoRoll  = 0.5;

    function drawGizmo() {
        if (!gizmoCtx) return;
        const ctx = gizmoCtx;
        const W = 80, H = 80, cx = 40, cy = 40, R = 26;

        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#161616';
        ctx.fillRect(0, 0, W, H);

        const ry = (gizmoRoll  - 0.5 ) * Math.PI;
        const rx = (gizmoPitch - 0.75) * Math.PI * 2;

        function rot([x, y, z]) {
            const x1 =  x * Math.cos(ry) + z * Math.sin(ry);
            const y1 = y;
            const z1 = -x * Math.sin(ry) + z * Math.cos(ry);
            return [
                x1,
                y1 * Math.cos(rx) - z1 * Math.sin(rx),
                y1 * Math.sin(rx) + z1 * Math.cos(rx),
            ];
        }

        const axes = [
            { v: [1, 0, 0], col: '#ff4444', lbl: 'X' },
            { v: [0, 1, 0], col: '#44cc44', lbl: 'Y' },
            { v: [0, 0, 1], col: '#4488ff', lbl: 'Z' },
        ].map(a => ({ ...a, r: rot(a.v) })).sort((a, b) => a.r[2] - b.r[2]);

        ctx.fillStyle = '#555';
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fill();

        for (const { r, col, lbl } of axes) {
            const px = cx + r[0] * R;
            const py = cy - r[1] * R;
            const alpha = 0.3 + 0.7 * (r[2] + 1) / 2;

            ctx.globalAlpha = alpha;
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(px, py);
            ctx.stroke();

            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.arc(px, py, 2.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.font = '9px monospace';
            ctx.fillText(lbl, px + (r[0] >= 0 ? 5 : -11), py + (r[1] >= 0 ? -4 : 10));
        }
        ctx.globalAlpha = 1;
    }

    function initGizmo() {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:4px 0 6px';
        const c = document.createElement('canvas');
        c.width = 80; c.height = 80;
        c.style.cssText = 'display:block;border-radius:3px';
        gizmoCtx = c.getContext('2d');
        wrap.appendChild(c);
        fDebug.domElement.appendChild(wrap);
        drawGizmo();
    }
    initGizmo();

    fDebug.close();

    gui.add({ restart: () => seedAgents() }, 'restart').name('↺  Restart');

    const stateCtrl   = gui.add(simState, 'status',   ['NORMAL', 'FREEROAM', 'DOT']).name('status');
    const qrStateCtrl = gui.add(simState, 'qrStatus', ['SHOW', 'HIDE']).name('qr');

    fMotion.open();
    fWind.open();

    applyGUIVisibility();

    return {
        gui,
        swarmDebug,
        stateCtrl,
        qrStateCtrl,
        dbgUsers,
        dbgPitch,
        dbgRoll,
        dbgTemp,
        dbgCoherence,
        applyGUIVisibility,
        toggleGUI,
        updateGizmo(pitch, roll) {
            gizmoPitch = pitch;
            gizmoRoll  = roll;
            drawGizmo();
        },
    };
}
