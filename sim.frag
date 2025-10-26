precision highp float; precision highp sampler2D;

uniform sampler2D uState;
uniform vec2      uCanvas;
uniform vec2      uTrailTexSize;
uniform float     uTime, uDt, uDrag, uStepLen;
uniform float uTurnJitter;
// uniform float uSpeedJitter;

uniform sampler2D uTrail;
uniform float     uSenseDist;
uniform float     uSenseAngle;   // radians
uniform float     uTurnRate;     // radians/sec
uniform bool uMouseDown;

out vec4 fragColor;

vec2 rot(vec2 v, float a){
    float c = cos(a), s = sin(a);
    return mat2(c,-s,s,c) * v;
}

// // helper: clamp and sample exact pixel
// float sampleTrailPX(vec2 pPx) {
//     // pPx is in pixel coords, origin = bottom-left
//     vec2 p = clamp(pPx, vec2(0.0), uCanvas - vec2(1.0));
//     ivec2 uv = ivec2(p);
//     return texelFetch(uTrail, uv, 0).r;  // use .r channel for density
// }

// pPx is agent position in FULL-RES pixels (same space as uCanvas)
float sampleTrail_atPos(vec2 pPx) {
    vec2 uv = pPx / uCanvas;     // 0..1 in full-res space
    // uv.y = 1.0 - uv.y;           // flip if your pos origin is top-left
    uv = clamp(uv, 0.0, 1.0);
    return texture(uTrail, uv).r;   // linear/nearest depends on RT filtering
}

float sampleTrailPX_flipped(vec2 pPx) {
    vec2 p = vec2(pPx.x, uCanvas.y - 1.0 - pPx.y);
    // return sampleTrailPX(p);
    return sampleTrail_atPos(p);
}

void main(){
    ivec2 uv = ivec2(gl_FragCoord.xy);
    vec4 s   = texelFetch(uState, uv, 0);
    vec2 pos = s.xy;
    vec2 dir = normalize(s.zw);
    // if (uMouseDown) {
    //     dir = vec2(0.0);
    //     fragColor = vec4(pos, dir);
    //     return;
    // }
    if (!all(greaterThan(abs(dir), vec2(0.0001)))) dir = vec2(1.0, 0.0);

    float weightForward = sampleTrailPX_flipped(pos +  uSenseDist * dir);
    float weightLeft    = sampleTrailPX_flipped(pos +  uSenseDist * rot(dir,  uSenseAngle));
    float weightRight   = sampleTrailPX_flipped(pos +  uSenseDist * rot(dir, -uSenseAngle));

    float rnd = fract(sin(dot(vec3(gl_FragCoord.xy, floor(uTime*uDt)),
                              vec3(127.1,311.7,74.7))) * 43758.5453123);

    float turnUnit = 0.0;
    if (weightForward < weightLeft && weightForward < weightRight) {
        turnUnit = (rnd - 0.5);
    } else if (weightRight > weightLeft) {
        turnUnit = -rnd;
    } else if (weightLeft > weightRight) {
        turnUnit = +rnd;
    }

    turnUnit *= uTurnJitter;

    float maxTurn = uTurnRate * uDt;
    float dTheta  = clamp(turnUnit * maxTurn, -maxTurn, +maxTurn);
    dir = normalize(rot(dir, dTheta));

    // float speed = uStepLen * rnd * 1.5;
    float speed = uStepLen;
    pos += dir * speed * uDt;
    
    // WATCH OUT YOU MIGHT WANT THIS ON!!!
    pos = mod(pos + uCanvas, uCanvas);
    //-------------------------------------

    // UNCOMMENT THIS TO KEEP THEM CONFINED IN THE WORLD.
    // if (pos.x < 0.0) dir.x = -dir.x;
    // if (pos.x > uCanvas.x) dir.x = -dir.x;
    // if (pos.y < 0.0) dir.y = -dir.y;
    // if (pos.y > uCanvas.y) dir.y = -dir.y;
    //----------------------------------------

    // Removed zeroing block that killed particles.

    fragColor = vec4(pos, dir);
}

