precision highp float;
precision highp int;
out vec4 fragColor;

in float vImportance;
flat in int vVID;

uniform sampler2D uCustomImage;
uniform vec2  uCustomImageSize; // desired on-screen pixel size of the image
uniform vec2  uCanvas;          // canvas size in pixels
uniform vec2  uMouseCoords;
uniform bool  uMouseOnCanvas;
uniform bool  uMouseDown;
uniform bool  uHasCustomImage;
uniform float uImageArea;
uniform float uImageRevealArea;
uniform vec3  uPointColor;
uniform vec3 uSecondaryColor;
uniform int uSecondaryColorAmount;
uniform vec3 uTertiaryColor;
uniform int uTertiaryColorAmount;

in float vIsSecondary;
in float vIsTertiary;

void main() {
    // base point look (keep your point styling as-is)
    vec2 p = gl_PointCoord - 0.5;
    vec4 color = vec4(uPointColor, 0.3);

    // is secondary
    if (vIsSecondary == 1.0) {
        color = vec4(uSecondaryColor,0.3);
    } else if (vIsTertiary == 1.0) {
        color = vec4(uTertiaryColor,0.3);
    }

    // if (uMouseDown && uHasCustomImage) {
    if (uHasCustomImage) {
        // Top-left of the image so that it's centered and sized to uCustomImageSize
        vec2 topLeft = 0.5 * (uCanvas - uCustomImageSize);

        // Fragment position relative to the image's top-left, in pixels
        vec2 px = gl_FragCoord.xy - topLeft;

        // Convert to UVs in [0,1] over the image rect
        vec2 uv = px / uCustomImageSize;

        // Check we're inside the image bounds before sampling
        bool inside =
            uv.x >= 0.0 && uv.x < 1.0 &&
            uv.y >= 0.0 && uv.y < 1.0;

        vec4 customImage = vec4(0.0);
        if (inside) {
            // Sample using normalized UVs
            customImage = texture(uCustomImage, uv);
        }

        float dist = distance(gl_FragCoord.xy, uCanvas*0.5);
        if (uHasCustomImage && dist < uImageRevealArea) {
            // - 0.2 shifts the color to make a bit larger
            float t = smoothstep(1.0, 0.0, (dist / uImageRevealArea) - 0.2);

            // // Only use the image color if the source alpha is solid enough
            // vec3 imgColor = (customImage.a > 0.8) ? (customImage.rgb * t) : vec3(0.0);
            // we are not working with the alpha anymore, if black, discard.
            float colorAmount = customImage.r + customImage.g + customImage.b;
            vec3 imgColor = (colorAmount > 0.4) ? customImage.rgb : vec3(0.0);

                // color.rgb = vec3(t);
            // this check avoid black circle cuts
            if (colorAmount > 0.7) {
                // Simple crossfade: image dominates toward the cursor center
                // color.rgb = imgColor.rgb ;//+ (color.rgb - imgColor.rgb);
                // color.rgb = smoothstep(color.rgb, customImage.rgb, vec3(0.5));
                color.rgb = mix(color.rgb, customImage.rgb, t);
                // color.rgb = customImage.rgb;
            }
        }
    }
    // Distance gating around the mouse
    float mouseDist = distance(gl_FragCoord.xy, uMouseCoords);
    // float area = max(uCanvas.x, uCanvas.y);
    float area = 100.0;
    if (uMouseOnCanvas && mouseDist < area) {
        // color += 1.0/mouseDist;
        // color = vec4(vec3(0.0),1.0);
        // color.r = area/mouseDist;
        // color *= 1.0/smoothstep(0.0, 1.0, 1.0/area * mouseDist);
        // color = mix(color, vec4(1.0), 1.0/area * mouseDist);
        color = mix(color, vec4(1.0), 1.0 - mouseDist / area);
        // cap, otherwise bloom will send us to jesus after.
        // color = clamp(vec4(0.0), vec4(1.0), color);
    }

    fragColor = color;
}

