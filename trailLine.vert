precision highp float;
precision highp sampler2D;

uniform ivec2 uTexSize;   // agents grid (TEX_SIDE, TEX_SIDE)
uniform vec2  uCanvas;    // world size (usually W,H)
uniform float uPointSize; // pixel size

void main() {
    int index = gl_VertexID;
    int total = uTexSize.x * uTexSize.y;
    float t = float(index) / float(total - 1);

    // horizontal line across the middle of the world
    vec2 pos = vec2(t * uCanvas.x, 0.5 * uCanvas.y);

    // convert world → clip space
    vec2 ndc = (pos / uCanvas) * 2.0 - 1.0;
    ndc.y = -ndc.y;

    gl_Position = vec4(ndc, 0.0, 1.0);
    gl_PointSize = uPointSize;
}

