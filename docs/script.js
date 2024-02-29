import GUI                    from "lil-gui"
import * as THREE             from "three"
import * as PIXPIPE           from "./prm/pixpipe.esmodule.js"
import { XRGestures }         from './prm/XRGestures.js'
import { OBB }                from 'three/addons/math/OBB.js'
import { ARButton }           from 'three/addons/webxr/ARButton.js'
import { OrbitControls }      from "three/addons/controls/OrbitControls.js"
import { TransformControls }  from 'three/addons/controls/TransformControls.js'

// place holder variables
const _vector     = new THREE.Vector3();
const _position   = new THREE.Vector3();
const _direction  = new THREE.Vector3();
const _scale      = new THREE.Vector3();
const _matrix     = new THREE.Matrix4();
const _box        = new THREE.Box3();
const _points     = new Array( 8 ).fill().map( () => new THREE.Vector3() );

// constants
const _right   = new THREE.Vector3( 1, 0, 0 );
const _up      = new THREE.Vector3( 0, 1, 0 );
const _forward = new THREE.Vector3( 0, 0, 1 );
const _red     = new THREE.Color( 1, 0, 0 );
const _green   = new THREE.Color( 0, 1, 0 );
const _blue    = new THREE.Color( 0, 0, 1 );

// load shaders
const vertexScreen = await loadShader('./prm/vertex_screen.glsl');
const fragmentScreen = await loadShader('./prm/fragment_screen.glsl');
const vertexModel = await loadShader('./prm/vertex_model.glsl');
const fragmentModel = await loadShader('./prm/fragment_model.glsl');

// global objects
let camera, scene, renderer, canvas, orbitControls, transformControls; // scene objects

let display, container, screen, model, brush, volume, mask; // main objects

let pointer, raycaster, gestures, reticle; // helper objects

let hitTestSource, hitTestSourceRequested, hitTestResult; // parameters AR



main();

function main () {

  setupObjects();
  setupScene();
  setupGui();
  setupButton();

  renderer.setAnimationLoop( updateAnimation );

}

function setupObjects () {

  display   = new THREE.Object3D();
  screen    = new THREE.Object3D();
  container = new THREE.Mesh();
  model     = new THREE.Mesh();
  brush     = new THREE.Mesh();
  reticle   = new THREE.Mesh();
  pointer   = new THREE.Vector2();
  raycaster = new THREE.Raycaster();
  volume    = { userData: {} };
  mask      = { userData: {} };
  
}

function setupScene () {

  // canvas setup

  canvas = document.createElement( 'div' );
  document.body.appendChild( canvas );

  // renderer setup

  renderer = new THREE.WebGLRenderer( { 
    alpha: true,
    antialias: false, 
    sortObjects: false,
    powerPreference: "low-power",
  } );
  renderer.setPixelRatio( window.devicePixelRatio ); // maybe change to 2 for performance
  renderer.setSize( window.innerWidth, window.innerHeight );
  canvas.appendChild( renderer.domElement );

  // camera setup

  camera = new THREE.PerspectiveCamera( 50, window.innerWidth/window.innerHeight, 0.001, 10 );
  camera.position.set( 1, 0.6, 1 );   
  
  // orbit

  orbitControls = new OrbitControls( camera, canvas );
  orbitControls.target.set( 0, 0, 0 );
  orbitControls.update();

  // transform

  transformControls = new TransformControls( camera, canvas );
  transformControls.addEventListener( 'dragging-changed', (event) => orbitControls.enabled = !event.value); 
  transformControls.attach( screen );
  transformControls.visible = false;
  transformControls.enabled = false;   
 
  // scene

  scene = new THREE.Scene();  

  // scene graph

  scene.add( camera )
  scene.add( display );
  scene.add( transformControls );

  display.add( container );
  display.add( screen );
  display.add( model );
  display.add( brush );

  setupDisplay();

  // render order

  [ reticle, screen, model, brush, container, ].forEach( (obj, i) => obj.renderOrder = i );

  // event listeners

  window.addEventListener( 'resize', onResize );
  window.addEventListener( 'mousemove', onPointerMove);
  window.addEventListener( 'keydown', onKeydown );

}

function setupGui () {

  const gui = new GUI( { closeFolders: false } );
  const [folders, buttons] = [0, 1].map( () => [] );
  gui.domElement.classList.add( 'force-touch-styles' );
  
  // volume

  folders[0] = gui.addFolder( 'Volume' );  

  buttons[0] = document.getElementById( 'uploadVolume' ); 
  folders[0].add( buttons[0], 'click' ).name('Upload Volume');  
  buttons[0].addEventListener( 'change', (event) => onVolumeUpload( event ) );  
    
  // maskS

  folders[1] = gui.addFolder('Mask');

  buttons[1] = document.getElementById('uploadMask'); 
  folders[1].add( buttons[1], 'click' ).name('Upload Mask'); 
  buttons[1].addEventListener( 'change', (event) => onMaskUpload( event ) );


  // folders[1].add( buttons[1], 'click' ).name('Download Mask'); 

}

function setupButton () {   

  const overlay = document.getElementById( 'overlay-content' )
  const button = ARButton.createButton(renderer, {

    requiredFeatures: [ 'hit-test' ],
    optionalFeatures: [ 'dom-overlay' ],
    domOverlay: { root: overlay },     

  });

  document.body.appendChild( button );     
  button.addEventListener( 'click', onButton );

}

function updateAnimation ( timestamp, frame ) {

  if ( renderer.xr.isPresenting ) {

    if ( reticle.userData.enabled ) updateHitTest( renderer, frame, onHitTestResultReady, onHitTestResultEmpty, onSessionEnd );

    gestures.update();


  }    
  
  updateDisplay();

  renderer.render( scene, camera );
}

function setupAR () {
  
  display.visible = false;
  display.position.set( 0, 0, 0 );

  renderer.xr.enabled = true; 
  setupGestures();

  hitTestSourceRequested = false;
  hitTestSource = null;

  setupReticle();
  reticle.userData.enabled = true;
  scene.add( reticle );


}
  
function setupReticle () {

  const geometry = new THREE.RingGeometry( 0.15, 0.2, 32 ).rotateX( -Math.PI / 2 );
  const material = new THREE.MeshBasicMaterial({ 

    color: 0xffffff,
    transparent: true,
    opacity: 0.7,

  });

  reticle.geometry = geometry;
  reticle.material = material;
  reticle.matrixAutoUpdate = false;   

}

function setupGestures () {
    
  gestures = new XRGestures( renderer );

  gestures.addEventListener( 'polytap',   event => onPolytap( event ));
  gestures.addEventListener( 'hold',      event => onHold( event ));
  gestures.addEventListener( 'pan' ,      event => onPan( event ));
  gestures.addEventListener( 'swipe',     event => onSwipe( event ));
  gestures.addEventListener( 'pinch',     event => onPinch( event ));
  gestures.addEventListener( 'twist',     event => onTwist( event ));  
  gestures.addEventListener( 'implode',   event => onImplode( event ));  
  gestures.addEventListener( 'explode',   event => onExplode( event ));  

}

function updateHitTest ( renderer, frame, onHitTestResultReady, onHitTestResultEmpty, onSessionEnd ) {

  const session = renderer.xr.getSession();
  const referenceSpace = renderer.xr.getReferenceSpace();

  // request hit test source
  if ( session && hitTestSourceRequested === false ) {
  
    session
    .requestReferenceSpace("viewer")
    .then( (referenceSpace) => {
  
      session
      .requestHitTestSource({ space: referenceSpace })
      .then( (source) => { hitTestSource = source });  

    });

    session.addEventListener( 'end', function () {

      hitTestSourceRequested = false;
      hitTestSource = null;
      
      onSessionEnd();

    } );

  
    hitTestSourceRequested = true;

  }

  //get hit test results
  if ( hitTestSource ) {

    const hitTestResults = frame.getHitTestResults( hitTestSource ); 

    if ( hitTestResults.length ) {

      hitTestResult = hitTestResults[0]; //console.log(hitTestResult);
      if( hitTestResult && hitTestResult !== null && referenceSpace ) {

        const hitPose = hitTestResult.getPose( referenceSpace );
        if ( hitPose ) onHitTestResultReady( hitPose.transform.matrix );

      }

    } else onHitTestResultEmpty();

  }

}


// display

