precision highp float;

varying vec4 vWorldCoord;
varying vec2 vUv;

void main() { 

vUv = uv;
vWorldCoord = modelMatrix * vec4( position, 1.0 );

vec4 modelViewPosition = modelViewMatrix * vec4( position , 1.0);
vec4 projectedPosition = projectionMatrix * modelViewPosition;
gl_Position = projectedPosition;

}