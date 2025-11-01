import * as THREE from 'three';
import { params } from './tunables';

export function deepReplace(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object'
    ) {
      deepReplace(target[key], source[key]); // recurse
    } else {
      target[key] = source[key]; // replace value
    }
  }
}


export function makeRT() {
    return new THREE.WebGLRenderTarget(params.TEX_SIDE, params.TEX_SIDE, {
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
        type: THREE.FloatType, format: THREE.RedFormat,
        depthBuffer:false, stencilBuffer:false
    });
}

export function getHex(color) {
    return new THREE.Color(color).getHex();
}

export function getRGB(c) {
    return new THREE.Color(c.r,c.g,c.b);
}

export function isDEV() {
    return import.meta.env.VITE_ENV != "DEV";
}
