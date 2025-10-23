precision highp float;
precision highp sampler2D;

uniform sampler2D uPrevDecay; // W×H
uniform sampler2D uDeposit;   // W×H
uniform float     uDecay;     // e.g. 0.985..0.999
out vec4 fc;
uniform vec2 uMouseCoords;
uniform bool uMouseDown;


void main() {
    ivec2 uv  = ivec2(gl_FragCoord.xy);
    vec4 dec  = texelFetch(uPrevDecay, uv, 0);
    vec4 dep  = texelFetch(uDeposit,   uv, 0);

    // decay only R channel (density), keep others zero
    float decay = dec.r - 0.1 * uDecay;
    // float d = max(dec.r * uDecay, dep.r);
    float d = max(decay + dep.r, 0.0);
    if (uMouseDown) {
        // if we are close to mouse coords clean up.
        if (distance(gl_FragCoord.xy, uMouseCoords) < 100.0) d = 0.0;
    }
    fc = vec4(d, 0.0, 0.0, 1.0);
}
