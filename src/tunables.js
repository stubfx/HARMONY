// ─── Simulation Parameters and lil-gui Panel ─────────────────────────────────
// No Three.js dependency. Colors are plain {r,g,b} objects (0-1 range).

import * as lil from 'lil-gui';

const urlParams    = new URLSearchParams(window.location.search);
const agentCountQ  = parseInt(urlParams.get('n'), 10);
const panel        = urlParams.get('panel');

export const GUI = new lil.GUI({ width: 500 });

export const baseParams = {
    STEP_LEN:           70.0,
    TRAIL_TEX_SIZE:     2000,
    IMAGE_AREA:         400,       // overwritten at runtime
    IMAGE_REVEAL:       300,       // overwritten at runtime
    TURN_JITTER:        0.1,
    DRAG:               0.5,
    SENSE_DIST:         20.0,
    SENSE_ANGLE:        0.2,
    TURN_RATE:          20.0,
    POINT_SIZE:         2.0,
    DEPOSIT_SIZE:       0.05,
    DEPOSIT_STRENGTH:   10,
    DEPOSIT_EDGE_SOFT:  0.5,
    CHAMP_SAMPLE_INTERVAL: 50000,
    CHAMP_IMP_MULTIPLIER:  2.0,
    TRAIL_DECAY:        0.89,
    SPAWN_RADIUS:       300.0,
    ENABLE_MOUSE:       false,
    SHOW_TRAIL:         true,
    TRAIL_BRIGHTNESS:   0.002,
    BLOOM_STRENGTH:     0.08,
    BLOOM_THRESHOLD:    0.8,
    BLOOM_RADIUS:       4,
    GAMMA:              1.0,
    MEDIA_STRENGTH:     1.0,
    TEX_SIDE:           agentCountQ || 1200,
    COLOR: {
        POINT_COLOR:           { r: 1.0, g: 1.0, b: 1.0 },
        SECONDARY_AMOUNT:      10,
        POINT_SECONDARY_COLOR: { r: 1.0, g: 1.0, b: 1.0 },
        TERTIARY_AMOUNT:       11,
        POINT_TERTIARY_COLOR:  { r: 1.0, g: 1.0, b: 1.0 },
    },
};

// Live copy — mutated at runtime by GUI and n8n responses
export const params = structuredClone(baseParams);

export function refreshGUI() {
    GUI.controllers.forEach(c => c.updateDisplay());
    Object.values(GUI.folders).forEach(folder =>
        folder.controllers.forEach(c => c.updateDisplay())
    );
}

// ── GUI layout ────────────────────────────────────────────────────────────────
const fSim    = GUI.addFolder('Simulation');
const fColors = fSim.addFolder('Colors');
const fDraw   = GUI.addFolder('Points');
const fDep    = GUI.addFolder('Trail Deposit');
const fDecay  = GUI.addFolder('Trail Decay');
const fFX     = GUI.addFolder('Post-FX');
const fDebug  = GUI.addFolder('Debug');

fDebug.add(params, 'ENABLE_MOUSE');
fDebug.add(params, 'SHOW_TRAIL');

fSim.add(params, 'STEP_LEN',    0,   200, 1);
fSim.add(params, 'DRAG',        0,   5,   0.1);
fSim.add(params, 'TURN_JITTER', 0.05, 2,  0.05);
fSim.add(params, 'SENSE_DIST',  1,   200, 1);
fSim.add(params, 'SENSE_ANGLE', 0,   1,   0.01);
fSim.add(params, 'TURN_RATE',   0,   100, 1);

fColors.addColor(params.COLOR, 'POINT_COLOR');
fColors.addColor(params.COLOR, 'POINT_SECONDARY_COLOR');
fColors.add(params.COLOR, 'SECONDARY_AMOUNT', 0, 100, 1);
fColors.addColor(params.COLOR, 'POINT_TERTIARY_COLOR');
fColors.add(params.COLOR, 'TERTIARY_AMOUNT', 0, 100, 1);

fDraw.add(params, 'POINT_SIZE', 1, 3, 0.1);

fDep.add(params, 'DEPOSIT_SIZE',       0.05, 40,      0.05);
fDep.add(params, 'DEPOSIT_STRENGTH',   0,    20,      0.05);
fDep.add(params, 'DEPOSIT_EDGE_SOFT',  0,    1,       0.01);
fDep.add(params, 'CHAMP_SAMPLE_INTERVAL', 1, 1000000, 1);
fDep.add(params, 'CHAMP_IMP_MULTIPLIER',  1, 5000,    1);

fDecay.add(params, 'TRAIL_DECAY',    0,    1,    0.005);
fDecay.add(params, 'TRAIL_BRIGHTNESS', 0.0001, 0.05, 0.0001);
fDecay.add(params, 'MEDIA_STRENGTH', 0, 1, 0.01);

fFX.add(params, 'BLOOM_STRENGTH',   0,    1,    0.01);
fFX.add(params, 'BLOOM_THRESHOLD',  0,    1,    0.01);
fFX.add(params, 'BLOOM_RADIUS',     1,    8,    1);
fFX.add(params, 'GAMMA',            0.5,  2.5,  0.05);

fSim.open();
if (!import.meta.env.DEV && !panel) { GUI.hide(); }