function setupDisplay () {

  display.visible = false;
  display.matrixAutoUpdate = false;
  display.userData.modes = [ 'Place', 'Inspect', 'Edit',  ];
  display.userData.history = [];
  display.userData.future = [];

  setupUniforms();
  setupVolume();
  setupMask();
  setupContainer(); 
  setupScreen();
  setupBrush();
  setupModel();

  updateUI(); 

}

function updateDisplay () {
  
  display.updateMatrix();

  updateContainer();
  updateScreen();
  updateUniforms();

  if ( model.visible) {
    
    updateModel();  

  }

  if ( brush.visible ) {

    updateBrush();

  } 



}

function setupUniforms () {

  display.userData.uNormalize = new THREE.Matrix4();
  display.userData.uDeNormalize = new THREE.Matrix4();
  display.userData.uMatrix = new THREE.Matrix4();
  display.userData.uCameraPosition = new THREE.Vector3();
  display.userData.uPlaneHessian = new Array(3).fill().map( (i) => new THREE.Vector4() );
  display.userData.uPlaneNormal = new Array(3).fill().map( (i) => new THREE.Vector3() );
  display.userData.uPlaneOrigin = new THREE.Vector3(); 

}

function updateUniforms () {

  display.userData.uNormalize.copy( display.matrixWorld ).scale( volume.userData.size ).invert();
  
  display.userData.uDeNormalize.copy( display.matrixWorld ).scale( volume.userData.size ).transpose();
  
  display.userData.uMatrix.copy( screen.matrix ).invert().scale( volume.userData.size );
  
  display.userData.uCameraPosition.copy( camera.position ).applyMatrix4( display.userData.uNormalize );
  
  display.userData.uPlaneOrigin.copy( screen.getWorldPosition( new THREE.Vector3() ) ).applyMatrix4( display.userData.uNormalize );
  
  display.userData.uPlaneNormal.forEach( (planeNormal, i) => {

    planeNormal.copy( screen.userData.planes[i].normal ).transformDirection( display.userData.uNormalize );
  
  });

  display.userData.uPlaneHessian.forEach( (planeHessian, i) => {

    planeHessian.set( ...screen.userData.planes[i].normal.toArray(), screen.userData.planes[i].constant ).applyMatrix4( display.userData.uDeNormalize );
  
  });

}

function updateUI () {

  if ( display.userData.modes[0] === 'Place' ) {

    container.material.opacity = 0.2;   
    container.userData.outline.visible = true;

    model.visible = true;
    model.material.uniforms.uModelAlpha.value = 0.8;
    model.material.uniforms.uModelAlphaClip.value = 0.8;

    brush.visible = false;

    screen.userData.monitors.forEach( (monitor) => {

      monitor.renderOrder = 1.0;
      monitor.visible = true;

      const uniforms = monitor.material.uniforms;
      uniforms.uPlaneAlpha.value = 1.0;     
      uniforms.uBrushVisible.value = false;

    });  

  }

  if ( display.userData.modes[0] === 'Inspect' ) {

    container.material.opacity = 0.0;   
    container.userData.outline.visible = true;

    model.visible = true;
    model.material.uniforms.uModelAlpha.value = 0.8;
    model.material.uniforms.uModelAlphaClip.value = 0.0;
   
    brush.visible = false;

    screen.userData.monitors.forEach( (monitor) => {

      monitor.renderOrder = 1.0;
      monitor.visible = true;

      const uniforms = monitor.material.uniforms;
      uniforms.uPlaneAlpha.value = 1.0;     
      uniforms.uBrushVisible.value = false;

    });  

  }

  if ( display.userData.modes[0] === 'Edit' ) {

    container.material.opacity = 0.0;   
    container.userData.outline.visible = false;

    model.visible = false;
    model.material.uniforms.uModelAlpha.value = 0.0;
    model.material.uniforms.uModelAlphaClip.value = 0.0;

    brush.visible = true;
  
    screen.userData.monitors.forEach( (monitor) => {  

      const isSelected = ( monitor.userData.index === brush.userData.monitorIndex );   

      monitor.renderOrder = isSelected ? 1.5 : 1.0;
      monitor.visible = true;

      const uniforms = monitor.material.uniforms;
      uniforms.uPlaneAlpha.value = isSelected ? 1.0 : 0.6;
      uniforms.uBrushVisible.value = true;   

    });  

  }
  
}

// volume

function setupVolume () { 
    
  const size = new THREE.Vector3( 1, 1, 1 );
  const samples = new THREE.Vector3( 1, 1, 1 );
  const voxelSize = new THREE.Vector3().copy( size ).divide( samples );
  const data = new Uint8Array( samples.x * samples.y * samples.z ).fill( 100 );

  const texture = new THREE.Data3DTexture( data, samples.x, samples.y, samples.z );  
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  volume.userData.texture = texture
  volume.userData.size = size;
  volume.userData.samples = samples;
  volume.userData.voxelSize = voxelSize;
  
}

function updateVolume ( image3D ) { 
  // image3D is a pixpipe object

  // remove negative voxel sizes for compatibility between volume and model
  image3D._metadata.dimensions.forEach( (dimension) => dimension.step = Math.abs(dimension.step) );
 
  const samples = new THREE.Vector3().fromArray( image3D.getMetadata("dimensions").map( (dimension) => dimension.length ));
  const voxelSize = new THREE.Vector3().fromArray( image3D.getMetadata("dimensions").map( (dimension) => dimension.step * 0.001 )); 
  const size = new THREE.Vector3().fromArray( image3D.getMetadata("dimensions").map( (dimension) => dimension.step * dimension.length * 0.001 ));  

  const texture = new THREE.Data3DTexture(
    image3D.getDataUint8(),
    image3D.getDimensionSize('x'),
    image3D.getDimensionSize('y'),
    image3D.getDimensionSize('z')
  );

  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true; 

  // update user data
  volume.userData.texture = texture;
  volume.userData.samples = samples;
  volume.userData.voxelSize = voxelSize;
  volume.userData.size = size;

  // update screen uniforms
  screen.userData.monitors.forEach( (monitor) => {
    const uniforms = monitor.material.uniforms;
    uniforms.uVolumeMap.value = texture;
    uniforms.uVolumeSize.value = size;
  });

}


// mask

function setupMask () { 
    
  const size = new THREE.Vector3( 1, 1, 1 );
  const samples = new THREE.Vector3( 100, 100, 100 );
  const voxelSize = new THREE.Vector3().copy( size ).divide( samples );
  const data = new Uint8Array( samples.x * samples.y * samples.z ).fill( 0 );

  const texture = new THREE.Data3DTexture( data, samples.x, samples.y, samples.z );  
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  // update user data
  mask.userData.history = [];
  mask.userData.future = [];
  mask.userData.data0 = data;
  mask.userData.texture = texture;
  mask.userData.samples = samples;
  mask.userData.size = size;
  mask.userData.voxelSize = voxelSize;
}

function updateMask ( image3D ) { 
  // image3D is a pixpipe object

  // remove negative voxel sizes for compatibility between volume and model
  image3D._metadata.dimensions.forEach( (dimension) => dimension.step = Math.abs(dimension.step));
  
  const samples = new THREE.Vector3().fromArray( image3D.getMetadata("dimensions").map( (dimension) => dimension.length ));
  const voxelSize = new THREE.Vector3().fromArray( image3D.getMetadata("dimensions").map( (dimension) => dimension.step * 0.001 )); 
  const size = new THREE.Vector3().fromArray( image3D.getMetadata("dimensions").map( (dimension) => dimension.step * dimension.length * 0.001 ));  

  const texture = new THREE.Data3DTexture(
    image3D.getDataUint8(),
    image3D.getDimensionSize('x'),
    image3D.getDimensionSize('y'),
    image3D.getDimensionSize('z'),
  );

  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  // update user data
  mask.userData.history = [];
  mask.userData.future = [];
  mask.userData.data0 = image3D.getDataUint8();
  mask.userData.texture = texture;
  mask.userData.samples = samples;
  mask.userData.voxelSize = voxelSize;
  mask.userData.size = size;

  // update screen uniforms  
  screen.userData.monitors.forEach( (plane) => {
    const uniforms = plane.material.uniforms;
    uniforms.uMaskMap.value = texture;
    uniforms.uMaskSize.value = size;
  });

  // update model uniforms
  const uniforms = model.material.uniforms;
  uniforms.uMaskMap.value = texture;
  uniforms.uMaskSize.value = size;
  uniforms.uMaskSamples.value = samples;
}

