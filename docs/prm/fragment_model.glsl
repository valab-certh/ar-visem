precision highp float;
precision highp sampler3D;

in vec3 uDisplacement;

// global uniforms
uniform vec3 uCameraPosition;
uniform mat4 uMatrix;

// plane uniforms
uniform vec4 uPlaneHessian[3];
uniform bool uPlaneVisible[3];

// selector uniforms


// mask uniforms
uniform sampler3D uMaskMap;
uniform vec3 uTextelSize;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;

// material uniforms
uniform float uModelAlpha;
uniform float uModelAlphaClip;

out vec4 color;

#define Inf 3.402823466e+38 // works for precision highp float;
#define stepFactor 1.0

float getSample( vec3 position ) {

    vec3 uvw = position + 0.5;
    return texture( uMaskMap, uvw ).r;

}

vec3 getNormal( vec3 position ) {

    vec3 offset = uTextelSize;
    vec3 deltaInv = 0.5 / offset;

    vec3 gradient = vec3(
        getSample(position + vec3(-offset.x, 0.0, 0.0)) - getSample(position + vec3(offset.x, 0.0, 0.0)),
        getSample(position + vec3(0.0, -offset.y, 0.0)) - getSample(position + vec3(0.0, offset.y, 0.0)),
        getSample(position + vec3(0.0, 0.0, -offset.z)) - getSample(position + vec3(0.0, 0.0, offset.z))
    );
    
    gradient *= deltaInv;  

    return normalize( gradient );

}

float getStep( vec3 dir ) {

    vec3 tMax = uTextelSize / abs( dir ); 
    float step = min( tMax.x, min( tMax.y, tMax.z ) );

    return step * stepFactor;

}

bool isClipped( vec3 point ) {   

    vec4 c = uMatrix * vec4(uCameraPosition, 1.0);
    vec4 p = uMatrix * vec4(point, 1.0);

    bvec3 sameSign = equal(sign(c.xyz), sign(p.xyz));
    
    sameSign.x = sameSign.x || ! uPlaneVisible[0];
    sameSign.y = sameSign.y || ! uPlaneVisible[1];
    sameSign.z = sameSign.z || ! uPlaneVisible[2];

    return all(sameSign);

}

bool isInsideUnitBox( vec3 uPoint ) {

    // in display local normalized coordinates
    const vec3 boxMax = vec3( 0.5 );
    bvec3 inside = lessThanEqual( abs(uPoint), boxMax );
    
    return all( inside );

}

vec2 intersectBox( vec3 boxMin, vec3 boxMax, vec3 origin, vec3 direction ) {
    // Ray-AABB (Axis Aligned Bounding Box) intersection.
    // Mathematics: https://tavianator.com/2022/ray_box_boundary.html

    vec3 inv = 1.0 / direction;
    vec3 dMax = (boxMax - origin) * inv;
    vec3 dMin = (boxMin - origin) * inv;

    vec3 tMin = min(dMin, dMax);
    vec3 tMax = max(dMin, dMax);

    float tStart = max(tMin.x, max(tMin.y, tMin.z));
    float tEnd = min(tMax.x, min(tMax.y, tMax.z));

    return vec2(tStart, tEnd);

}

float intersectPlane( vec3 origin, vec3 direction, vec4 plane, bool visible ) {

    if ( !visible ) return Inf;

    float correlation = - dot( plane.xyz, direction );
    if ( abs(correlation) < 1e-6 ) return Inf;

    float depth = ( dot( plane.xyz, origin ) + plane.w ) / correlation;
    if ( depth < 0.0 ) return Inf;

    vec3 point = origin + depth * direction;
    if ( ! isInsideUnitBox(point) ) return Inf;

    return depth;

}

float intersectScreen( vec3 origin, vec3 direction ) {

    float depth = Inf;

    depth = min( depth, intersectPlane(origin, direction, uPlaneHessian[0], uPlaneVisible[0]) );
    depth = min( depth, intersectPlane(origin, direction, uPlaneHessian[1], uPlaneVisible[1]) );
    depth = min( depth, intersectPlane(origin, direction, uPlaneHessian[2], uPlaneVisible[2]));
 
    return depth;

}

vec2 rayMarch( vec3 origin, vec3 direction, vec2 bounds, float step ) {

    vec3 position = origin + bounds.x * direction;
    float intensityPrev = getSample(position);
    float intensity;
    float difference;

    for (; bounds.x < bounds.y; bounds.x += step) {

        position += direction * step;
        intensity = getSample(position);
        difference = intensity - intensityPrev;
        
        if ( abs(difference) != 0.0 ) break;
        intensityPrev = intensity;

    }

    intensity = ( difference > 0.0 ) ? intensity : intensityPrev;

    return vec2(bounds.x, intensity);

}

void main(){

    // compute ray parameters
    vec3 direction = normalize( uDisplacement );
    vec2 bounds = intersectBox( uBoxMin, uBoxMax, uCameraPosition, direction );

    bounds.x = max(bounds.x, 0.0);
    bounds.y = min(bounds.y, intersectScreen(uCameraPosition, direction));
    if ( bounds.x > bounds.y ) {

        discard;
        return;

    }

    float delta = getStep( direction );
    vec2 result = rayMarch( uCameraPosition, direction, bounds, delta );

    if ( result.y > 0.0 ) {

        // coloring
        vec3 position = uCameraPosition + result.x * direction;      

        vec3 defaultColor = 0.9 * vec3( 1.0, 0.2, 0.2 );
        float product = abs(dot(direction, getNormal( position )));

        color.rgb = defaultColor * product;
        color.a = isClipped(position) ? uModelAlphaClip : uModelAlpha;

    }
}