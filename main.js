import * as THREE from 'three';
import * as UTILS from '/utils.js';
import params from '/tunables.js';


import simVert from './sim.vert?raw';
import simFrag from './sim.frag?raw';
import pointVert from './point.vert?raw';
import pointFrag from './point.frag?raw';
import trailFrag from './trailDeposit.frag?raw';
import trailVert from './trailDeposit.vert?raw';
import trailDecayVert from './trailDecay.vert?raw';
import trailDecayFrag from './trailDecay.frag?raw';
import logoImgUrl from './assets/aant.png';
import colorImgUrl from './assets/a03.png';

async function loadShader(url) {
    const res = await fetch(url);
    return await res.text();
}

// console.log(params.TEX_SIDE);


let prevmousecoords = [0.0, 0.0]; 
let mouseDown = false;
let nuke = false;


// dealing with this tomorrow. it's late.
// the purpose of this is to calculate the image once
// outside the shader for optimization purposes
let customImageTopLeft = 0;


const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const texLoader = new THREE.TextureLoader();
const RES = window.devicePixelRatio * params.RENDER_QUALITY;
const customImage = texLoader.load(colorImgUrl, () => {
    customImage.colorSpace = THREE.SRGBColorSpace;
    // console.log(customImage.width, customImage.height);
});

// renderer section
const renderer = new THREE.WebGLRenderer();
renderer.autoClear = false;
// renderer.setSize(1000, 1000);
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio(RES);
const bufferSize = new THREE.Vector2();
renderer.getDrawingBufferSize(bufferSize);
const trailBufferSize = bufferSize.clone().multiplyScalar(params.TRAIL_TEX_RES);

document.body.appendChild( renderer.domElement );

const W = renderer.domElement.width, H = renderer.domElement.height;
const fpsEl = document.querySelector("#fps");
const agentsEl = document.querySelector("#agentsCount");
agentsEl.textContent = `${(params.TEX_SIDE * params.TEX_SIDE).toLocaleString()} agents`
// const dtEl = document.querySelector("#deltaTime");

function refreshSizes() {
    renderer.getDrawingBufferSize(bufferSize);     // device px
}

refreshSizes();

window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    refreshSizes();
    initTextures();
});

document.onkeydown = (event) => {
    nuke = event.key == "n";
}

document.onkeyup = (event) => {
    if (event.key == "n") nuke = false;
}
document.onmousemove = (e) => {
    const xDev = e.clientX * RES;
    const yDev = (window.innerHeight - e.clientY) * RES; // flip in CSS, then scale
    prevmousecoords = [xDev, yDev];
    // console.log(prevmousecoords);
}

document.onmousedown = () => {
    mouseDown = true && params.ENABLE_MOUSE;
}

document.onmouseup = event => {
    mouseDown = false;
}

// we hold both of those to achieve sim.
// sim will hold the Data, draw will show it.
const sceneSim = new THREE.Scene();
const sceneTrail = new THREE.Scene();
const sceneTrailDecay = new THREE.Scene();
const sceneDraw = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);

let rtA;
let rtB;
let trailA;
let trailB;
let trailRead, trailWrite;
let trailDecayTxA;
let trailDecayTxB;
let trailDecayRead, trailDecayWrite;

function initTextures() {
    rtA = UTILS.makeRT();
    rtB = UTILS.makeRT();
    trailA = UTILS.makeTrailRT(trailBufferSize.x, trailBufferSize.y);
    trailB = UTILS.makeTrailRT(trailBufferSize.x, trailBufferSize.y);
    trailRead = trailA, trailWrite = trailB;
    trailDecayTxA = UTILS.makeTrailRT(trailBufferSize.x, trailBufferSize.y);
    trailDecayTxB = UTILS.makeTrailRT(trailBufferSize.x, trailBufferSize.y);
    trailDecayRead = trailDecayTxA, trailDecayWrite = trailDecayTxB;

    // clear once
    renderer.setRenderTarget(trailA); 
    renderer.clear(true,false,false);
    renderer.setRenderTarget(trailB); 
    renderer.clear(true,false,false);
    renderer.setRenderTarget(trailDecayTxA); 
    renderer.clear(true,false,false);
    renderer.setRenderTarget(trailDecayTxB); 
    renderer.clear(true,false,false);
}
initTextures();

const fsq = new THREE.BufferGeometry();
const positions = new Float32Array([
    -1,-1, 0,
    3,-1, 0,
    -1, 3, 0
]);
fsq.setAttribute('position', new THREE.BufferAttribute(positions, 3));