// container

function setupContainer() { 

  container.clear();

  const offset =  0.00001 * volume.userData.size.length();
  const size = new THREE.Vector3().copy( volume.userData.size ).addScalar( offset );
  const geometry = new THREE.BoxGeometry( ...size.toArray() );
  const material = new THREE.MeshBasicMaterial( { 

    color: 0xff9999, // 0x0055ff
    side: THREE.DoubleSide, 
    visible: true, 
    transparent: true,
    opacity: 0.2,
    depthTest: true,
    depthWrite: true,

  });

  const box = new THREE.Box3().setFromCenterAndSize( new THREE.Vector3(), size );
  const obb = new OBB().fromBox3( box );
  const outline = new THREE.Box3Helper( box, material.color ); 

  container.geometry = geometry;
  container.material = material;

  container.userData.obb = obb;
  container.userData.obb0 = new OBB().copy( obb );
  container.userData.outline = outline;

  container.add( outline );

}

function updateContainer() {

  container.userData.obb.copy( container.userData.obb0 ).applyMatrix4( container.matrixWorld );

}

function intersectContainer( rayOrOrigin, direction ) {

  if ( rayOrOrigin instanceof THREE.Ray && direction === undefined ) {

    raycaster.set( rayOrOrigin.origin, rayOrOrigin.direction );

  } else {

    raycaster.set( rayOrOrigin, direction );

  }

  let intersections = raycaster.intersectObject( container, false );

  // remove duplicates
  intersections = intersections.filter( (result, i) => {

    const distance = result.distance;
    return !Boolean( intersections.slice(i + 1).some( (result) => Math.abs(result.distance - distance)  < 1e-6 ) );

  });

  return intersections;
}

// screen

function setupScreen () {
  
  screen.clear();
  screen.userData.future = [];
  screen.userData.history = [];

  const uniforms = {  

    // global parameters
    uNormalize: { value: new THREE.Matrix4() },

    // plane parameters
    uPlaneIndex: { value: undefined },
    uPlaneNormal: { value: [0,1,2].map( (i) => new THREE.Vector3() ) },
    uPlaneOrigin: { value: new THREE.Vector3() },
    uPlaneVisible: { value: true },   
    uPlaneAlpha: { value: 1.0 },

    // volume parameters
    uVolumeSize: { value: volume.userData.size },
    uVolumeMap: { value: volume.userData.texture },

    // mask parameters
    uMaskSize: { value: mask.userData.size },
    uMaskMap: { value: mask.userData.texture },

    // brush parameters
    uBrushVisible: { value: false },
    uBrushColor: { value: new THREE.Vector3() },
    uBrushRadius: { value: 0 },
    uBrushCenter: { value: new THREE.Vector3() },

    // color parameters
    uBrightness: { value: 0.0 },
    uContrast: { value: 1.2 },
  };

  const length = 2 * volume.userData.size.length();
  const geometry = [0, 1, 2].map( (i) => new THREE.PlaneGeometry( length, length ) );
  const material = [0, 1, 2].map( (i) => new THREE.ShaderMaterial( {

    glslVersion: THREE.GLSL3,

    // shader parameters
    uniforms: THREE.UniformsUtils.clone( uniforms ) ,
    vertexShader: vertexScreen,
    fragmentShader: fragmentScreen,

    // material parameters
    side: THREE.DoubleSide,
    transparent: true,  
    depthWrite: true,
    depthTest: true,

  }));
  
  const monitors = [];
  monitors[0] = new THREE.Mesh( geometry[0], material[0] ).rotateY(   Math.PI / 2 );
  monitors[1] = new THREE.Mesh( geometry[1], material[1] ).rotateX( - Math.PI / 2 );
  monitors[2] = new THREE.Mesh( geometry[2], material[2] );

  const planes = []; // in world coordinates
  planes[0] = new THREE.Plane( new THREE.Vector3( 1, 0, 0 ), 0 );
  planes[1] = new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 );
  planes[2] = new THREE.Plane( new THREE.Vector3( 0, 0, 1 ), 0 );

  // update user data
  screen.userData.planes = planes;

  // add monitors
  screen.userData.monitors = monitors;  
  screen.userData.monitors.forEach( (monitor, i) => {

    monitor.matrixAutoUpdate = false;
    monitor.updateMatrix();

    // in display coordinates
    const normal = new THREE.Vector3( 0, 0, 1 );
    monitor.userData.plane = new THREE.Plane( normal, 0 ).applyMatrix4( monitor.matrix );
    monitor.userData.plane0 = new THREE.Plane().copy( monitor.userData.plane );
    monitor.userData.index = i;

    const uniforms = monitor.material.uniforms;
    uniforms.uPlaneIndex.value = i;

    screen.add( monitor );
  });

  setupScreenAxis();
  setupScreenCenter();
}

function setupScreenAxis () {
  // FOR SOME REASON IF SCREEN HAS NON IDENTITY MATRIX AXIS ARE NOT CORRECT

  screen.userData.monitors.forEach( (monitor, i) => {

    const direction = [ _right, _up, _forward][ i ].clone();
    const color = [ _red, _green, _blue][ i ].clone();
    const length = volume.userData.size.length();
    const origin = direction.clone().negate().multiplyScalar( 0.5 * length );
    const axis = new THREE.ArrowHelper( direction, origin, length, color );

    // axis user data
    axis.userData.points = [];
    axis.userData.ray = new THREE.Ray( origin, direction );
    axis.userData.ray0 = axis.userData.ray.clone();

    // add axis to monitor
    monitor.userData.axis = axis;
    screen.add( axis );
  });
}

function setupScreenCenter () {

  const radius = 0.05 * volume.userData.size.length();
  const geometry = new THREE.OctahedronGeometry( radius, 10 );
  const material = new THREE.MeshBasicMaterial( { 
    color: 0xffff00, 
    side: THREE.DoubleSide, 
    visible: false, 
    transparent: true,
    opacity: 0.4,
    depthTest: true,
    depthWrite: true,
  })

  const center = new THREE.Mesh( geometry, material );
  center.renderOrder = 1;
  screen.add( center );

  screen.userData.center = center;
}

function updateScreen () { 

  // update planes
  const origin = screen.getWorldPosition( new THREE.Vector3() );
  screen.userData.planes.forEach( (plane, i) => {
    const normal = screen.userData.monitors[i].getWorldDirection( new THREE.Vector3() );
    plane.setFromNormalAndCoplanarPoint( normal, origin );
  });

  // update monitors
  screen.userData.monitors.forEach( (monitor, i) => {
    monitor.userData.plane.copy( monitor.userData.plane0 ).applyMatrix4( screen.matrix );

    const uniforms = monitor.material.uniforms;
    uniforms.uNormalize.value.copy( display.userData.uNormalize );
    uniforms.uPlaneNormal.value.forEach( (value, i) => value.copy( display.userData.uPlaneNormal[i] ));
    uniforms.uPlaneOrigin.value.copy( display.userData.uPlaneOrigin );   
  });

  updateScreenAxis();
}

function updateScreenAxis () {

  screen.userData.monitors.forEach( (monitor) => {

    const axis = monitor.userData.axis;
    axis.userData.ray.copy( axis.userData.ray0 ).applyMatrix4( screen.matrixWorld );
    
    const intersections = intersectContainer( axis.userData.ray ); // world coordinate system
    axis.visible = ( intersections.length === 2 );

    if ( intersections.length === 2 ) {
      axis.userData.points = intersections.map( (intersection) => screen.worldToLocal( intersection.point ) ); 
      axis.position.copy( axis.userData.points[0] );
      axis.setLength( axis.userData.points[0].distanceTo( axis.userData.points[1] ), 0.02, 0.01 );
    }    
  });

}

function intersectScreen ( rayOrOrigin, direction ) {
  // return the intersection of raycaster with each monitor of the screen
  
  if ( rayOrOrigin instanceof THREE.Ray && direction === undefined ) {

    raycaster.set( rayOrOrigin.origin, rayOrOrigin.direction );

  } else {

    raycaster.set( rayOrOrigin, direction );

  }

  // compute intersection
  let intersections = [];
  screen.userData.monitors.forEach( (monitor) => {

    intersections.push( raycaster.intersectObject( monitor, false ) [0] );

  });

  // filter intersections
  intersections.sort( (a, b) => a.distance - b.distance );
  intersections = intersections.filter( (intersection) => 

    intersection && container.userData.obb.containsPoint( intersection.point )

  );

  return intersections;
}

