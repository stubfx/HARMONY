precision highp float; precision highp sampler2D;


uniform sampler2D uState; // current state texture
uniform ivec2 uTexSize;
uniform vec2 uCanvas;
uniform vec2 uTrailTexSize;
uniform float uPointSize;
uniform vec2 uMouse;
uniform bool uMouseDown;
uniform int uChampSampleInterval;
out float vIsChamp;

void main(){
    int index = gl_VertexID;
    int ix = index % uTexSize.x;
    int iy = index / uTexSize.x;
    vec4 s = texelFetch(uState, ivec2(ix,iy), 0);
    vec2 posFull = s.xy; // agent pos in full-res pixel space

    // we gotta convert it from full res to trail texture space
    vec2 posTrail = posFull * (uTrailTexSize / uCanvas);

    // now back to NDC (normalized device coords) based on the trail texture space
    vec2 ndc = (posTrail / uTrailTexSize) * 2.0 - 1.0;
    ndc.y = -ndc.y;

    gl_Position = vec4(ndc, 0.0, 1.0);
    gl_PointSize = uPointSize;
    if (index % uChampSampleInterval == 0) {
        vIsChamp = 1.0;
        gl_PointSize *= 5.0;
    } else {
        vIsChamp = 0.0;
    }
}
