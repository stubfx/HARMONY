precision highp float;

uniform float uStrength;  // e.g. 0.05–0.2
uniform float uEdgeSoft;  // e.g. 0.5
uniform float uDt;        // seconds since last frame
uniform vec2 uMouse;
out vec4 fragColor;
uniform float uChampImportanceMultiplier;
in float vIsChamp;

void main() {
    // round splat: gl_PointCoord is [0..1] within the point
    float d = length(gl_PointCoord - 0.5);
    float m = smoothstep(0.5, 0.0, d);  // soft edge
    // float m = 0.05;
    m *= uStrength * uDt;
    if (vIsChamp > 0.5) m *= uChampImportanceMultiplier;
    fragColor = vec4(m, 0.0, 0.0, 1.0);   // write density into .r
}