function intersectsScreenCenter ( rayOrOrigin, direction ) {

  if ( rayOrOrigin instanceof THREE.Ray && direction === undefined ) {

    raycaster.set( rayOrOrigin.origin, rayOrOrigin.direction );

  } else {

    raycaster.set( rayOrOrigin, direction );

  }

  return raycaster.intersectObject( screen.userData.center, false ).length > 0;

}

// model

function setupModel () {

  const uniforms = {  

    // global uniforms
    uNormalize: { value: new THREE.Matrix4() },
    uDeNormalize: { value: new THREE.Matrix4() },
    uMatrix: { value: new THREE.Matrix4() },
    uCameraPosition: { value: new THREE.Vector3() },

    // plane uniforms
    uPlaneHessian: { value: [0, 1, 2].map( (i) => new THREE.Vector4() ) },
    uPlaneVisible: { value: [0, 1, 2].map( (i) => true ) },
    uPlaneAlpha: { value: [0, 1, 2].map( (i) => 1.0 ) }, 

    // mask uniforms
    uMaskMap: { value: mask.userData.texture },
    uMaskSize: { value: mask.userData.size },
    uMaskSamples: { value: mask.userData.samples },    
    uMaskVoxelSize: { value: mask.userData.voxelSize },

    uBoxMax: { value: new THREE.Vector3() },
    uBoxMin: { value: new THREE.Vector3() },

    // model parameters
    uModelAlpha: { value: 1.0 },
    uModelAlphaClip: { value: 1.0 },     
  };

  uniforms.uTextelSize = { value: new THREE.Vector3( 
    1 / mask.userData.samples.x, 
    1 / mask.userData.samples.y, 
    1 / mask.userData.samples.z
  )};
  uniforms.uResolution = { value: uniforms.uTextelSize.value.length() };
  
  const size = new THREE.Vector3().copy( mask.userData.size );
  const geometry = new THREE.BoxGeometry( ...size.toArray() );
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,

    // // shader parameters
    uniforms: uniforms,
    vertexShader: vertexModel,
    fragmentShader: fragmentModel,

    // material parameters
    side: THREE.BackSide,
    transparent: true,
    depthTest: false,
    depthWrite: true,
  })

  model.geometry = geometry;
  model.material = material;

  computeBoundingBoxModel();
}

function updateModel () {

  const uniforms = model.material.uniforms;
  uniforms.uNormalize.value.copy( display.userData.uNormalize );
  uniforms.uDeNormalize.value.copy( display.userData.uDeNormalize );
  uniforms.uCameraPosition.value.copy( display.userData.uCameraPosition ); 
  uniforms.uPlaneHessian.value.forEach( (value, i) => value.copy( display.userData.uPlaneHessian[i] ));
  uniforms.uPlaneVisible.value.forEach( (_, i, array) => array[i] = screen.userData.monitors[i].material.uniforms.uPlaneVisible.value );
  uniforms.uPlaneAlpha.value.forEach( (_, i, array) => array[i] = screen.userData.monitors[i].material.uniforms.uPlaneAlpha.value );   

  uniforms.uMatrix.value.copy( display.userData.uMatrix );
}

function computeBoundingBoxModel () {
  
  const samples = mask.userData.samples;
  const voxel = mask.userData.voxelSize;
  const offset = voxel.length() * 0.01;
  const center = new THREE.Vector3().copy( mask.userData.size ).divideScalar( 2 );
  
  let n = 0;
  const min = new THREE.Vector3();
  const max = new THREE.Vector3();
  const point = new THREE.Vector3();
  const data = mask.userData.texture.image.data;

  for ( let k = 0; k < samples.z; k++ ) {
    const offsetK = samples.x * samples.y * k

    for ( let j = 0; j < samples.y; j++ ) {
      const offsetJ = samples.x * j 

      for ( let i = 0; i < samples.x; i++ ) {

        n = i + offsetJ + offsetK;

        if ( data[n] > 0 ) {

          point.set( i, j, k ).multiply( voxel ).sub( center ); // display coordinates
  
          min.x = Math.min( min.x, point.x );
          min.y = Math.min( min.y, point.y );
          min.z = Math.min( min.z, point.z );
  
          max.x = Math.max( max.x, point.x );
          max.y = Math.max( max.y, point.y );
          max.z = Math.max( max.z, point.z );

        }
      }              
    }
  }

  min.sub( voxel ).subScalar( offset ); 
  max.add( voxel ).addScalar( offset );
  const box = new THREE.Box3( min, max );

  model.userData.box = box;

  // update uniforms
  model.material.uniforms.uBoxMin.value.copy( min ).divide( mask.userData.size );
  model.material.uniforms.uBoxMax.value.copy( max ).divide( mask.userData.size );

}

// brush

function setupBrush () {

  const radius = 0.01;
  const sphere = new THREE.Sphere( new THREE.Vector3(), radius );
  const geometry = new THREE.SphereGeometry( radius );
  const material = new THREE.MeshBasicMaterial( { 
    
    color: 0xff0055, // 0x00ffff, 
    depthTest: true,
    depthWrite: true,
    transparent: true, 
    opacity: 0.4,

  });

  brush.geometry = geometry;
  brush.material = material;

  // display local coordinates

  brush.userData.mode = 'ADD';
  brush.userData.plane = new THREE.Plane();

  brush.userData.sphere = sphere;
  brush.userData.sphere0 = brush.userData.sphere.clone();

  brush.userData.box = sphere.getBoundingBox( new THREE.Box3() ).expandByVector( mask.userData.voxelSize ); 
  brush.userData.box0 = brush.userData.box.clone();

}

function updateBrush () {
  
  brush.userData.sphere.copy( brush.userData.sphere0 ).applyMatrix4( brush.matrix ); // in display coordinates
  brush.userData.box.copy( brush.userData.box0 ).applyMatrix4( brush.matrix );

  let intersections = intersectScreen( gestures.raycasters.viewRay );

  // filter invisible screen monitors and select the first monitor
  const selected = intersections.filter( (monitor) => {

    return monitor.object.material.uniforms.uPlaneVisible.value;

  }) [0];


  brush.userData.monitorIndex = undefined;

  if ( selected ) {

    brush.userData.monitorIndex = selected.object.userData.index;
    brush.userData.plane.copy( selected.object.userData.plane );
    brush.position.copy( display.worldToLocal( selected.point ) );

    brush.updateMatrix();    

    updateUI();

  }     

  // update screen uniforms
  screen.userData.monitors.forEach( (monitor) => {

    const uniforms = monitor.material.uniforms;

    uniforms.uBrushVisible.value = brush.visible;
    uniforms.uBrushColor.value.setFromColor( brush.material.color );
    uniforms.uBrushRadius.value = brush.userData.sphere.radius * display.getWorldScale( _scale ).x;
    uniforms.uBrushCenter.value.copy( brush.getWorldPosition( _position ) );

  });

}
 
// events

function onVolumeUpload ( event ) {
  
  loadNIFTI( event.target.files[0] ).then( (image3D) => {

    updateVolume( image3D );  

    setupContainer(); 
    setupScreen();
    setupModel();

    updateDisplay();
    updateUI();

    display.visible = true;

  });
}

function onMaskUpload ( event ) {

  loadNIFTI( event.target.files[0]).then( (image3D) => {

    updateMask( image3D );
    setupModel();
    updateDisplay();
    updateUI();

  });
}

function onMaskDownload ( event) {

}

function onPointerMove ( event ) {

  // calculate mouse position in normalized device coordinates
  // (-1 to +1) for both components
  pointer.x = ( event.clientX / window.innerWidth ) * 2 - 1;
  pointer.y = - ( event.clientY / window.innerHeight ) * 2 + 1;

}
  
function onKeydown ( event ) {

  switch ( event.keyCode ) {
    case 81: // Q
      transformControls.setSpace( transformControls.space === 'local' ? 'world' : 'local' );
      break;

    case 84: // T
      transformControls.setMode( 'translate' );
      break;

    case 82: // R
      transformControls.setMode( 'rotate' );
      break;

    case 83: // S
      transformControls.setMode( 'scale' );
      break;   

    case 187:
    case 107: // +, =, num+
      transformControls.setSize( transformControls.size + 0.1 );
      break;

    case 189:
    case 109: // -, _, num-
      transformControls.setSize( Math.max( transformControls.size - 0.1, 0.1 ) );
      break;

    case 68: // D
      transformControls.enabled = ! transformControls.enabled;
      transformControls.visible = ! transformControls.visible;     
      break;

    case 27: // Esc
      transformControls.reset(); 
      break;      
              
  } 
}
  