// init state texture (rnd positions, zero velocities)
const N = params.TEX_SIDE * params.TEX_SIDE;
const init = new Float32Array(N*4);
for (let i=0;i<N;i++) {
    const k=i*4;
    // init[k] = W/2; //x
    // init[k+1] = H/2; //y
    // init[k] = 0.0; //x
    // init[k+1] = 0.0; //y
    init[k] = Math.random() * W; //x
    init[k+1] = Math.random() * H; //y
    //dx and dy
    init[k+2] = (Math.random() - 0.5) ; //x
    init[k+3] = (Math.random() - 0.5); //y
}

// const N = params.TEX_SIDE * params.TEX_SIDE;
// const init = new Float32Array(N * 4);
// const cx = W / 2;
// const cy = H / 2;
// const R = 500;
//
// for (let i = 0; i < N; i++) {
//     const k = i * 4;
//
//     // Random polar position
//     const theta = Math.random() * Math.PI * 2;
//     const r = Math.sqrt(Math.random()) * R;
//
//     // Cartesian position
//     const x = cx + r * Math.cos(theta);
//     const y = cy + r * Math.sin(theta);
//     init[k] = x;
//     init[k + 1] = y;
//
//     // Direction vector toward center
//     let dx = cx - x;
//     let dy = cy - y;
//
//     // Normalize
//     const len = Math.hypot(dx, dy) || 1;
//     dx /= len;
//     dy /= len;
//
//     // Scale by random speed factor if you like
//     const rnd = Math.random() - 0.5; // tweak
//     // init[k + 2] = dx * speed;
//     // init[k + 3] = dy * speed;
//     init[k+2] = (Math.random() - 0.5) ; //x
//     init[k+3] = (Math.random() - 0.5); //y
//
// }





// this texture will hold a matrix with the position of the pixels.
const initTex = new THREE.DataTexture(init, params.TEX_SIDE, params.TEX_SIDE, THREE.RGBAFormat, THREE.FloatType);
initTex.minFilter = THREE.NearestFilter;
initTex.magFilter = THREE.NearestFilter; 
initTex.needsUpdate = true;

// copy iniTex into both RTs so we have a clean start.
const matCopy = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uTex: { value: initTex}},
    vertexShader: simVert,
    fragmentShader: `
precision highp float;
precision highp sampler2D;
uniform sampler2D uTex;
out vec4 fc;

void main() {
ivec2 uv = ivec2(gl_FragCoord.xy);
fc = texelFetch(uTex, uv, 0);
}`,
    depthTest: false,
    depthWrite: false
});

const quadCopy = new THREE.Mesh(fsq, matCopy);
quadCopy.frustumCulled = false;
sceneSim.add(quadCopy);
renderer.setRenderTarget(rtA);
renderer.setClearColor(0x000000, 1);
renderer.clear(true, false, false);
renderer.render(sceneSim, camera);
renderer.setRenderTarget(rtB);
renderer.setClearColor(0x000000, 1);
renderer.clear(true, false, false);
renderer.render(sceneSim, camera);
sceneSim.remove(quadCopy);
matCopy.dispose();
initTex.dispose();


// Simulation material
// responsible for the data manipulation on the matrix (gathering, moving and saving agents data)
const matSim = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
        uState: { value: rtA.texture },
        uCanvas: { value: new THREE.Vector2(W, H) },
        uTime: { value: 0 },
        uDt: { value: 0.1 },
        // uDrag: { value: params.DRAG },
        uStepLen: { value: params.STEP_LEN },
        uTurnJitter: { value: params.TURN_JITTER },
        // uSpeedJitter: { value: params.SPEED_JITTER },
        uMouseDown: { value: mouseDown},
        uTrailTexSize: {value: new THREE.Vector2(trailBufferSize.x, trailBufferSize.y)}
    },
    vertexShader: simVert,
    fragmentShader: simFrag,
    depthTest:false, depthWrite:false
});
matSim.uniforms.uTrail     = { value: trailRead.texture };
matSim.uniforms.uSenseDist = { value: 30 };  // try 20–40
matSim.uniforms.uSenseAngle= { value: 0.3 };   // ~34°
// matSim.uniforms.uTurnRate  = { value: 40 };   // rad/sec
matSim.uniforms.uTurnRate  = { value: 20 };   // rad/sec
const quadSim = new THREE.Mesh(fsq, matSim); 
sceneSim.add(quadSim);

const ptsGeo = new THREE.BufferGeometry();
const dummy = new Float32Array(N*3);

