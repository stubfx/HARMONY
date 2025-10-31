varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec3 color;
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

vec4 blur9(sampler2D image, vec2 uv, vec2 resolution) {
  vec2 texel = 1.0 / resolution;
  vec4 sum = vec4(0.0);

  sum += texture2D(image, uv + texel * vec2(-1.0, -1.0));
  sum += texture2D(image, uv + texel * vec2( 0.0, -1.0));
  sum += texture2D(image, uv + texel * vec2( 1.0, -1.0));
  sum += texture2D(image, uv + texel * vec2(-1.0,  0.0));
  sum += texture2D(image, uv);
  sum += texture2D(image, uv + texel * vec2( 1.0,  0.0));
  sum += texture2D(image, uv + texel * vec2(-1.0,  1.0));
  sum += texture2D(image, uv + texel * vec2( 0.0,  1.0));
  sum += texture2D(image, uv + texel * vec2( 1.0,  1.0));

  return sum * (1.0 / 9.0);
}

vec4 blur25(sampler2D img, vec2 uv, vec2 res) {
  vec2 texel = 1.0 / res;
  vec4 sum = vec4(0.0);
  for (int x = -2; x <= 2; ++x)
    for (int y = -2; y <= 2; ++y)
      sum += texture2D(img, uv + texel * vec2(float(x), float(y)));
  return sum / 25.0;
}

void main() {
    vec4 previousPassColor = texture2D(tDiffuse, vUv);
    vec2 trailMouseCoords;
    float dist;
    vec4 color = previousPassColor;

    if (uHasCustomImage) {
        // Desired on-RT size = original size scaled by trailRes
        // vec2 scaledSize = uCustomImageSize * uTrailTexRes;
        vec2 scaledSize = uCustomImageSize;

        // Center on the trail RT (whose pixel size = uCanvas * uTrailTexRes)
        // vec2 trailSize = uCanvas * uTrailTexRes;
        vec2 trailSize = uCanvas;
        vec2 topLeft   = 0.5 * (trailSize - scaledSize);
        // dist = distance(gl_FragCoord.xy, uCanvas*uTrailTexRes*0.5);
        dist = distance(gl_FragCoord.xy, uCanvas*0.5);

        // Position of this fragment relative to the image rectangle (in trail pixels)
        vec2 rel       = gl_FragCoord.xy - topLeft;

        // Normalized UV into the source image (0..1)
        vec2 uv        = rel / scaledSize;

        // Inside the image?
        bvec2 in0 = greaterThanEqual(uv, vec2(0.0));
        bvec2 in1 = lessThan(uv, vec2(1.0));
        bool inImg = all(in0) && all(in1);

        vec4 customImage = vec4(0.0);
        float scaledImageArea = uImageArea;
        // if (uHasCustomImage && dist < uImageRevealArea) {
        if (uHasCustomImage) {
            if (inImg) {
                // Filtering chosen by sampler state:
                //   NearestFilter  -> crisp pixels
                //   LinearFilter   -> smooth scale
                customImage = blur25(uCustomImage, uv, uCustomImageSize / 2.0);
                // customImage = texture(uCustomImage, uv);
                dist = smoothstep(1.0, 0.0, dist/uImageRevealArea);
                // WATCH OUT
                // AS WE ARE USING THE RED CHANNEL FOR SENSING THE TRAIL
                // WE MUST DUMP THE TRAIL INTO THAT FOR THE SIM TO WORK.
                // customImage.r = customImage.w;
                // we are not working with the alpha anymore, if black, discard.
                float colorAmount = customImage.r + customImage.g + customImage.b;

                if (colorAmount > 0.1) {
                    // color += customImage * 0.3;
                    color += mix(customImage*0.5, vec4(0.0), 1.0 - dist);
                }
            }
            // return;
        }
        // }
    }
    // if (uMouseDown) {
    //     // trailMouseCoords = uMouseCoords * uTrailTexRes;
    //     dist = distance(gl_FragCoord.xy, uMouseCoords);
    //     float mouseArea = uImageArea*0.2;
    //         color += vec4(smoothstep(0.0, 0.1, 1.0 - dist/mouseArea));
    // }
    // color.w = clamp(color.w, 0.0, 20.0);
    gl_FragColor = color;

}
