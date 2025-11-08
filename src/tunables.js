// tunables
import * as lil from 'lil-gui';
import * as THREE from 'three';
import * as Utils from './utils.js';
const urlParams = new URLSearchParams(window.location.search);
const number = parseInt(urlParams.get("n"), 10);
const renderQuality = urlParams.get("r");
const panel = urlParams.get("panel");

// export let DRAG = 8; // damping, not used.
export let IMAGE_AREA = 400.0;
// still testing this with coords, they clearly need to be adjusted.
export let RENDER_QUALITY = renderQuality || 1;

export const GUI = new lil.GUI({width: 500});

export const baseParams = {
    STEP_LEN: 70.0,
    IMAGE_AREA: 200,
    IMAGE_REVEAL_AREA: 250,
    RENDER_QUALITY: renderQuality || 1,
    TURN_JITTER: 0.1,
    DRAG: 0.5,
    // SPEED_JITTER: 2.0,
    SENSE_DIST: 20.0,
    SENSE_ANGLE: 0.2,
    TURN_RATE: 20.0,
    POINT_SIZE: 1.0,
    DEPOSIT_SIZE: 0.05,
    DEPOSIT_STRENGTH: 10,
    DEPOSIT_EDGE_SOFT: 0.5,
    CHAMP_SAMPLE_INTERVAL: 50000.0,
    CHAMP_IMP_MULTIPLIER: 2.0,
    TRAIL_DECAY: 0.89,
    SPAWN_RADIUS: 20.0,
    ENABLE_MOUSE: false,
    SHOW_TRAIL: false,
    TEX_SIDE: number || 1200,
    TRAIL_TEX_RES: .4,
    COLOR: {
        POINT_COLOR: {r: 1.0, g: 1.0, b: 1.0 },
        // POINT_COLOR: [1.0, 1.0, 1.0],
        SECONDARY_AMOUNT: 10,
        POINT_SECONDARY_COLOR: {r: 1.0, g: 1.0, b: 1.0 },
        TERTIARY_AMOUNT: 11,
        POINT_TERTIARY_COLOR: {r: 1.0, g: 1.0, b: 1.0 }
    }
};

// this will be changed dinamically.
export const params = structuredClone(baseParams);

export const debug = {
    SHOW_INFO: false, 
}

// console.log(params)
// Object.keys(params.COLOR).forEach(cl => {
//     params.COLOR.cl = Utils.getRGB(params.COLOR.cl)});
// console.log(params)

export function refreshGUI () {
    // fix colors that may not be read correctly if missing a floating points
    // still looking at you chatGPT.
    // Object.keys(params.COLOR).forEach(cl => {
    //     if (typeof params.COLOR[cl] == "object") {
    //         const color = params.COLOR[cl]
    //         params.COLOR[cl] = Utils.getRGB(color)}
    // });
    GUI.controllers.forEach(c => c.updateDisplay());
    Object.values(GUI.folders).forEach(folder => {
        folder.controllers.forEach(c => c.updateDisplay());
    });
}

// folders for grouping
const fSim   = GUI.addFolder('Simulation');
const fColors = fSim.addFolder('colors');
const fDraw  = GUI.addFolder('Draw Points');
const fDep   = GUI.addFolder('Trail Deposit');
const fDecay = GUI.addFolder('Trail Decay');
const fDebug = GUI.addFolder('Debug');

// toggle
fDebug.add(params, 'ENABLE_MOUSE')
fDebug.add(params, 'SHOW_TRAIL')
// fDebug.add(debug, 'SHOW_INFO');

// simulat
fSim.add(params, 'STEP_LEN', 0, 200, 1)
fSim.add(params, 'DRAG', 0, 5, .1)
fSim.add(params, 'TURN_JITTER', 0.05, 2, 0.05)
// fSim.add(params, 'SPEED_JITTER', 0, 50, 8)
fSim.add(params, 'SENSE_DIST', 1, 200, 1)
fSim.add(params, 'SENSE_ANGLE', 0, 1, 0.01)
fSim.add(params, 'TURN_RATE', 0, 100, 1)

fColors.addColor(params.COLOR, 'POINT_COLOR');

fColors.addColor(params.COLOR, 'POINT_SECONDARY_COLOR');

fColors.add(params.COLOR, 'SECONDARY_AMOUNT', 0, 100, 1);

fColors.addColor(params.COLOR, 'POINT_TERTIARY_COLOR');

fColors.add(params.COLOR, 'TERTIARY_AMOUNT', 0, 100, 1);

// draw points
fDraw.add(params, 'POINT_SIZE', 1, 3, .1)

// trail deposit
fDep.add(params, 'DEPOSIT_SIZE', 0.05, 40, 0.05)
fDep.add(params, 'DEPOSIT_STRENGTH', 0, 20, 0.05)
fDep.add(params, 'DEPOSIT_EDGE_SOFT', 0, 1, 0.01)
fDep.add(params, 'CHAMP_SAMPLE_INTERVAL', 1, 1000000, 1)
fDep.add(params, 'CHAMP_IMP_MULTIPLIER', 1, 5000, 1)

// trail decay
fDecay.add(params, 'TRAIL_DECAY', 0, 1, .005)

// spawn pattern
// fSpawn.add(params, 'SPAWN_RADIUS', 0, 2000, 10)

// heavy/runtime-coupled
// fHeavy.add(params, 'RENDER_QUALITY', 0.25, 2, 0.05)
// fHeavy.add(params, 'TEX_SIDE', 32, 4096, 32)

fSim.open();
// fColors.open();
// fDraw.open();
// fDep.open();
// fDecay.open();
// fDebug.open();
GUI.close()
if (import.meta.env.DEV && !panel) {
    GUI.hide();
}
