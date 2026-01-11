uniform vec3 uColor;
varying vec4 vPos;

void main() {
  gl_FragColor = vec4(
    -vPos.z / 180.0 * uColor.r,
    -vPos.z / 180.0 * uColor.g,
    -vPos.z / 180.0 * uColor.b,
    1.0
  );
}
