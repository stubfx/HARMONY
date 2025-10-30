import * as THREE from 'three';
import { params } from '../tunables';

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

export function isDEV() {
    return import.meta.env.VITE_ENV != "DEV";
}
