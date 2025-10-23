import * as THREE from 'three';
import * as G from '/globals.js';

export function makeRT() {
    return new THREE.WebGLRenderTarget(G.TEX_SIDE, G.TEX_SIDE, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false
    });
}

export function makeTrailRT(w, h){
  return new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    type: THREE.FloatType, format: THREE.RGBAFormat,
    depthBuffer:false, stencilBuffer:false
  });
}