function onResize () {

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize( window.innerWidth, window.innerHeight );

}

function onButton ( event ) {

  setupAR();

}

function onHitTestResultReady ( hitPoseTransformed ) {

  if ( hitPoseTransformed ) {

    reticle.visible = true;
    reticle.matrix.fromArray( hitPoseTransformed );

  }  

}
  
function onHitTestResultEmpty () {

  reticle.visible = false;
  
}

function onSessionEnd () {

  reticle.userData.enabled = false;
  scene.remove( reticle );

  camera.position.set( 1, 0.6, 1 );   

  display.position.set( 0, 0, 0 );
  display.userData.modes = [ 'Place', 'Inspect', 'Edit',  ];
  updateDisplay();

}

// gestures
  
function onPolytap ( event ) {

  // console.log(`polyTap ${event.numTaps}: ${display.userData.modes[0]}`);

  if ( event.numTaps === 1 ) {

    // if ( display.userData.modes[0] === 'Edit') editMask( event );

  }

  if ( event.numTaps === 2 ) {
        
    if ( display.userData.modes[0] === 'Place' ) placeDisplay( event );
    if ( display.userData.modes[0] === 'Inspect' ) hideScreenMonitor( event );
    if ( display.userData.modes[0] === 'Edit' ) toggleBrush( event );

  }

}

function onSwipe ( event ) {

  // console.log(`swipe ${event.direction}: ${display.userData.modes[0]}`);
  
  if ( event.direction === 'RIGHT' ) shiftMode( event );
  if ( event.direction === 'LEFT'  ) unshiftMode( event );

  if ( event.direction === 'DOWN'  ) {

    if ( display.userData.modes[0] === 'Place'   ) undoDisplay( event );
    if ( display.userData.modes[0] === 'Inspect' ) undoScreen( event );
    if ( display.userData.modes[0] === 'Edit'    ) undoMask( event );

  }

  if ( event.direction === 'UP'  ) {

    if ( display.userData.modes[0] === 'Place'   ) redoDisplay( event );
    if ( display.userData.modes[0] === 'Inspect' ) redoScreen( event );
    if ( display.userData.modes[0] === 'Edit'    ) redoMask( event );
    
  }

}

function onHold ( event ) {

  // console.log(`hold: ${display.userData.modes[0]}`);

  if ( display.userData.modes[0] === 'Place'   ) moveDisplay( event );
  if ( display.userData.modes[0] === 'Inspect' ) {

    if ( event.start ) event.userData.flag = intersectsScreenCenter( gestures.raycasters.handRay[0] );
      
    if ( event.userData.flag ) {

      moveScreen( event );

    } else {

      moveScreenMonitor( event );

    }    

  }
  if ( display.userData.modes[0] === 'Edit'    ) editMask( event );

}

function onPan ( event ) {

  // console.log(`pan: ${display.userData.modes[0]}`);

  if ( display.userData.modes[0] === 'Place'   ) rotateDisplay( event );
  if ( display.userData.modes[0] === 'Inspect' ) rotateScreenMonitor( event );
  if ( display.userData.modes[0] === 'Edit'    ) ;


}
  
function onPinch ( event ) {

  // console.log(`pinch: ${display.userData.modes[0]}`);

  if ( display.userData.modes[0] === 'Place') resizeDisplay( event );
  if ( display.userData.modes[0] === 'Inspect') resizeDisplay( event );
  if ( display.userData.modes[0] === 'Edit') resizeBrush( event );

} 

function onTwist ( event ) {

  // console.log(`twist: ${display.userData.modes[0]}`);

  if ( display.userData.modes[0] === 'Place') rollDisplay( event );
  if ( display.userData.modes[0] === 'Inspect') rollScreen( event );
  if ( display.userData.modes[0] === 'Edit') contrastScreen( event );

}
  
function onExplode ( event ) {
  // console.log(`explode`);

  if ( event.end ) renderer.xr.getSession().end();

}
  
function onImplode ( event ) {

  // console.log(`implode ${display.userData.modes[0]}`);

  if ( display.userData.modes[0] === 'Place') resetDisplay( event );
  if ( display.userData.modes[0] === 'Inspect') resetScreen( event );
  if ( display.userData.modes[0] === 'Edit') resetMask( event );

}


// display gesture actions

function shiftMode ( event ) {

  display.userData.modes.push( display.userData.modes.shift() );

  updateUI();

}

function unshiftMode ( event ) {

  display.userData.modes.unshift( display.userData.modes.pop() );

  updateUI();

}

function saveDisplay ( event ) {

  display.updateMatrix();

  const record = { matrix: display.matrix.clone() };

  display.userData.history.unshift( record );

}

function placeDisplay ( event ) {

  if ( event.end ) {

    if ( display.visible === false ) {

      display.position.setFromMatrixPosition( reticle.matrix ); 
      display.scale.divideScalar( 3 * Math.max( ... volume.userData.size.toArray() ) );
      display.translateY( 0.2 );  
      
      updateDisplay();
  
    }

    display.visible = ! display.visible;
    reticle.visible = ! reticle.visible;
    reticle.userData.enabled = ! reticle.userData.enabled;


  }
 
}

function moveDisplay ( event ) {

  let data = event.userData;

  if ( event.start ){

    data.point = new THREE.Points();
    data.point.position.copy( display.position );
    gestures.controller[0].attach( data.point ); 

    saveDisplay( event );

  } 

  if ( event.current ) {

    data.point.getWorldPosition( display.position );

    updateDisplay();

  } 
  
  if ( event.end ) {

    gestures.controller[0].remove( data.point ); 
    data = {};

  } 

}

function rotateDisplay ( event ) {

  let data = event.userData;

  if ( event.start ) {

    data.angle = 0;  
    data.up = new THREE.Vector3();
    data.right = new THREE.Vector3();
    data.axis = new THREE.Vector3();
    data.pointerOffset = new THREE.Vector2();
    data.quaternion0 = display.quaternion.clone(); 
    
    saveDisplay( event );  

  } 

  if ( event.current ) {

    data.pointerOffset.copy( gestures.parameters[0].pointerOffset );
    
    data.up.set( 0 , 1, 0 ).multiplyScalar( data.pointerOffset.x );
    data.right.set( -1, 0, 0 ).transformDirection( camera.matrixWorld ).multiplyScalar( data.pointerOffset.y );

    data.axis.addVectors( data.up, data.right ).normalize();
    data.angle = Math.PI / 60.0 * data.pointerOffset.length();

    display.quaternion.copy( data.quaternion0 );
    display.rotateOnWorldAxis( data.axis, data.angle );

    updateDisplay();

  } 
  
  if ( event.end ) {
    
    data = {}; 

  }

}

function resizeDisplay ( event ) {

  let data = event.userData;

  if ( event.start ) {

    data.hitPlane = new THREE.Plane().setFromNormalAndCoplanarPoint( camera.getWorldDirection( _direction ), display.getWorldPosition( _position ) ); // world cs
    data.points = [ 0, 1 ].map( () => new THREE.Vector3() ); // world cs

    gestures.raycasters.handRay.forEach( (ray, i) => ray.intersectPlane( data.hitPlane, data.points[i] ) );

    if ( data.points.every( Boolean ) ) {

      data.distance0 = data.points[0].distanceTo( data.points[1] ); 
      data.distance = data.distance0;
      data.scale0 = display.scale.clone();  

      saveDisplay( event );

    }    

  } 

  if ( event.current ) {
    
    camera.getWorldDirection( data.hitPlane.normal );
    gestures.raycasters.handRay.forEach( (ray, i) => ray.intersectPlane( data.hitPlane, data.points[i] ) );

    if ( data.points.every( Boolean ) ) {

      data.distance = data.points[0].distanceTo( data.points[1] );
      display.scale.copy( data.scale0 );
      display.scale.multiplyScalar( (data.distance / data.distance0) ** 2 );

      updateDisplay();

    }

  } 
  
  if ( event.end ) {

    data = {};

  } 

}

