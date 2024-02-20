precision highp float;

uniform vec3 uCameraPosition;
uniform vec3 uMaskSize;

out vec3 uDisplacement;

void main() {

  // main code
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

  vec3 uPosition = position / uMaskSize;
  uDisplacement = uPosition - uCameraPosition; 
}