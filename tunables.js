// tunables
import * as dat from 'dat.gui';
const urlParams = new URLSearchParams(window.location.search);
const number = parseInt(urlParams.get("n"), 10);
const renderQuality = urlParams.get("r");

export const TEX_SIDE = number || 1200; // agents = TEX_SIDE^2
// export let DRAG = 8; // damping, not used.
export let IMAGE_AREA = 400.0;
// still testing this with coords, they clearly need to be adjusted.
export let RENDER_QUALITY = renderQuality || 1;


const gui = new dat.GUI();

const params = {
    STEP_LEN: 70.0,
    IMAGE_AREA: 400,
    RENDER_QUALITY: 1,
    TURN_JITTER: 3,
    // SPEED_JITTER: 2.0,
    SENSE_DIST: 10.0,
    SENSE_ANGLE: 0.3,
    TURN_RATE: 5.0,
    POINT_SIZE: 1.0,
    DEPOSIT_SIZE: 10.0,
    DEPOSIT_STRENGTH: 1,
    DEPOSIT_EDGE_SOFT: 0.5,
    CHAMP_SAMPLE_INTERVAL: 5000.0,
    CHAMP_IMP_MULTIPLIER: 5000.0,
    TRAIL_DECAY: 80,
    SPAWN_RADIUS: 500.0,
    ENABLE_MOUSE: false,
    SHOW_TRAIL: false,
    RENDER_QUALITY: 1.0,
    TEX_SIDE: 1200
};

// folders for grouping
const fSim   = gui.addFolder('Simulation');
const fDraw  = gui.addFolder('Draw Points');
const fDep   = gui.addFolder('Trail Deposit');
const fDecay = gui.addFolder('Trail Decay');
// const fSpawn = gui.addFolder('Spawn Pattern');
const fHeavy = gui.addFolder('Heavy / Reinit');

// toggle
gui.add(params, 'ENABLE_MOUSE')
gui.add(params, 'SHOW_TRAIL')

// simulat
fSim.add(params, 'STEP_LEN', 0, 200, 1)
fSim.add(params, 'TURN_JITTER', 1, 200, 1)
// fSim.add(params, 'SPEED_JITTER', 0, 50, 8)
fSim.add(params, 'SENSE_DIST', 1, 200, 1)
fSim.add(params, 'SENSE_ANGLE', 0, 1, 0.01)
fSim.add(params, 'TURN_RATE', 0, 100, 1)

// draw points
fDraw.add(params, 'POINT_SIZE', 1, 20, 1)

// trail deposit
fDep.add(params, 'DEPOSIT_SIZE', 0.5, 40, 0.5)
fDep.add(params, 'DEPOSIT_STRENGTH', 0, 5, 0.05)
fDep.add(params, 'DEPOSIT_EDGE_SOFT', 0, 1, 0.01)
fDep.add(params, 'CHAMP_SAMPLE_INTERVAL', 1, 20000, 1)
fDep.add(params, 'CHAMP_IMP_MULTIPLIER', 1, 20000, 1)

// trail decay
fDecay.add(params, 'TRAIL_DECAY', 0, 500, 1)

// spawn pattern
// fSpawn.add(params, 'SPAWN_RADIUS', 0, 2000, 10)

// heavy/runtime-coupled
// fHeavy.add(params, 'RENDER_QUALITY', 0.25, 2, 0.05)
// fHeavy.add(params, 'TEX_SIDE', 32, 4096, 32)

// open folders if desired
fSim.open();
fDraw.open();
// gui.hide()
fSim.open();
fDraw.open();
fDep.open();
fDecay.open();


export default params;