function rollDisplay ( event ) {

  let data = event.userData;

  if ( event.start ) {

    data.origin = display.getWorldPosition( new THREE.Vector3() );
    data.hitPlane = new THREE.Plane().setFromNormalAndCoplanarPoint( camera.getWorldDirection( _direction ), data.origin ); // world cs
    data.points = [ 0, 1 ].map( () => new THREE.Vector3() ); // world cs
    
    gestures.raycasters.handRay.forEach( (ray, i) => ray.intersectPlane( data.hitPlane, data.points[i] ) );

    if ( data.points.every( Boolean ) ) {

      data.quaternion0 = display.quaternion.clone(); 

      saveDisplay( event );

    }    
  } 

  if ( event.current ) {
    
    camera.getWorldDirection( data.hitPlane.normal );
    gestures.raycasters.handRay.forEach( (ray, i) => ray.intersectPlane( data.hitPlane, data.points[i] ) );

    if ( data.points.every( Boolean ) ) {      

      display.quaternion.copy( data.quaternion0 );
      display.rotateOnWorldAxis(  data.hitPlane.normal, - gestures.parametersDual.angleOffset * Math.PI/180);

      updateDisplay();

    }
  } 
  
  if ( event.end ) {

    data = {};

  }
}

function resetDisplay ( event ) {

  saveDisplay( event );

  display.quaternion.copy( new THREE.Quaternion() ); 

  updateDisplay();  
  
}

function undoDisplay ( event ) {

  display.updateMatrix();

  const record = { matrix: display.matrix.clone() };

  display.userData.future.unshift( record );

  if ( display.userData.history.length > 0) {

    display.matrix.copy( display.userData.history.shift().matrix );
    display.matrix.decompose( display.position, display.quaternion, display.scale ); 

    updateDisplay();

  }
  
}

function redoDisplay ( event ) {

  display.updateMatrix();

  const record = { matrix: display.matrix.clone() };
  display.userData.history.unshift( record );

  if ( display.userData.future.length > 0) {

    display.matrix.copy( display.userData.future.shift().matrix );
    display.matrix.decompose( display.position, display.quaternion, display.scale ); 

    updateDisplay();

  }

}

// screen gesture actions

function saveScreen ( event ) {

  screen.updateMatrix();

  const record = { 

    matrix: screen.matrix.clone(),
    visible: screen.userData.monitors.map( (monitor) => monitor.material.uniforms.uPlaneVisible.value ),

  };

  screen.userData.history.unshift( record );

}

function moveScreen ( event ) {

  let data = event.userData;

  if ( event.start ){

    saveScreen( event );

    data.point = new THREE.Points();

    scene.attach( screen );   
    screen.getWorldPosition( data.point.position );
    gestures.controller[0].attach( data.point ); 

    model.material.uniforms.uModelAlpha.value = 0.4;
    model.material.uniforms.uModelAlphaClip.value = 0.4;
    model.material.needsUpdate;

    updateModel();

  } 

  if ( event.current ) {   

    data.point.getWorldPosition( screen.position );
    updateScreen();

  } 
  
  if ( event.end ){

    display.attach( screen );
    gestures.controller[0].remove( data.point );  

    model.material.uniforms.uModelAlpha.value = 1.0;
    model.material.uniforms.uModelAlphaClip.value = 0.4;
    model.material.needsUpdate;
    updateModel();

    data = {};   

  } 

}

function rollScreen ( event ) {

  let data = event.userData;

  if ( event.start ) {

    saveScreen( event );
    scene.attach( screen );

    camera.getWorldDirection( _direction );
    screen.getWorldPosition( _position );

    data.hitPlane = new THREE.Plane().setFromNormalAndCoplanarPoint( _direction, _position ); // world cs
    data.points = [ 0, 1 ].map( () => new THREE.Vector3() ); // world cs    
  
    gestures.raycasters.handRay.forEach( (ray, i) => ray.intersectPlane( data.hitPlane, data.points[i] ) );

    if ( data.points.every( Boolean ) ) {

      data.quaternion0 = screen.quaternion.clone(); 

      model.material.uniforms.uModelAlpha.value = 0.4;
      model.material.uniforms.uModelAlphaClip.value = 0.4;
      model.material.needsUpdate;
      updateModel();

    }    
  } 

  if ( event.current ) {

    camera.getWorldDirection( data.hitPlane.normal );        
    gestures.raycasters.handRay.forEach( (ray, i) => ray.intersectPlane( data.hitPlane, data.points[i] ) );

    if ( data.points.every( Boolean ) ) {      

      screen.quaternion.copy( data.quaternion0 );
      screen.rotateOnWorldAxis( data.hitPlane.normal, - gestures.parametersDual.angleOffset * Math.PI / 180 );

      updateDisplay();

    };
  } 
  
  if ( event.end ) {

    display.attach( screen );

    model.material.uniforms.uModelAlpha.value = 1.0;
    model.material.uniforms.uModelAlphaClip.value = 0.4;
    model.material.needsUpdate;
    updateModel();
    
    data = {};

  }
}

function contrastScreen ( event ) {

  let data = event.userData;

  if ( event.start ) {

    data.contrast0 = screen.userData.monitors.map( (monitor) => monitor.material.uniforms.uContrast.value );

  } 

  if ( event.current ) {

    screen.userData.monitors.forEach( (monitor, i) => {

      monitor.material.uniforms.uContrast.value = data.contrast0[i] - 7 * gestures.parametersDual.angleOffset / 360;
      monitor.material.needsUpdate = true;

    });

  } 
  
  if ( event.end ) {

    data = {};

  } 
}

function resetScreen ( event ) {

  saveScreen( event );

  screen.position.copy( new THREE.Vector3() );
  screen.quaternion.copy( new THREE.Quaternion() );   
  screen.userData.monitors.forEach( (monitor) => {

    const uniforms = monitor.material.uniforms;
    uniforms.uPlaneVisible.value = true;

  });

  updateDisplay();
  
}

function undoScreen ( event ) {

  screen.updateMatrix();

  const record = { 

    matrix: screen.matrix.clone(),
    visible: screen.userData.monitors.map( (monitor) => monitor.material.uniforms.uPlaneVisible.value ),

  };

  screen.userData.future.unshift( record );

  if ( screen.userData.history.length > 0 ) {

    const record = screen.userData.history.shift();

    screen.matrix.copy( record.matrix );
    screen.matrix.decompose( screen.position, screen.quaternion, screen.scale ); 

    screen.userData.monitors.forEach( (monitor, i) => {

      monitor.material.uniforms.uPlaneVisible.value = record.visible[i];

    } );

    updateDisplay();

  }
  
}

function redoScreen ( event ) {
  
  screen.updateMatrix();

  const record = { 

    matrix: screen.matrix.clone(),
    visible: screen.userData.monitors.map( (monitor) => monitor.material.uniforms.uPlaneVisible.value ),

  };

  screen.userData.history.unshift( record );

  if ( screen.userData.future.length > 0 ) {

    const record = screen.userData.future.shift();

    screen.matrix.copy( record.matrix );
    screen.matrix.decompose( screen.position, screen.quaternion, screen.scale ); 

    screen.userData.monitors.forEach( (monitor, i) => {

      monitor.material.uniforms.uPlaneVisible.value = record.visible[i];

    } );

    updateDisplay();

  }

}

function hideScreenMonitor ( event ) {

  if ( event.end ) {

    const selected = intersectScreen( gestures.raycasters.handRay[0] )[0];
  
    if ( selected ) {
  
      saveScreen( event );
      
      const uniforms = selected.object.material.uniforms;
      uniforms.uPlaneVisible.value = ! uniforms.uPlaneVisible.value;
  
    }
    
  }

}

