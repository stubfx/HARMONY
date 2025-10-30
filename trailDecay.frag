precision highp float;
precision highp sampler2D;

uniform sampler2D uPrevDecay; // W×H
uniform sampler2D uDeposit;   // W×H
uniform bool uHasCustomImage;
uniform sampler2D uCustomImage;
uniform vec2 uCustomImageSize;
uniform float     uDecay;     // e.g. 0.985..0.999
uniform float uImageArea;
uniform float uImageRevealArea;
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
    vec2 trailMouseCoords;
    float dist;
    if (uNuke) {
        color = vec4(0.0);
    }
    else if (uHasCustomImage) {
        // Desired on-RT size = original size scaled by trailRes
        vec2 scaledSize = uCustomImageSize * uTrailTexRes;

        // Center on the trail RT (whose pixel size = uCanvas * uTrailTexRes)
        vec2 trailSize = uCanvas * uTrailTexRes;
        vec2 topLeft   = 0.5 * (trailSize - scaledSize);
        dist = distance(gl_FragCoord.xy, uCanvas*uTrailTexRes*0.5);

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
        if (uHasCustomImage && dist < uImageRevealArea * uTrailTexRes) {
            dist = smoothstep(1.0, 0.0, dist/scaledImageArea);
            // WATCH OUT
            // AS WE ARE USING THE RED CHANNEL FOR SENSING THE TRAIL
            // WE MUST DUMP THE TRAIL INTO THAT FOR THE SIM TO WORK.
            // customImage.r = customImage.w;
            // we are not working with the alpha anymore, if black, discard.
            float colorAmount = customImage.r + customImage.g + customImage.b;
            customImage.r = (colorAmount > 0.4) ? colorAmount * 1000.0 : 0.0;
            customImage.gb = vec2(0.0);



            // color = customImage*dist;
            // do not consider the dist, otherwise everything will try to go in the middle.
            // later this could be actually animated tho.
            // the higher the d must
            // color = customImage;
            // color = customImage + d * (1.0 - dist);


            // use this if you need a clean circle for the image
            // color = customImage * dist;
            // this will make it look like the image is tangled in this
            color = mix(customImage, d, 1.0 - dist);
            // return;
        }
        // }
    }
    if (uMouseDown) {
        trailMouseCoords = uMouseCoords * uTrailTexRes;
        dist = distance(gl_FragCoord.xy, trailMouseCoords);
        float mouseArea = uImageArea*0.2;
        if (dist < mouseArea) {
            color = vec4(0.0);
        }
    }
    // color.w = clamp(color.w, 0.0, 20.0);
    fc = color;
}
