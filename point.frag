precision highp float; out vec4 fragColor;
in float vImportance;

void main(){
    vec2 p = gl_PointCoord - 0.5; 
    float r = length(p);
    if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.45, r);
    vec3 color = vec3(1.0, 1.0, 1.0);
    // vec3 color = vec3(1.0, 1.0/vImportance, 1.0/vImportance);
    fragColor = vec4(color, a); // pale cyan points
}
