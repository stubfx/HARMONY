precision highp float; precision highp sampler2D;


uniform sampler2D uState; // current state texture
uniform ivec2 uTexSize;
uniform vec2 uCanvas;
uniform float uPointSize;
uniform vec2 uMouse;
uniform bool uMouseDown;
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
    if (index % 10000 == 0) {
        vImportance = 1000.0;
        gl_PointSize *= 5.0;
    }
}
