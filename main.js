import * as THREE from 'three';
import * as UTILS from '/utils.js';
import * as G from '/globals.js';
import simVert from './sim.vert?raw';
import simFrag from './sim.frag?raw';
import pointVert from './point.vert?raw';
import pointFrag from './point.frag?raw';
import trailFrag from './trailDeposit.frag?raw';
import trailVert from './trailDeposit.vert?raw';
import trailDecayVert from './trailDecay.vert?raw';
import trailDecayFrag from './trailDecay.frag?raw';
import imgUrl from './assets/aant.png';

async function loadShader(url) {
    const res = await fetch(url);
    return await res.text();
}

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
const RES = window.devicePixelRatio * G.RENDER_QUALITY;
const customImage = texLoader.load(imgUrl, () => {
    customImage.colorSpace = THREE.SRGBColorSpace;
    console.log(customImage.width, customImage.height);
});

const renderer = new THREE.WebGLRenderer();
renderer.autoClear = false;
// renderer.setSize(1000, 1000);
renderer.setSize( window.innerWidth, window.innerHeight );
document.body.appendChild( renderer.domElement );
renderer.setPixelRatio(RES);
const W = renderer.domElement.width, H = renderer.domElement.height;
const fpsEl = document.querySelector("#fps");
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
};

document.onmousedown = event => {
    mouseDown = true;
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


let rtA = UTILS.makeRT();
let rtB = UTILS.makeRT();
const trailA = UTILS.makeTrailRT(W, H);
const trailB = UTILS.makeTrailRT(W, H);
let trailRead = trailA, trailWrite = trailB;
let trailDecayTxA = UTILS.makeTrailRT(W, H);
let trailDecayTxB = UTILS.makeTrailRT(W, H);
let trailDecayRead = trailDecayTxA, trailDecayWrite = trailDecayTxB;

// clear once
renderer.setRenderTarget(trailA); 
renderer.clear(true,false,false);
renderer.setRenderTarget(trailB); 
renderer.clear(true,false,false);
renderer.setRenderTarget(trailDecayTxA); 
renderer.clear(true,false,false);
renderer.setRenderTarget(trailDecayTxB); 
renderer.clear(true,false,false);


const fsq = new THREE.BufferGeometry();
const positions = new Float32Array([
    -1,-1, 0,
    3,-1, 0,
    -1, 3, 0
]);
fsq.setAttribute('position', new THREE.BufferAttribute(positions, 3));

// init state texture (rnd positions, zero velocities)
const N = G.TEX_SIDE * G.TEX_SIDE;
const init = new Float32Array(N*4);
for (let i=0;i<N;i++) {
    const k=i*4;
    init[k] = W/2; //x
    init[k+1] = H/2; //y
    // init[k] = Math.random() * W; //x
    // init[k+1] = Math.random() * H; //y
    //dx and dy
    init[k+2] = (Math.random() - 0.5) ; //x
    init[k+3] = (Math.random() - 0.5); //y
}
// this texture will hold a matrix with the position of the pixels.
const initTex = new THREE.DataTexture(init, G.TEX_SIDE, G.TEX_SIDE, THREE.RGBAFormat, THREE.FloatType);
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
        // uDrag: { value: G.DRAG },
        uStepLen: { value: G.STEP_LEN },
        uJitter: { value: G.JITTER },
        uMouseDown: { value: mouseDown},
    },
    vertexShader: simVert,
    fragmentShader: simFrag,
    depthTest:false, depthWrite:false
});
matSim.uniforms.uTrail     = { value: trailRead.texture };
matSim.uniforms.uSenseDist = { value: 20 };  // try 20–40
matSim.uniforms.uSenseAngle= { value: 0.3 };   // ~34°
// matSim.uniforms.uTurnRate  = { value: 40 };   // rad/sec
matSim.uniforms.uTurnRate  = { value: 50 };   // rad/sec
const quadSim = new THREE.Mesh(fsq, matSim); 
sceneSim.add(quadSim);

