precision highp float;
precision highp sampler2D;

uniform sampler2D uPrevDecay; // W×H
uniform sampler2D uDeposit;   // W×H
uniform bool uHasCustomImage;
uniform sampler2D uCustomImage;
uniform vec2 uCustomImageSize;
uniform float     uDecay;     // e.g. 0.985..0.999
uniform float uImageArea;
uniform vec2 uMouseCoords;
uniform bool uMouseDown;
uniform vec2 uCanvas;
out vec4 fc;


void main() {
    ivec2 uv  = ivec2(gl_FragCoord.xy);
    vec4 dec  = texelFetch(uPrevDecay, uv, 0);
    vec4 dep  = texelFetch(uDeposit,   uv, 0);


    vec4 decay = dec - 0.1 * uDecay;
    // vec4 d = max(dec * uDecay, dep);
    vec4 d = max(decay + dep, 0.0);
    vec4 color = d;
    if (uHasCustomImage) {
        if (uMouseDown) {
            // if (distance(gl_FragCoord.xy, uMouseCoords) < 100.0) d = 0.0;
            float dist = distance(gl_FragCoord.xy, uMouseCoords);
            // ivec2 imagePlacement  = ivec2(uCanvas/2.0 - gl_FragCoord.xy);
            vec2 topLeft = 0.5 * (uCanvas - uCustomImageSize);
            ivec2 imagePlacement  = ivec2(floor(gl_FragCoord.xy - topLeft));
            // image dimensions should be fixed.
            // we subtract half the dimensions of them.
            // imagePlacement += ivec2(uCustomImageSize)/2;
            vec4 customImage = texelFetch(uCustomImage,   imagePlacement, 0);
            if (dist < uImageArea) {
                // consider only the image at this coords.
                // d = vec4(100.0/dist);
            // if we are close to mouse coords clean up.
            dist = smoothstep(1.0, 0.2, dist/uImageArea);
            // fc = customImage * dist + d;
            fc = customImage * dist;
            return;
            }
            fc = customImage + d;
            // color += customImage * 1000.0;
        }
    }
    fc = color;
}
