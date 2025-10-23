precision highp float; precision highp sampler2D;

// existing uniforms...
uniform sampler2D uState;
uniform vec2      uCanvas;
uniform float     uTime, uDt, uDrag, uStepLen, uJitter;

// NEW: the trail field and sensing knobs
uniform sampler2D uTrail;       // trailRead (R channel stores intensity)
uniform float     uSenseDist;   // in world pixels, e.g. 25.0
uniform float     uSenseAngle;  // in radians, e.g. 0.6
uniform float     uTurnRate;    // max radians/sec, e.g. 3.0

out vec4 fragColor;

float hash13(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453123); }

vec2 rot(vec2 v, float a){
    float c = cos(a), s = sin(a);
    return mat2(c,-s,s,c)*v;
}

float sense(vec2 pos, vec2 dir, float dist, sampler2D trail, vec2 world){
    vec2 probe = pos + normalize(dir) * dist;
    probe = mod(probe + world, world);             // wrap
    vec2 uv = probe / world;                       // 0..1
    return texture(trail, uv).r;                   // use red channel
}

void main(){
    ivec2 uv = ivec2(gl_FragCoord.xy);
    vec4 s   = texelFetch(uState, uv, 0);
    vec2 pos = s.xy;
    vec2 vel = s.zw;

    // current heading (fallback if zero)
    vec2 dir = normalize(vel);
    if (!all(greaterThan(abs(dir), vec2(0.0001)))) dir = vec2(1.0, 0.0);

    // --- SENSE ---
    float f = sense(pos, dir,               uSenseDist, uTrail, uCanvas);
    float l = sense(pos, rot(dir,+uSenseAngle), uSenseDist, uTrail, uCanvas);
    float r = sense(pos, rot(dir,-uSenseAngle), uSenseDist, uTrail, uCanvas);

    // --- STEER toward strongest (with turn-rate limit) ---
    float targetTurn = 0.0;
    if (l > f && l > r) targetTurn = +uSenseAngle;
    else if (r > f && r > l) targetTurn = -uSenseAngle;

    // limit by turn rate
    float maxTurn = uTurnRate * uDt;
    float dTheta  = clamp(targetTurn, -maxTurn, +maxTurn);

    // apply steering to heading
    dir = rot(dir, dTheta);

    // add jitter as random accel (keeps it lively)
    float a = hash13(vec3(gl_FragCoord.xy, floor(uTime*60.0))) * 6.2831853;
    vec2 acc = vec2(cos(a), sin(a)) * uJitter;

    // integrate vel and pos
    vel += (dir * 60.0 + acc) * uDt;   // forward push + jitter
    vel *= exp(-uDrag * uDt);
    // vel = clamp(vel, -5.0, 5.0);
    pos += vel * uStepLen;

    // wrap world
    // pos = mod(pos + uCanvas, uCanvas);

    // ---- keep agents inside and slide along walls ----
    float margin = 0.5;                      // small padding to avoid sampling outside
    bool hitL = pos.x < margin;
    bool hitR = pos.x > uCanvas.x - margin;
    bool hitT = pos.y < margin;
    bool hitB = pos.y > uCanvas.y - margin;

    // Clamp position inside the box
    pos.x = clamp(pos.x, margin, uCanvas.x - margin);
    pos.y = clamp(pos.y, margin, uCanvas.y - margin);

    // Kill normal component of velocity at the wall (slide along the tangent)
    if (hitL && vel.x < 0.0)  vel.x = 0.0;  // vertical wall → remove X, keep Y
    if (hitR && vel.x > 0.0)  vel.x = 0.0;

    if (hitT && vel.y < 0.0)  vel.y = 0.0;  // horizontal wall → remove Y, keep X
    if (hitB && vel.y > 0.0)  vel.y = 0.0;

    // (optional) tiny tangential nudge so they don't stick in corners
    if ((hitL||hitR) && abs(vel.y) < 0.01) vel.y += (hash13(vec3(pos, uTime)) - 0.5) * 0.5;
    if ((hitT||hitB) && abs(vel.x) < 0.01) vel.x += (hash13(vec3(pos, uTime)) - 0.5) * 0.5;


    fragColor = vec4(pos, vel);
}

