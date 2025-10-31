precision highp float; precision highp sampler2D;
precision highp int;


uniform sampler2D uState; // current state texture
uniform ivec2 uTexSize;
uniform vec2 uCanvas;
uniform float uPointSize;
uniform vec2 uMouse;
uniform bool uMouseDown;

uniform int uSecondaryColorAmount;
out float vIsSecondary;
uniform int uTertiaryColorAmount;
out float vIsTertiary;


flat out int vVID;
out float vImportance;

void main(){
    int index = gl_VertexID;
    int ix = index % uTexSize.x;
    int iy = index / uTexSize.y;
    vec4 s = texelFetch(uState, ivec2(ix,iy), 0);
    vec2 pos = s.xy;
    vec2 ndc = (pos / uCanvas) * 2.0 - 1.0; ndc.y = -ndc.y;
    gl_Position = vec4(ndc, 0.0, 1.0);
    gl_PointSize = uPointSize;
    vImportance = 1.0;
    vVID = gl_VertexID;
    int maxIndex = uTexSize.x * uTexSize.y;
    // isSecondary
    if (index % 100/uSecondaryColorAmount == 0) {
        vIsSecondary = 1.0;
    } else if (index % 100/uTertiaryColorAmount == 0) {
        vIsTertiary = 1.0;
    }

}
