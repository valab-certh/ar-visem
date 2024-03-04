precision highp float;
precision highp sampler3D;

in vec3 uPosition; // position in display local normalized coordinates
in vec3 wPosition; // position in world coordinates

uniform sampler3D uVolumeMap;
uniform sampler3D uMaskMap;

// plane uniforms
uniform vec3 uPlaneNormal[3];
uniform vec3 uPlaneOrigin;
uniform float uPlaneIndex;
uniform float uPlaneVisible;
uniform float uPlaneAlpha;

// brush uniforms
uniform float uBrushVisible;
uniform vec3 uBrushColor;
uniform float uBrushRadius;
uniform vec3 uBrushCenter;

// selector uniforms
uniform float uSelectorVisible;
uniform float uSelectorOpacity;
uniform vec3 uSelectorColor;
uniform vec3 uSelectorSize;
uniform vec3 uSelectorCenter;

// material uniforms
uniform float uBrightness;
uniform float uContrast;

// #define epsilon 0.005

out vec4 color;

float getSample( sampler3D map, vec3 position ) {
    vec3 uvw = position + 0.5;
    return texture( map, uvw ).r;
}

float isInsideLine( vec3 uPoint, vec3 origin, vec3 direction, float thickness ) {
    // in display local normalized coordinates
    vec3 vector = uPoint - origin;
    vec3 projection = dot(vector, direction) * direction;
    vec3 difference = vector - projection;
    return step( dot(difference, difference), thickness * thickness);
}

float isInsideAxis( vec3 uPoint, float thickness ) {
    int i = int(mod( uPlaneIndex - 1.0, 3.0));
    int j = int(mod( uPlaneIndex + 1.0, 3.0));
    float isAxisI = isInsideLine( uPoint, uPlaneOrigin, uPlaneNormal[i], thickness );  
    float isAxisJ = isInsideLine( uPoint, uPlaneOrigin, uPlaneNormal[j], thickness );  
    return max( isAxisI, isAxisJ);
}

float isInsideUnitBox( vec3 uPoint ) {
    // in display local normalized coordinates
    const vec3 boxMax = vec3( 0.5 );
    bvec3 inside = lessThanEqual( abs(uPoint), boxMax );
    return float( all( inside ));
}

float isBoundaryUnitBox( vec3 uPoint, float thickness ) {
    // in display local normalized coordinates
    const vec3 boxMax = vec3( 0.5 ); 
    vec3 difference = boxMax - abs(uPoint); 
    bvec3 inside = lessThanEqual( abs(uPoint), boxMax );
    bvec3 boundary = lessThan( abs(difference), vec3(thickness) );
    return float(any(boundary) && all(inside));
}

float isBoundaryBox( vec3 point, vec3 center, vec3 size, float thickness ) {

    // in display normalized coordinates
    vec3 boundaryRadius = vec3( thickness * 0.5 );
    vec3 halfSize = size * 0.5;
    vec3 centeredPoint = point - center;
    vec3 boundaryCenter = halfSize - boundaryRadius;
    bvec3 boundary = lessThanEqual( abs( boundaryCenter - abs(centeredPoint)), boundaryRadius );
    bvec3 inside = lessThanEqual( abs( centeredPoint ), halfSize );
    
    return float( any( boundary ) && all( inside ) );

}

float isBoundarySphere( vec3 wPoint, vec3 center, float radius, float thickness ) {
    // in world coordinates
    float distanceSq = dot( wPoint - center, wPoint - center );
    float outerRadiusSq = radius * radius;
    float innerRadiusSq = outerRadiusSq * (1.0 - thickness) * (1.0 - thickness);
    return float( innerRadiusSq < distanceSq && distanceSq <= outerRadiusSq );
}

void main() {    

    const float boundaryBox = 0.005;
    const float boundarySphere = 0.025;
    const float lineThickness = 0.002;
    const float selectorBoxThickness = 0.002;
    
    float isInside = isInsideUnitBox( uPosition );
    float isMask = float( getSample( uMaskMap, uPosition ) > 0.0 );
    float isBrush = uBrushVisible * isBoundarySphere( wPosition, uBrushCenter, uBrushRadius, boundarySphere );
    float isSelector = uSelectorVisible * isBoundaryBox( uPosition, uSelectorCenter, uSelectorSize, selectorBoxThickness );
    float isContainer = isBoundaryUnitBox( uPosition, boundaryBox );
    float isAxis = isInsideAxis( uPosition, lineThickness );
 
    vec4 volumeColor = vec4( vec3( getSample( uVolumeMap, uPosition )), uPlaneAlpha );
    vec4 axisColor = vec4(volumeColor.rgb, 0.5 );
    vec4 maskColor = vec4( volumeColor.r + 0.4, volumeColor.gb, 1.0 );
    vec4 brushColor = vec4( uBrushColor, 1.0 );
    vec4 selectorColor = vec4( uSelectorColor, 1.0 );
    vec4 containerColor = vec4( 1.0, 1.0, 1.0, 0.3 );

    color = volumeColor;
    color.rgb = (color.rgb - 0.5) * uContrast + 0.5 + uBrightness;   
    color = mix( color, axisColor, isAxis );
    color = mix( color, maskColor, isMask );
    color = mix( color, brushColor, isBrush );
    color = mix( color, selectorColor, isSelector * 0.7 );
    color = mix( color, containerColor, isContainer );
    color = clamp( color, 0.0, 1.0 );    
  
    float isNotDiscarded = min( isInside, max( isContainer, uPlaneVisible ));
    if ( isNotDiscarded == 0.0 ) discard;
    // if ( isAxis == 1.0 ) discard;
  
}