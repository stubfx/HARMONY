import GUI from 'lil-gui';
import { stopAudio, isActive, setDuckLevel } from './audio.js';
import { setSynthBusVolume, setMusicBusVolume } from './synth.js';

// ── GUI initialisation ────────────────────────────────────────────────────────
// Call once after all sim functions are defined.
// Returns handles that sim.js needs to reference after initialisation.
export function initGUI({
    params,
    socket,
    simState,
    MAX_AGENTS,
    seedAgents,
    seedGoL,
    setSize,
    rebuildOffscreen,
    rebuildGridTex,
    applyResize,
    renderTraceCanvas,
    loadFontSpec,
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
    const swarmDebug = { users: 0, pitch: 0.5, roll: 0.5, temp: 0.5, coherence: 0.5, chaos: 1 };
    const gui = new GUI({ title: 'Wind Particles', width: 260 });
    if (!guiVisible) gui.domElement.style.display = 'none';

    // ── Fullscreen toggle ───────────────────────────────────────────────────────
    gui.add({
        fullscreen: () => {
            if (document.fullscreenElement) document.exitFullscreen();
            else document.documentElement.requestFullscreen().catch(() => {});
        },
    }, 'fullscreen').name('⛶ toggle fullscreen');

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
    fMotion.add(params, 'dotCenterRadius',  0, 500,  1    ).name('DOT center radius (px)');
    fMotion.add(params, 'dotRespawnChance', 0,   1,  0.005).name('DOT respawn chance');
    fMotion.add(params, 'freeroamLock').name('freeroam lock');
    fMotion.add(params, 'freeroamLockDelay', 1, 60, 1).name('freeroam lock (s)');
    fMotion.add(params, 'randomTeleportChance', 0, 0.05, 0.001).name('random teleport chance');

    // ── Game of Life ────────────────────────────────────────────────────────────
    // Conway automaton on a grid; particles are pulled toward the live cells.
    const fGol = gui.addFolder('Game of Life');
    fGol.add(params, 'golEnabled').name('enabled').onChange(v => { if (v) seedGoL(); });
    fGol.add(params, 'golStrength',     0, 2,  0.01).name('attraction');
    fGol.add(params, 'golStepInterval', 1, 30, 1   ).name('frames / step');
    fGol.add(params, 'golSpark',        0, 0.1, 0.001).name('life spark');
    fGol.add({ reseed: () => seedGoL() }, 'reseed').name('reseed');
    fGol.close();

    // ── Wind ──────────────────────────────────────────────────────────────────
    const fWind = gui.addFolder('Wind');
    const windStrCtrl = fWind.add(params, 'windStr', 0, 2, 0.01).name('strength');
    fWind.add(params, 'windEnabled').name('enabled').onChange(v => windStrCtrl.enable(v));
    fWind.add(params, 'autoWind').name('auto-cycle formula');
    fWind.add(params, 'showWindVis').name('show arrows');

    // ── Visual ────────────────────────────────────────────────────────────────
    const fVis = gui.addFolder('Visual');
    fVis.add(params, 'renderScale', 0.1, 1.0, 0.05).name('render scale').onChange(applyResize);
    fVis.add(params, 'traceScale', 0.1, 1.0, 0.05).name('trace res').onChange(renderTraceCanvas);
    fVis.add(params, 'trailDecay',    0.005, 0.4,  0.005).name('trail decay');
    fVis.add(params, 'bgBlackCutoff', 0,     0.05, 0.001).name('black cutoff');
    fVis.add(params, 'toneBlack',     0,     0.5,  0.005).name('tone black');
    fVis.add(params, 'toneWhite',     0.1,   4.0,  0.05 ).name('tone white');
    fVis.add(params, 'toneGamma',     0.2,   2.0,  0.05 ).name('tone gamma');
    fVis.add(params, 'shadowBoost',   0,     8.0,  0.1  ).name('shadow boost');
    fVis.add(params, 'pointSize',     1,     6,    0.1  ).name('agent size');
    fVis.addColor(params, 'color1').name('color 1');
    fVis.addColor(params, 'color2').name('color 2');
    fVis.addColor(params, 'chaosColor').name('chaos color');
    fVis.add(params, 'chaosColorFraction', 0, 1, 0.01).name('chaos color %');
    fVis.addColor(params, 'idleColor').name('idle color');
    fVis.add(params, 'idleColorFraction', 0, 1, 0.01).name('idle color %');
    fVis.add(params, 'brightness', 0.01, 0.5, 0.005).name('brightness');
    fVis.add(params, 'additiveBlend').name('additive blend');
    fVis.add(params, 'blendAmount', 0, 1, 0.01).name('blend amount');
    fVis.add(params, 'pixelGrid').name('pixel grid');
    fVis.add(params, 'pixelGridCells', 20, 1000, 1).name('grid cells').onChange(() => rebuildGridTex());

    // ── Export (screenshot, 's' key) ────────────────────────────────────────────
    const fExport = gui.addFolder('Export');
    fExport.add(params, 'exportTransparent').name('transparent bg');
    fExport.add(params, 'exportCMYK').name('CMYK (TIFF)');
    fExport.close();

    // ── Trace ─────────────────────────────────────────────────────────────────
    const fMagnet = gui.addFolder('Trace');
    fMagnet.add(params, 'magnetStr',      0, 50,   0.1  ).name('homing speed');
    fMagnet.add(params, 'alphaThreshold', 0,  1,   0.01 ).name('alpha threshold');
    fMagnet.add(params, 'blackThreshold', 0,  0.5, 0.005).name('black cutoff');
    fMagnet.add(params, 'vignetteEdge',   0,  0.5, 0.005).name('edge fade');
    fMagnet.add(params, 'avoidForceStr',  0,  5,   0.05 ).name('avoid force');
    fMagnet.add(params, 'showImage').name('show image');
    fMagnet.add(params, 'captionSize', 0.02, 0.15, 0.005).name('caption size').onChange(renderTraceCanvas);
    // Font presets — selecting one fills the #font-input and loads it from Google Fonts.
    const FONT_PRESETS = [
        'Bellefair', 'Inter', 'Roboto', 'Montserrat', 'Oswald', 'Bebas Neue', 'Anton',
        'Archivo Black', 'Playfair Display', 'Lora', 'Space Mono', 'Spline Sans Mono',
    ];
    fMagnet.add({ preset: params.fontFamily }, 'preset', FONT_PRESETS).name('font preset').onChange(v => {
        const fi = document.querySelector('#font-input');
        if (fi) fi.value = v;
        loadFontSpec(v);
    });
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

    // ── Champions ───────────────────────────────────────────────────────────────
    const fChampions = gui.addFolder('Champions');
    fChampions.add(params, 'championsEnabled').name('enabled');
    fChampions.add(params, 'champions',       1, 1500, 1   ).name('1 in N');
    fChampions.add(params, 'championSize',    0.1, 40, 0.1 ).name('size (free)');
    fChampions.add(params, 'champLinesAlpha', 0, 1,    0.01).name('lines alpha');
    fChampions.close();

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
    fContent.add(params, 'respawnOnQR').name('respawn on QR');
    fContent.add(params, 'qrRespawnChance', 0, 0.1, 0.001).name('QR respawn chance');
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
    fAvoid.add(params, 'chaosAvoidMapThreshold', 0, 1, 0.01).name('chaos threshold (hide above)');
    fAvoid.add(params, 'avoidMapScale', 0.05, 1.0, 0.01).name('scale');
    fAvoid.add(params, 'avoidMapInvert').name('invert colors');
    fAvoid.add(params, 'avoidMapSampleColor').name('sample color');
    fAvoid.add(params, 'avoidMapFixedColor').name('fixed color');
    fAvoid.add(params, 'avoidMapBlackCutoff', 0, 0.5, 0.005).name('color black cutoff');
    fAvoid.add(params, 'randomTeleportOnAvoidMap').name('random teleport');
    fAvoid.add({ load: () => document.querySelector('#avoid-map-input').click() }, 'load').name('Load map…');
    fAvoid.add({ clear: clearAvoidMap }, 'clear').name('Clear map');

    // ── Session ───────────────────────────────────────────────────────────────
    const fSession = gui.addFolder('Session');
    fSession.add(params, 'spectatorAgentShare',       0, 100,  1   ).name('agent share (%)');
    fSession.add(params, 'spectatorSpawnChance',     0,   1,  0.01).name('spawn chance (base)');
    fSession.add(params, 'spectatorSpawnMultiplier', 0,  10,  0.1 ).name('spawn multiplier');
    fSession.add(params, 'spawnerSpeed',             0,   2,  0.05).name('spawner speed');
    fSession.add(params, 'spawnerVelocityBoost',     0,   5,  0.1 ).name('spawner velocity boost');
    fSession.add(params, 'spawnerSteering',          1,  20,  0.5 ).name('spawner steering');
    fSession.add(params, 'spawnerInactiveTimeout',   1,  30,  1   ).name('spawner timeout (s)');
    fSession.add(params, 'releaseBurstSpeed',        0, 100,  1   ).name('release burst (fireworks)');
    fSession.add(params, 'remoteTimeout',            0, 180,  5   ).name('idle restore QR (s)');
    fSession.add(params, 'maxSpectators',            1,  50,  1   ).name('QR hides at N users');
    fSession.add(params, 'n8nEnabled').name('n8n enabled').onChange(() => restartHeartbeat());
    fSession.add(params, 'n8nTestMode').name('n8n test mode').onChange(v => {
        socket.emit('set-n8n-test-mode', v);
        const url = new URL(location.href);
        if (v) url.searchParams.set('test', '1');
        else url.searchParams.delete('test');
        history.replaceState(null, '', url);
    });
    fSession.add(params, 'heartbeatInterval', 0, 120,  5).name('heartbeat (s)').onChange(() => restartHeartbeat());
    fSession.add(params, 'heartbeatTimeout',  5, 300, 5).name('heartbeat timeout (s)');


    // ── Audio ─────────────────────────────────────────────────────────────────
    const fAudio = gui.addFolder('Audio');
    fAudio.add(params, 'color2AudioStr', 0, 1, 0.01).name('audio → color2');
    fAudio.add(params, 'duckLevel',  0, 1, 0.01).name('duck level').onChange(v => setDuckLevel(v));
    const _busState = { synthVol: 0, musicVol: 0 };
    fAudio.add(_busState, 'synthVol', -30, 6, 0.5).name('ch1: synth vol').onChange(v => setSynthBusVolume(v));
    fAudio.add(_busState, 'musicVol', -30, 6, 0.5).name('ch2: music vol').onChange(v => setMusicBusVolume(v));
    fAudio.close();

    // ── Debug ─────────────────────────────────────────────────────────────────
    const fDebug = gui.addFolder('Debug');
    // No .listen() — controllers are refreshed manually inside the collective-state
    // socket handler (≤300 ms cadence) so there's no extra RAF loop competing with WebGPU.
    const dbgUsers     = fDebug.add(swarmDebug, 'users').name('remotes').disable();
    const dbgPitch     = fDebug.add(swarmDebug, 'pitch',     0, 1).name('avg pitch').disable();
    const dbgRoll      = fDebug.add(swarmDebug, 'roll',      0, 1).name('avg roll').disable();
    const dbgTemp      = fDebug.add(swarmDebug, 'temp',      0, 1).name('avg temp').disable();
    const dbgCoherence = fDebug.add(swarmDebug, 'coherence', 0, 1).name('avg coherence').disable();
    const dbgChaos     = fDebug.add(swarmDebug, 'chaos',     0, 1).name('chaos (0=armonia)').disable();

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

    const modeCtrl      = gui.add(simState, 'mode',      ['STORY', 'SHOWCASE']).name('mode');
    const colorModeCtrl = gui.add(simState, 'colorMode', ['NORMAL', 'GRAYSCALE', 'GRAYSCALE_INVERTED']).name('color mode');
    const stateCtrl     = gui.add(simState, 'status',    ['NORMAL', 'FREEROAM', 'DOT']).name('status');
    const qrStateCtrl = gui.add(simState, 'qrStatus', ['SHOW', 'HIDE']).name('qr');
    gui.add(simState, 'stepStatus', ['HARMONY', 'IDLE', 'DRAW', 'VOTE', 'PULSE', 'TEXT', 'RAISE', 'WAVE']).name('step status (test)')
        .onChange(v => socket.emit('remote-ui', { stepStatus: v === 'HARMONY' ? null : v }));

    fMotion.open();
    fWind.open();

    applyGUIVisibility();

    return {
        gui,
        swarmDebug,
        modeCtrl,
        colorModeCtrl,
        stateCtrl,
        qrStateCtrl,
        dbgUsers,
        dbgPitch,
        dbgRoll,
        dbgTemp,
        dbgCoherence,
        dbgChaos,
        applyGUIVisibility,
        toggleGUI,
        updateGizmo(pitch, roll) {
            gizmoPitch = pitch;
            gizmoRoll  = roll;
            drawGizmo();
        },
    };
}
