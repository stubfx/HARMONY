precision highp float;
out vec4 fragColor;

in float vImportance;

uniform sampler2D uCustomImage;
uniform vec2  uCustomImageSize; // desired on-screen pixel size of the image
uniform vec2  uCanvas;          // canvas size in pixels
uniform vec2  uMouseCoords;
uniform bool  uMouseDown;
uniform bool  uHasCustomImage;
uniform float uImageArea;
uniform vec3  uPointColor;

void main() {
    // base point look (keep your point styling as-is)
    vec2 p = gl_PointCoord - 0.5;
    vec4 color = vec4(uPointColor, 0.5);

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

        // Distance gating around the mouse
        // float dist = distance(gl_FragCoord.xy, uMouseCoords);
        float dist = distance(gl_FragCoord.xy, uCanvas*0.5);
        if (dist < uImageArea) {
            float t = smoothstep(1.0, 0.0, dist / uImageArea);

            // // Only use the image color if the source alpha is solid enough
            // vec3 imgColor = (customImage.a > 0.8) ? (customImage.rgb * t) : vec3(0.0);
            // we are not working with the alpha anymore, if black, discard.
            float colorAmount = customImage.r + customImage.g + customImage.b;
            vec3 imgColor = (colorAmount > 0.4) ? customImage.rgb*t : vec3(0.0);

            // Simple crossfade: image dominates toward the cursor center
            color.rgb = color.rgb * (1.0 - t) + customImage.rgb;
        }
    }

    fragColor = color;
}