function moveScreenMonitor (event) {

  let data = event.userData;

  if (event.start) {
  
    data.selected = intersectScreen( gestures.raycasters.handRay[0] )
    .filter( (intersection) => intersection.object.material.uniforms.uPlaneVisible.value ) [0];

    if ( data.selected ) {

      saveScreen( event );

      scene.attach( screen ); // screen becomes a world object
      updateScreen();

      data.translation = new THREE.Vector3(); // world cs
      data.direction = data.selected.object.userData.plane.normal.clone(); // world cs 
      data.position = screen.position.clone(); // world cs
      data.position0 = screen.position.clone(); // world cs

      const normal = camera.getWorldDirection( _direction ).projectOnPlane( data.direction ).normalize();
      data.origin = data.selected.point.clone(); // world cs
      data.hitPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, data.origin); // world cs
      data.point = new THREE.Vector3(); // world cs  

      model.material.uniforms.uModelAlpha.value = 0.4;
      model.material.uniforms.uModelAlphaClip.value = 0.4;
      model.material.needsUpdate;

      updateModel();

    }
  }

  if ( event.current && data.selected ) {

    // update plane normal depending on camera 
    camera.getWorldDirection(data.hitPlane.normal).projectOnPlane(data.direction).normalize();

    // intersect ray and plane
    gestures.raycasters.handRay[0].intersectPlane(data.hitPlane, data.point); // world cs

    // move screen depending on intersection
    if ( data.point ) {

      data.translation.subVectors(data.point, data.origin).projectOnVector(data.direction);
      data.position.copy(data.position0).add(data.translation);

      screen.position.copy( data.position );
      updateScreen();

      // // move screen only if the new position is inside the container
      // if ( container.userData.obb.containsPoint(data.position) ) {

        
      // }
    }
  }

  if ( event.end && data.selected ) {

    display.attach(screen);
    updateScreen();

    model.material.uniforms.uModelAlpha.value = 1.0;
    model.material.uniforms.uModelAlphaClip.value = 0.4;
    model.material.needsUpdate;
    updateModel();

    data = {};


  }
}

function rotateScreenMonitor ( event ) {

  let data = event.userData;

  if ( event.start ){

    // get screen intersections with visible monitors
    data.selected = intersectScreen( gestures.raycasters.handRay[0] )
    .filter( (intersection) => intersection.object.material.uniforms.uPlaneVisible.value )[0];
   
    if ( data.selected ) {
      
      saveScreen( event );

      scene.attach( screen ); // screen becomes a world object
      updateScreen();

      data.point = data.selected.point.clone(); // world cs
      data.axis = positionToAxis( data.point ); // world cs

      screen.getWorldPosition( _position ); // world cs
      data.center = data.point.clone().sub( _position ).projectOnVector( data.axis ).add( _position ); // world cs  
      data.hitPlane = new THREE.Plane().setFromNormalAndCoplanarPoint( data.axis, data.center ); // world cs

      data.pointer = data.point.clone().sub( data.center ); // world cs
      data.reference = data.pointer.clone().normalize(); // world cs
      data.orthogonal = data.reference.clone().applyAxisAngle( data.axis, Math.PI/2 ).normalize(); // world cs
     
      data.radius = new THREE.Vector2();
      data.angle = 0;
      data.quaternion0 = screen.quaternion.clone();
      data.quaternion = new THREE.Quaternion(); 

      model.material.uniforms.uModelAlpha.value = 0.4;
      model.material.uniforms.uModelAlphaClip.value = 0.4;
      model.material.needsUpdate;
      updateModel();

    }
  } 

  if ( event.current && data.selected ) {
          
    gestures.raycasters.handRay[0].intersectPlane( data.hitPlane, data.point ); // world cs

    if ( data.point ) {

      data.pointer.copy( data.point ).sub( data.center ); // world cs
      data.radius.set( data.pointer.dot( data.reference ), data.pointer.dot( data.orthogonal ) );

      data.angle = ( data.radius.length() > 1e-2 ) ? Math.atan2( data.radius.y, data.radius.x ) : 0;   
      
      screen.quaternion.copy( data.quaternion0 );
      screen.rotateOnWorldAxis( data.axis, data.angle ); 

      updateScreen();          

    }

  } 
  
  if ( event.end ) {

    display.attach( screen );    
    
    model.material.uniforms.uModelAlpha.value = 1.0;
    model.material.uniforms.uModelAlphaClip.value = 0.4;
    model.material.needsUpdate;
    updateModel();

    data = {};

  } 

}

// brush gesture actions

function editMask ( event ) {

  let data = event.userData;
  console.log( data );

  if ( event.start ) {

    data.center = mask.userData.size.clone().multiplyScalar( 0.5 );
    data.offset = mask.userData.voxelSize.clone().multiplyScalar( 0.01 );    
  
    data.bounds = new THREE.Box3();
    data.value = ( brush.userData.mode === 'ADD' ) ? 255 : 0;

    data.voxelCenter = new THREE.Vector3();
    data.voxelBox = new THREE.Box3();

    // record changes
    data.record = { indices: [], data: [], box: model.userData.box.clone() };

  }

  if ( event.current ) {

    // data.bounds.copy(  brush.userData.box );
    data.bounds = projectBoxOnPlane( brush.userData.box, brush.userData.plane );

    data.bounds.min = positionToSample( data.bounds.min ).subScalar( 1 );
    data.bounds.max = positionToSample( data.bounds.max ).addScalar( 1 );
    
    for (let k = data.bounds.min.z; k <= data.bounds.max.z; k++) {
      const offsetK = mask.userData.samples.x * mask.userData.samples.y * k
  
      for (let j = data.bounds.min.y; j <= data.bounds.max.y; j++) {
        const offsetJ = mask.userData.samples.x * j 
  
        for (let i = data.bounds.min.x; i <= data.bounds.max.x; i++) {

          let n = i + offsetJ + offsetK;

          if ( mask.userData.texture.image.data[n] !== data.value ) {

            data.voxelCenter.set( i, j, k ).addScalar( 0.5 ).multiply( mask.userData.voxelSize ).sub( data.center );          
            data.voxelBox.setFromCenterAndSize( data.voxelCenter, mask.userData.voxelSize ).expandByVector( data.offset ); // in display local coordinates
          
            if ( data.voxelBox.intersectsPlane( brush.userData.plane ) && data.voxelBox.intersectsSphere( brush.userData.sphere ) ) {

              // record changes
              data.record.indices.push( n );
              data.record.data.push( mask.userData.texture.image.data[ n ] );

              // edit mask
              mask.userData.texture.image.data[ n ] = data.value;   

              if ( brush.userData.mode === 'ADD' ) model.userData.box.union( data.voxelBox );

            }  

          }
          
        }              
      }
    }
  
    mask.userData.texture.needsUpdate = true;

    // update model uniforms
    model.material.uniforms.uMaskMap.value = mask.userData.texture;    

    if ( brush.userData.mode === 'ADD' ) {
      
      model.material.uniforms.uBoxMin.value.copy( model.userData.box.min ).divide( mask.userData.size ); 
      model.material.uniforms.uBoxMax.value.copy( model.userData.box.max ).divide( mask.userData.size );

    } 
    model.material.needsUpdate = true;

    // update screen uniforms
    screen.userData.monitors.forEach( (monitor) => {

      monitor.material.uniforms.uMaskMap.value = mask.userData.texture;
      monitor.material.needsUpdate;

    });
  
  }

  if ( event.end ) {

    mask.userData.history.unshift( data.record );

    // update model uniforms
    if ( brush.userData.mode === 'SUB' ) {

      computeBoundingBoxModel();

      model.material.uniforms.uBoxMin.value.copy( model.userData.box.min ).divide( mask.userData.size ); 
      model.material.uniforms.uBoxMax.value.copy( model.userData.box.max ).divide( mask.userData.size );

    } 

    model.material.needsUpdate = true;

    data = {};
  }
}

function resetMask ( event ) {

  for ( let i = 0; i < mask.userData.data0.length; i++ ) {
    mask.userData.texture.image.data[i] = mask.userData.data0[i];
  } mask.userData.texture.needsUpdate = true;

  // update model uniforms
  computeBoundingBoxModel();

  model.material.uniforms.uMaskMap.value = mask.userData.texture;
  model.material.uniforms.uBoxMin.value.copy( model.userData.box.min ).divide( mask.userData.size ); 
  model.material.uniforms.uBoxMax.value.copy( model.userData.box.max ).divide( mask.userData.size );
  model.material.needsUpdate = true;

  // update screen uniforms
  screen.userData.monitors.forEach( (monitor) => {

    monitor.material.uniforms.uMaskMap.value = mask.userData.texture;
    monitor.material.needsUpdate = true;

  });

  updateDisplay();
}

