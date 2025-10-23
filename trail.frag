precision highp float;

uniform float uStrength;  // e.g. 0.05–0.2
uniform float uEdgeSoft;  // e.g. 0.5
uniform float uDt;        // seconds since last frame
uniform vec2 uMouse;
out vec4 fragColor;
in float vImportance;

void main() {
    // round splat: gl_PointCoord is [0..1] within the point
    float d = length(gl_PointCoord - 0.5);
    float m = smoothstep(0.5, 0.0, d);  // soft edge
    m *= uStrength * vImportance;
    fragColor = vec4(m, 0.0, 0.0, 1.0);        // write density into .r
}
