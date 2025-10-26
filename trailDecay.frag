precision highp float;
precision highp sampler2D;

uniform sampler2D uPrevDecay; // W×H
uniform sampler2D uDeposit;   // W×H
uniform bool uHasCustomImage;
uniform sampler2D uCustomImage;
uniform vec2 uCustomImageSize;
uniform float     uDecay;     // e.g. 0.985..0.999
uniform float uImageArea;
uniform float uDt;
uniform vec2 uMouseCoords;
uniform bool uMouseDown;
uniform vec2 uCanvas;
uniform vec2 uBufferSize;
uniform bool uNuke;
out vec4 fc;


void main() {
    // ivec2 uv  = ivec2(gl_FragCoord.xy * (uCanvas / uBufferSize));
    ivec2 uv  = ivec2(gl_FragCoord.xy);

    vec4 dec  = texelFetch(uPrevDecay, uv, 0);
    vec4 dep  = texelFetch(uDeposit,   uv, 0);


    vec4 decay = dec - uDecay * uDt;
    // vec4 d = max(dec * uDecay, dep);
    vec4 d = max(decay + dep, 0.0);
    vec4 color = d;
    if (uNuke) {
        color = vec4(0.0);
    }
    else if (uHasCustomImage) {
        if (uMouseDown) {
            // if (distance(gl_FragCoord.xy, uMouseCoords) < 100.0) d = 0.0;
            float dist = distance(gl_FragCoord.xy, uMouseCoords);
            vec2 topLeft = 0.5 * (uCanvas - uCustomImageSize);
            ivec2 imagePlacement  = ivec2(floor(gl_FragCoord.xy - topLeft));
            bvec2 ge0 = greaterThanEqual(imagePlacement, ivec2(0));
            bvec2 ltS = lessThan(imagePlacement, ivec2(uCustomImageSize));
            bool inImg = all(ge0) && all(ltS);

            vec4 customImage = vec4(0.0);
            if (inImg) customImage = texelFetch(uCustomImage, imagePlacement, 0);
            if (dist < uImageArea) {
                dist = smoothstep(1.0, 0.3, dist/uImageArea);
                // WATCH OUT
                // AS WE ARE USING THE RED CHANNEL FOR SENSING THE TRAIL
                // WE MUST DUMP THE TRAIL INTO THAT FOR THE SIM TO WORK.
                customImage.r = customImage.w;
                color = customImage*dist;
                // color = customImage*dist + d * 0.3;
                // fc = customImage * dist;
                // return;
            }
        }
    }
    // color.w = clamp(color.w, 0.0, 20.0);
    fc = color;
}
