// tunables
import * as dat from 'dat.gui';
import * as THREE from 'three';
const urlParams = new URLSearchParams(window.location.search);
const number = parseInt(urlParams.get("n"), 10);
const renderQuality = urlParams.get("r");

export const TEX_SIDE = number || 1200; // agents = TEX_SIDE^2
// export let DRAG = 8; // damping, not used.
export let IMAGE_AREA = 400.0;
// still testing this with coords, they clearly need to be adjusted.
export let RENDER_QUALITY = renderQuality || 1;

const gui = new dat.GUI();
gui.width = 500;

export const params = {
    STEP_LEN: 70.0,
    IMAGE_AREA: 500,
    RENDER_QUALITY: 1,
    TURN_JITTER: 0.1,
    DRAG: 0.5,
    // SPEED_JITTER: 2.0,
    SENSE_DIST: 20.0,
    SENSE_ANGLE: 0.2,
    TURN_RATE: 20.0,
    POINT_SIZE: 1.0,
    DEPOSIT_SIZE: 1.0,
    DEPOSIT_STRENGTH: 10,
    DEPOSIT_EDGE_SOFT: 0.5,
    CHAMP_SAMPLE_INTERVAL: 50000.0,
    CHAMP_IMP_MULTIPLIER: 2.0,
    TRAIL_DECAY: 0.89,
    SPAWN_RADIUS: 500.0,
    ENABLE_MOUSE: true,
    SHOW_TRAIL: false,
    RENDER_QUALITY: 1.0,
    TEX_SIDE: number || 1200,
    POINT_COLOR: [0.3, 0.3, 0.3],
    POINT_COLOR_HEX: 0x1e1e1e1e,
    TRAIL_TEX_RES: .4
};

export const debug = {
    SHOW_INFO: false, 
}

// folders for grouping
const fSim   = gui.addFolder('Simulation');
const fDraw  = gui.addFolder('Draw Points');
const fDep   = gui.addFolder('Trail Deposit');
const fDecay = gui.addFolder('Trail Decay');
// const fSpawn = gui.addFolder('Spawn Pattern');
const fDebug = gui.addFolder('Debug');

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
fSim.addColor(params, 'POINT_COLOR_HEX').onChange(v => {
  const c = new THREE.Color(v); // or your own parser
  params.POINT_COLOR = [c.r,c.g,c.b]; // values 0–1
});

// draw points
fDraw.add(params, 'POINT_SIZE', 1, 3, .1)

// trail deposit
fDep.add(params, 'DEPOSIT_SIZE', 0.5, 40, 0.5)
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
fDraw.open();
fDep.open();
fDecay.open();
fDebug.open();
// gui.close();