ptsGeo.setAttribute('position', new THREE.BufferAttribute(dummy, 3));
ptsGeo.computeBoundingSphere();

const matPoints = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
        uState: { value: rtA.texture },
        uTexSize: { value: new THREE.Vector2(params.TEX_SIDE, params.TEX_SIDE) },
        uCanvas: { value: new THREE.Vector2(W, H) },
        uPointSize:{ value: params.POINT_SIZE },
        uMouseDown: {value: false},
        uMouseCoords: {value: prevmousecoords},
        uImageArea: { value: params.IMAGE_AREA},
        uCustomImageSize: {value: new THREE.Vector2(customImage.width, customImage.height)},
        uCustomImage: { value: customImage},
        uHasCustomImage: { value: false},
        uPointColor: { value: params.POINT_COLOR},

    },
    vertexShader: pointVert,
    fragmentShader: pointFrag,
    transparent:true, depthTest:false, depthWrite:false,
    blending: THREE.AdditiveBlending
});

const points = new THREE.Points(ptsGeo, matPoints);
points.frustumCulled = false;
sceneDraw.add(points);

// trail material
const matTrailDeposit = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
        uState:     { value: rtA.texture },
        uTexSize: { value: new THREE.Vector2(params.TEX_SIDE, params.TEX_SIDE) },
        uCanvas:    { value: new THREE.Vector2(W, H) },
        uPointSize: { value: 10.0 },
        uStrength:  { value: 1 },
        uEdgeSoft:  { value: 0.5 },
        uDt: {value: 1.0},
        uChampImportanceMultiplier: {value: params.CHAMP_IMP_MULTIPLIER},
        uChampSampleInterval:  { value: 1000 },
        uTrailTexSize: {value: new THREE.Vector2(trailBufferSize.x, trailBufferSize.y)}
    },
    vertexShader: trailVert,
    fragmentShader: trailFrag,
    depthTest:false, depthWrite:false,
    transparent:false
});
const pointsDeposit = new THREE.Points(ptsGeo, matTrailDeposit);
pointsDeposit.frustumCulled = false;
sceneTrail.add(pointsDeposit);

// trail decay material
const matTrailDecay = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
        uPrevDecay:  { value: trailDecayRead.texture }, // previous decay buffer
        uDeposit:    { value: trailRead.texture },      // previous frame’s deposits
        // check this color that is making everything blue
        uDecay:      { value: 0.1 },               // keep ~98.5% per frame (tune)
        uDt:         { value: 0.2 },
        uMouseCoords: { value: prevmousecoords},
        uMouseDown: { value: mouseDown}, 
        uCustomImageSize: {value: new THREE.Vector2(customImage.width, customImage.height)},
        uCustomImage: { value: customImage},
        uHasCustomImage: { value: false},
        uImageArea: { value: params.IMAGE_AREA},
        uCanvas:    { value: new THREE.Vector2(W, H) },
        uTrailTexSize: {value: new THREE.Vector2(trailBufferSize.x, trailBufferSize.y)},
        uTrailTexRes: {value: params.TRAIL_TEX_RES},
        uNuke: { value: nuke}
    },
    vertexShader: trailDecayVert,
    fragmentShader: trailDecayFrag,
    depthTest:false, depthWrite:false,
    transparent:false, blending: THREE.AdditiveBlending
});
const trailDecay = new THREE.Mesh(fsq, matTrailDecay);
trailDecay.frustumCulled = false;
sceneTrailDecay.add(trailDecay);

// ping pong RenderTarget helpers here
let readRT = rtA, writeRT = rtB;

// swap RTs using this function here
function swap(){
    // swap sim textures.
    const t = readRT;
    readRT = writeRT;
    writeRT = t;
    // and trail ones.
    const tt = trailRead;
    trailRead = trailWrite;
    trailWrite = tt;
    const ttt = trailDecayRead;
    trailDecayRead = trailDecayWrite;
    trailDecayWrite = ttt;
}
let frames = 0;
let lastTime = performance.now();
let fps = 0;
const timeMult = 0.001;
// main sim loop
let prev = performance.now()*timeMult;