// Points geometry: provide dummy positions so Three is happy
// keep in mind that this array could actually be filled with the center 
// coords over and over. the only reason this is made this way is to fill up 
// the grid and see if this is actually rendering properly.
// there's no other reason why we're filling up the whole square like that.
const ptsGeo = new THREE.BufferGeometry();
const dummy = new Float32Array(N*3);
for (let i=0;i<N;i++){
    const ix = i % G.TEX_SIDE;           // column index
    const iy = (i / G.TEX_SIDE) | 0;     // row index (fast floor)
    const x  = (ix/(G.TEX_SIDE-1))*2 - 1;  // map [0..G.TEX_SIDE-1] → [-1..+1]
    const y  = (iy/(G.TEX_SIDE-1))*2 - 1;
    const k  = i*3;
    dummy[k]   = x;
    dummy[k+1] = y;
    dummy[k+2] = 0;
}

ptsGeo.setAttribute('position', new THREE.BufferAttribute(dummy, 3));
ptsGeo.computeBoundingSphere();

const matPoints = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
        uState: { value: rtA.texture },
        uTexSize: { value: new THREE.Vector2(G.TEX_SIDE, G.TEX_SIDE) },
        uCanvas: { value: new THREE.Vector2(W, H) },
        uPointSize:{ value: G.POINT_SIZE },
        uMouseDown: {value: false},
        uMouseCoords: {value: prevmousecoords},
        uImageArea: { value: G.IMAGE_AREA},
        uCustomImageSize: {value: new THREE.Vector2(customImage.width, customImage.height)},
        uCustomImage: { value: customImage},
        uHasCustomImage: { value: false},
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
        uTexSize: { value: new THREE.Vector2(G.TEX_SIDE, G.TEX_SIDE) },
        uCanvas:    { value: new THREE.Vector2(W, H) },
        uPointSize: { value: 10.0 },
        uStrength:  { value: 1 },
        uEdgeSoft:  { value: 0.5 },
        uChampSampleInterval:  { value: 1000 },
    },
    vertexShader: trailVert,
    fragmentShader: trailFrag,
    depthTest:false, depthWrite:false,
    transparent:false, blending: THREE.NoBlending
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
        uDecay:      { value: 0.8 },               // keep ~98.5% per frame (tune)
        uDt:         { value: 0.2 },
        uMouseCoords: { value: prevmousecoords},
        uMouseDown: { value: mouseDown}, 
        uCustomImageSize: {value: new THREE.Vector2(customImage.width, customImage.height)},
        uCustomImage: { value: customImage},
        uHasCustomImage: { value: false},
        uImageArea: { value: G.IMAGE_AREA},
        uCanvas:    { value: new THREE.Vector2(W, H) },
        uNuke: { value: nuke}
    },
    vertexShader: trailDecayVert,
    fragmentShader: trailDecayFrag,
    depthTest:false, depthWrite:false,
    transparent:false, blending: THREE.NoBlending
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

    prev = now;
    matSim.uniforms.uTrail.value = trailDecayRead.texture;
    matSim.uniforms.uState.value = readRT.texture;
    matSim.uniforms.uTime.value  = now;
    matSim.uniforms.uDt.value    = dt;

    renderer.setRenderTarget(writeRT);
    renderer.clear(true,false,false);
    renderer.render(sceneSim, camera);

    matTrailDecay.uniforms.uMouseCoords.value = prevmousecoords;
    matTrailDecay.uniforms.uMouseDown.value = mouseDown;
    matTrailDecay.uniforms.uCustomImageSize.value = new THREE.Vector2(customImage.width, customImage.height);
    matTrailDecay.uniforms.uCustomImage.value = customImage;
    matTrailDecay.uniforms.uHasCustomImage.value = true;
    matTrailDecay.uniforms.uNuke.value = nuke;
    matPoints.uniforms.uCustomImageSize.value = new THREE.Vector2(customImage.width, customImage.height);
    matPoints.uniforms.uCustomImage.value = customImage;
    matPoints.uniforms.uHasCustomImage.value = true;
    matPoints.uniforms.uMouseDown.value = mouseDown;
    matPoints.uniforms.uMouseCoords.value = prevmousecoords;
    matSim.uniforms.uMouseDown.value = mouseDown;
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
    //renderer.render(sceneTrail, camera);
    // renderer.render(sceneTrailDecay, camera);

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
