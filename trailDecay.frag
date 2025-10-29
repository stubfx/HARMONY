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
uniform float uTrailTexRes;
uniform bool uNuke;
out vec4 fc;


void main() {
    ivec2 uv  = ivec2(gl_FragCoord.xy);

    vec4 dec  = texelFetch(uPrevDecay, uv, 0);
    vec4 dep  = texelFetch(uDeposit,   uv, 0);


    // vec4 decay = dec - uDecay * uDt;
    // vec4 d = max(dec * uDecay, dep);
    // vec4 d = max(decay + dep, 0.0);
    float keep = pow(uDecay, uDt);
    vec4 d = dec * keep + dep;
    vec4 color = d;
    if (uNuke) {
        color = vec4(0.0);
    }
    else if (uHasCustomImage) {
        // if (uMouseDown) {
            // dist is now from the image center.
            // vec2 trailMouseCoords = uMouseCoords * uTrailTexRes;
            // float dist = distance(gl_FragCoord.xy, trailMouseCoords);


            // Desired on-RT size = original size scaled by trailRes
            vec2 scaledSize = uCustomImageSize * uTrailTexRes;

            // Center on the trail RT (whose pixel size = uCanvas * uTrailTexRes)
            vec2 trailSize = uCanvas * uTrailTexRes;
            vec2 topLeft   = 0.5 * (trailSize - scaledSize);
            float dist = distance(gl_FragCoord.xy, uCanvas*uTrailTexRes*0.5);

            // Position of this fragment relative to the image rectangle (in trail pixels)
            vec2 rel       = gl_FragCoord.xy - topLeft;

            // Normalized UV into the source image (0..1)
            vec2 uv        = rel / scaledSize;

            // Inside the image?
            bvec2 in0 = greaterThanEqual(uv, vec2(0.0));
            bvec2 in1 = lessThan(uv, vec2(1.0));
            bool inImg = all(in0) && all(in1);

            vec4 customImage = vec4(0.0);
            if (inImg) {
                // Filtering chosen by sampler state:
                //   NearestFilter  -> crisp pixels
                //   LinearFilter   -> smooth scale
                customImage = texture(uCustomImage, uv);
            }
            float scaledImageArea = uImageArea * uTrailTexRes;
            if (dist < scaledImageArea) {
                dist = smoothstep(1.0, 0.1, dist/scaledImageArea);
                // WATCH OUT
                // AS WE ARE USING THE RED CHANNEL FOR SENSING THE TRAIL
                // WE MUST DUMP THE TRAIL INTO THAT FOR THE SIM TO WORK.
                customImage.r = customImage.w;
                color = customImage*dist;
                // color = customImage*dist + d * 0.3;
                // fc = customImage * dist;
                // return;
            }
        // }
    }
    // color.w = clamp(color.w, 0.0, 20.0);
    fc = color;
}
