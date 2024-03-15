precision highp float;

uniform mat4 uNormalize;

out vec3 wPosition;
out vec3 uPosition;

void main() {

  wPosition = vec3( modelMatrix * vec4( position, 1.0 ) );
  uPosition = vec3( uNormalize * vec4( wPosition, 1.0 ) );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}