function undoMask ( event ) {
  
  if ( mask.userData.history.length > 0 ) {

    updateModel();

    const recordPrevious = mask.userData.history.shift();
    const recordCurrent = { indices: [ ...recordPrevious.indices ], data: [], box: model.userData.box.clone() };

    // change the data of texture to the previous record
    // and save the current data to a future record
    for ( let i = 0; i < recordPrevious.indices.length; i++ ) {

      const n = recordPrevious.indices[ i ];
      recordCurrent.data.push( mask.userData.texture.image.data[ n ] );
      mask.userData.texture.image.data[ n ] = recordPrevious.data[ i ];

    }

    mask.userData.future.unshift( recordCurrent );
    mask.userData.texture.needsUpdate = true;

    // update model uniforms
    model.userData.box.copy( recordPrevious.box );
    model.material.uniforms.uMaskMap.value = mask.userData.texture;
    model.material.uniforms.uBoxMin.value.copy( model.userData.box.min ).divide( mask.userData.size ); 
    model.material.uniforms.uBoxMax.value.copy( model.userData.box.max ).divide( mask.userData.size );
    model.material.needsUpdate = true;

    // update screen uniforms
    screen.userData.monitors.forEach( (monitor) => {

      monitor.material.uniforms.uMaskMap.value = mask.userData.texture;
      monitor.material.needsUpdate = true;

    });

    updateModel();
    updateScreen();

  }
  
}

function redoMask ( event ) {
  
  if ( mask.userData.future.length > 0 ) {

    updateModel();

    const recordNext = mask.userData.future.shift();
    const recordCurrent = { indices: [ ...recordNext.indices ], data: [], box: model.userData.box.clone() };

    for ( let i = 0; i < recordNext.indices.length; i++ ) {

      const n = recordNext.indices[ i ];
      recordCurrent.data.push( mask.userData.texture.image.data[ n ] );
      mask.userData.texture.image.data[ n ] = recordNext.data[ i ];

    }

    mask.userData.history.unshift( recordCurrent );
    mask.userData.texture.needsUpdate = true;

    // update model uniforms
    model.userData.box.copy( recordNext.box );
    model.material.uniforms.uMaskMap.value = mask.userData.texture;
    model.material.uniforms.uBoxMin.value.copy( model.userData.box.min ).divide( mask.userData.size ); 
    model.material.uniforms.uBoxMax.value.copy( model.userData.box.max ).divide( mask.userData.size );
    model.material.needsUpdate = true;

    // update screen uniforms
    screen.userData.monitors.forEach( (monitor) => {

      monitor.material.uniforms.uMaskMap.value = mask.userData.texture;
      monitor.material.needsUpdate = true;

    });

    updateModel();
    updateScreen();

  }

}

function toggleBrush ( event ) {

  if ( event.end ) {

    if ( brush.userData.mode === 'ADD' ) {

      brush.userData.mode = 'SUB';
      brush.material.color.set( 0x00ffff );
  
    } else {
  
      brush.userData.mode = 'ADD';
      brush.material.color.set( 0xff0055 );
  
    }

  }
 
}

function resizeBrush ( event ) {

  let data = event.userData;

  if ( event.start ) {
  
    data.scale0 = brush.scale.clone();    
    data.scalar = 1;

  } 

  if ( event.current ) {

    data.scalar = ( gestures.parametersDual.distance / gestures.parametersDual.distance0 ) ** 1.5;
    brush.scale.copy( data.scale0 );
    brush.scale.multiplyScalar( data.scalar );

    updateDisplay();
    
  } 
  
  if ( event.end ) { 
    
    data = {};

  }

}

// helpers

async function loadShader ( url ) {

  const response = await fetch(url);
  
  if ( ! response.ok ) {

    throw new Error(`Failed to load shader: ${url}`);

  }

  return await response.text();

}

function loadNIFTI ( file ) {

  return new Promise((resolve, reject) => {
    
    if ( ! file ) reject("Error: No file selected");   
    const reader  = new PIXPIPE.FileToArrayBufferReader();
    reader.addInput(file);
    reader.update();

    reader.on("ready", function () {

      const decoder = new PIXPIPE.Image3DGenericDecoder();  
      decoder.addInput( this.getOutput() );
      decoder.update();

      if ( ! decoder.getOutput() ) reject("Error: File cannot be decoded");
      const image3D = decoder.getOutput();
      resolve( image3D );
      
    });

  });

}

function saveNIFTI ( file ) {

  if ( nifti.isCompressed(event.target.result) ) {

    fileDecompressed = nifti.decompress(event.target.result);

  } else {

    fileDecompressed = event.target.result;

  }
  
  const niftiHeaderTmp = fileDecompressed.slice(0, 352);
  const tmp = new Uint16Array(niftiHeaderTmp, 0, niftiHeaderTmp.length);
  tmp[35] = 2;

  const data = [tmp, new Uint16Array(masks.buffer, 0, masks.buffer.length)];
  const fileName = "masks.nii";

  saveData(data, fileName);

}

function saveData ( data, fileName ) {

	const element = document.createElement("a");
	document.body.appendChild( element );
  element.style.display = 'none';

  // Ensure data is in an array and specify the MIME type (if known/applicable)
	const blob = new Blob( data );
	const url = window.URL.createObjectURL( blob );

	element.href = url;
	element.download = fileName;
	element.click();
  
  // Clean up
	window.URL.revokeObjectURL( url );
  document.body.removeChild( element );

}

function projectBoxOnPlane ( box, plane ) {

  _points[0].set(box.min.x, box.min.y, box.min.z);
  _points[1].set(box.max.x, box.min.y, box.min.z);
  _points[2].set(box.min.x, box.max.y, box.min.z);
  _points[3].set(box.max.x, box.max.y, box.min.z);
  _points[4].set(box.min.x, box.min.y, box.max.z);
  _points[5].set(box.max.x, box.min.y, box.max.z);
  _points[6].set(box.min.x, box.max.y, box.max.z);
  _points[7].set(box.max.x, box.max.y, box.max.z);

  _points.forEach( (point) => plane.projectPoint( point, point ) );

  return _box.setFromPoints( _points );
}

function positionToSample ( position ) {
  // convert position in display's local coordinates to voxel sample vector index

  const samples = mask.userData.samples;
  const voxel = mask.userData.voxelSize;
  const center = new THREE.Vector3().copy( mask.userData.size ).divideScalar( 2 );

  const indices = new THREE.Vector3(
    Math.round( (position.x + center.x) / voxel.x ),
    Math.round( (position.y + center.y) / voxel.y ),
    Math.round( (position.z + center.z) / voxel.z ),
  );

  const minIndices = new THREE.Vector3();
  const maxIndices = new THREE.Vector3().copy( samples ).subScalar( 1 );
  indices.clamp( minIndices, maxIndices );

  return indices;
}

function positionToAxis ( position ) {
  // position in world coordinates

  // compute the local screen vector of the position
  const vector = position.clone();
  screen.worldToLocal( vector );

  // determine in which octant the vector lies
  const octant = vector.toArray().map( (value) => Math.sign( value ) )
  const indices = octant.map( sign => Math.floor( sign > 0) );

  // compute the monitor lengths to the container
  const monitorLengths = screen.userData.monitors.map( (monitor, i) => 
      monitor.userData.axis.userData.points[indices[i]].length()
  );

  // normalize the local position vector to be inside the unit cube
  const scale = new THREE.Vector3().fromArray( monitorLengths );
  vector.divide( scale );

  // compute the correlation of the vector with each axis
  const axes = [ _right, _up, _forward ].map( (axis) => axis.clone() );
  const correlation = axes.map( (axis) => 
    Math.abs( _vector.copy( vector ).projectOnVector( axis ).length() )
  );
 
  // determine the closest axis to the vector
  const index = correlation.indexOf( Math.max(...correlation) );
  const axis = axes[ index ].multiplyScalar( octant[ index ] );
  axis.transformDirection( screen.matrixWorld );

  // return the axis in world coordinates
  return axis;
}

function getGeometryVertices ( geometry ) {

  let vertices = new Array( geometry.attributes.position.count ).fill().map( () => new THREE.Vector3() );

  // get geometry vertices
  for ( let i = 0; i < geometry.attributes.position.count; i++ ) {

    vertices[i].fromBufferAttribute( geometry.attributes.position, i );
  
  }

  // remove duplicates
  vertices = vertices.filter( (vector0, i) => {

    // return ! vertices.slice( i + 1 ).some( (vector1) => vector1.equals(vector0) );
    return ! vertices.slice( i + 1 ).some( (vector1) => vector1.distanceTo(vector0) < 1e-6 );


  });

  return vertices;

}

function applyVectorFunction ( vector, fun ) {

  vector.set(

    fun( vector.x ),
    fun( vector.y ),
    fun( vector.z ),
    
  )
  
}