function frame() {
    const now = performance.now()*timeMult;

    let dt = Math.min(Math.max(now - prev, timeMult), 0.05);

    matSim.uniforms.uDt.value    = dt;
    matTrailDeposit.uniforms.uDt.value = dt;
    matTrailDecay.uniforms.uDt.value    = dt;

    // dtEl.textContent = `${dt.toFixed(3)}`;

    prev = now;

    updateUniforms();

    matSim.uniforms.uCanvas.value = bufferSize.clone();
    matSim.uniforms.uTrailTexSize.value = trailBufferSize.clone();
    matTrailDeposit.uniforms.uCanvas.value = bufferSize.clone();
    matTrailDeposit.uniforms.uTrailTexSize.value = trailBufferSize.clone();
    matTrailDecay.uniforms.uCanvas.value = bufferSize.clone();
    matTrailDecay.uniforms.uTrailTexSize.value = trailBufferSize.clone();
    matPoints.uniforms.uCanvas.value = bufferSize.clone();

    matSim.uniforms.uTrail.value = trailDecayRead.texture;
    matSim.uniforms.uState.value = readRT.texture;
    matSim.uniforms.uTime.value  = now;


    renderer.setRenderTarget(writeRT);
    renderer.clear(true,false,false);
    renderer.render(sceneSim, camera);

    matTrailDecay.uniforms.uMouseCoords.value = prevmousecoords;
    matTrailDecay.uniforms.uCustomImageSize.value = new THREE.Vector2(customImage.width, customImage.height);
    matTrailDecay.uniforms.uCustomImage.value = customImage;
    matTrailDecay.uniforms.uHasCustomImage.value = true;
    matTrailDecay.uniforms.uNuke.value = nuke;
    matPoints.uniforms.uCustomImageSize.value = new THREE.Vector2(customImage.width, customImage.height);
    matPoints.uniforms.uCustomImage.value = customImage;
    matPoints.uniforms.uHasCustomImage.value = true;
    matPoints.uniforms.uMouseCoords.value = prevmousecoords;

    matTrailDeposit.uniforms.uState.value = writeRT.texture;   // deposit uses agent positions
    // matTrailDeposit.uniforms.uDt.value = dt;
    // ensure deposit maps world→trail correctly
    renderer.setRenderTarget(trailWrite);
    renderer.clear(true,false,false);
    renderer.render(sceneTrail, camera);

    // matTrailDecay will read from the trail deposit of the step before
    // in which we splattered all the dots for optimization purposes.
    matTrailDecay.uniforms.uPrevDecay.value = trailDecayRead.texture;
    matTrailDecay.uniforms.uDeposit.value = trailWrite.texture;
    renderer.setRenderTarget(trailDecayWrite);
    renderer.clear(true, false, false);
    renderer.render(sceneTrailDecay, camera);

    // swap buffet
    swap();

    // DRAW pass
    renderer.setRenderTarget(null); 
    renderer.clear(true, false, false);
    // renderer.render(sceneTrail, camera);
    if (params.SHOW_TRAIL) {
        renderer.render(sceneTrailDecay, camera);
    }
        renderer.render(sceneDraw, camera);

    frames++;
    const nowMs = performance.now();
    if (nowMs - lastTime >= 1000) {
        fps = (frames * 1000) / (nowMs - lastTime);
        // console.log(`${fps.toFixed(1)} fps`);
        fpsEl.textContent = `${fps.toFixed(1)} fps`;
        lastTime = nowMs;
        frames = 0;
    }

    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);




function updateUniforms () {
    matSim.uniforms.uStepLen.value = params.STEP_LEN;
    matSim.uniforms.uTurnJitter.value = params.TURN_JITTER;
    // matSim.uniforms.uSpeedJitter.value = params.SPEED_JITTER;
    matSim.uniforms.uSenseDist.value = params.SENSE_DIST;
    matSim.uniforms.uSenseAngle.value = params.SENSE_ANGLE;
    matSim.uniforms.uTurnRate.value = params.TURN_RATE;
    matPoints.uniforms.uPointSize.value = params.POINT_SIZE;
    matPoints.uniforms.uPointColor.value = params.POINT_COLOR;
    matTrailDeposit.uniforms.uPointSize.value = params.DEPOSIT_SIZE;
    matTrailDeposit.uniforms.uStrength.value = params.DEPOSIT_STRENGTH;
    matTrailDeposit.uniforms.uEdgeSoft.value = params.DEPOSIT_EDGE_SOFT;
    matTrailDeposit.uniforms.uChampSampleInterval.value = params.CHAMP_SAMPLE_INTERVAL;
    matTrailDeposit.uniforms.uChampImportanceMultiplier.value = params.CHAMP_IMP_MULTIPLIER;
    matTrailDecay.uniforms.uDecay.value = params.TRAIL_DECAY;


    matTrailDecay.uniforms.uMouseDown.value = mouseDown;
    matPoints.uniforms.uMouseDown.value = mouseDown;
}
