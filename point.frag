precision highp float; out vec4 fragColor;
in float vImportance;
uniform sampler2D uCustomImage;
uniform vec2 uMouseCoords;
uniform bool uMouseDown;
uniform bool uHasCustomImage;
uniform float uImageArea;

void main(){
    vec2 p = gl_PointCoord - 0.5; 
    float r = length(p);
    // if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.45, r);
    vec4 color = vec4(1.0, 1.0, 1.0, 1.0);
    // vec3 color = vec3(1.0, 1.0/vImportance, 1.0/vImportance);
    if (uMouseDown) {
        if (uHasCustomImage) {
            // color = vec4(0.3,0.3,0.3,.6);
            vec4 customImage = texelFetch(uCustomImage,   ivec2(gl_FragCoord.xy), 0);
            float dist = distance(gl_FragCoord.xy, uMouseCoords);
            // if (dist < 500.0) color.xyz = customImage.xyz;
            if (dist < uImageArea) {
                dist = smoothstep(1.0, 0.5, dist/uImageArea);
                color.xyz = customImage.xyz * dist + color.xyz * (.8 - dist);
                color += 0.6;
            }
        }
    }
    fragColor = vec4(color); // pale cyan points
}
