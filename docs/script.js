import GUI from "lil-gui"
import * as THREE from "three"
import * as PIXPIPE from "./prm/pixpipe.esmodule.js"
import { XRGestures } from './prm/XRGestures.js'
import { OBB } from 'three/addons/math/OBB.js'
import { ARButton } from 'three/addons/webxr/ARButton.js'
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

// place holder variables

const _position   = new THREE.Vector3();
const _direction  = new THREE.Vector3();
const _scale      = new THREE.Vector3();  
const _quaternion = new THREE.Quaternion();
const _raycaster  = new THREE.Raycaster();
const _vector2    = new THREE.Vector2();
const _vector3    = new THREE.Vector3();
const _matrix3    = new THREE.Matrix4();
const _matrix4    = new THREE.Matrix4();
const _box        = new THREE.Box3();
const _points     = new Array( 8 ).fill().map( () => new THREE.Vector3() );

// constants
const _xAxis   = new THREE.Vector3( 1, 0, 0 ); // right
const _yAxis   = new THREE.Vector3( 0, 1, 0 ); // up
const _zAxis   = new THREE.Vector3( 0, 0, 1 ); // forward
const _red     = new THREE.Color( 1, 0, 0 );
const _green   = new THREE.Color( 0, 1, 0 );
const _blue    = new THREE.Color( 0, 0, 1 );

// load shaders
const vertexScreen = await loadShader('./prm/vertex_screen.glsl');
const fragmentScreen = await loadShader('./prm/fragment_screen.glsl');
const vertexModel = await loadShader('./prm/vertex_model.glsl');
const fragmentModel = await loadShader('./prm/fragment_model.glsl');

// global objects
let camera, scene, renderer, canvas, orbitControls; // scene objects

let display, container, screen, model, brush, volume, mask, selector3D, selector2D; // main objects

let raycaster, gestures, reticle; // helper objects

let hitTestSource, hitTestSourceRequested, hitTestResult; // parameters AR

let worker;

main();

function main () {

  setupObjects();
  setupScene();
  setupGui();
  setupButton();
  // setupWorkerMobileSam();
  
  renderer.setAnimationLoop( updateAnimation );

}

function setupObjects () {

  display = new THREE.Object3D();
  screen  = new THREE.Object3D();

  container  = new THREE.Mesh();
  model      = new THREE.Mesh();
  brush      = new THREE.Mesh();
  reticle    = new THREE.Mesh();
  selector2D = new THREE.Mesh();
  selector3D = new THREE.Mesh();

  raycaster = new THREE.Raycaster();
  
  setupVolumeObject();
  setupMaskObject();

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
 
  // scene

  scene = new THREE.Scene();  

  // scene graph

  scene.add( camera )
  scene.add( display );
  scene.add( reticle );

  display.add( screen );
  display.add( model );
  display.add( selector3D);
  display.add( brush );
  display.add( container );

  screen.add( selector2D );

  // render order

  [ reticle, screen, model, selector2D, selector3D, brush, container ].forEach( (object3D, i) => object3D.renderOrder = i );

  // event listeners

  window.addEventListener( 'resize', onResize );  
  
  // setup 

  setupDisplay();
  setupReticle();
  setupGestures();

}

function setupGui () {

  const gui = new GUI( { closeFolders: false } );
  const [folders, buttons] = [0, 1].map( () => [] );
  gui.domElement.classList.add( 'force-touch-styles' );
  
  // volume

  folders[0] = gui.addFolder( 'Volume' );  

  buttons[0] = document.getElementById( 'volumeId' ); 
  folders[0].add( buttons[0], 'click' ).name('Upload Volume');  
  buttons[0].addEventListener( 'change', (event) => onVolumeUpload( event ) );  
    
  // mask

  folders[1] = gui.addFolder('Mask');

  buttons[1] = document.getElementById( 'maskId' ); 
  folders[1].add( buttons[1], 'click' ).name('Upload Mask'); 
  buttons[1].addEventListener( 'change', (event) => onMaskUpload( event ) );

  folders[1].add( { action: onMaskDownload }, 'action' ).name('Download Mask'); 

}

function setupButton () {   

  const overlay = document.getElementById( 'overlay-content' );
  const button = ARButton.createButton( renderer, {
    requiredFeatures: [ 'hit-test' ],
    optionalFeatures: [ 'dom-overlay' ],
    domOverlay: { root: overlay },     
  });

  document.body.appendChild( button );     
  button.addEventListener( 'click', onButton );

}

function updateAnimation ( timestamp, frame ) {

  // hit test

  if ( renderer.xr.isPresenting && reticle.userData.enabled) {

    updateHitTest( renderer, frame, onHitTestResultReady, onHitTestResultEmpty, onSessionEnd );  

  }

  // updates

  if ( renderer.xr.isPresenting ) gestures.update();
  if ( display.visible) updateDisplay();

  // render

  renderer.render( scene, camera );
}
  
function setupReticle () {

  const geometry = new THREE.RingGeometry( 0.15, 0.2, 32 ).rotateX( -Math.PI / 2 );
  const material = new THREE.MeshBasicMaterial({ 
    color: 0xffffff,
    transparent: true,
    opacity: 0.7,
  });

  reticle.visible = false;
  reticle.geometry = geometry;
  reticle.material = material;
  reticle.matrixAutoUpdate = false;
  reticle.userData.enabled = false;

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
 
function updateUI () {

  const mode = display.userData.modes[0];

  brush.visible      = ( mode === 'Edit' )
  selector2D.visible = ( mode === 'Segment2D' );
  selector3D.visible = ( mode === 'Segment3D' );

  if ( mode === 'Place' ) {

    container.material.opacity = 0.2;   
    container.userData.outline.visible = true;

    model.visible = true;
    model.material.uniforms.uModelAlpha.value = 0.8;
    model.material.uniforms.uModelAlphaClip.value = 0.8;

    screen.userData.monitors.forEach( (monitor) => {

      monitor.renderOrder = 1.0;
      monitor.visible = true;

      const uniforms = monitor.material.uniforms;
      uniforms.uPlaneAlpha.value = 1.0;     
      uniforms.uBrushVisible.value = brush.visible;
      uniforms.uSelectorVisible.value = selector3D.visible;

    });  

  }

  if ( mode === 'Inspect' ) {

    container.material.opacity = 0.0;   
    container.userData.outline.visible = true;

    model.visible = true;
    model.material.uniforms.uModelAlpha.value = 0.8;
    model.material.uniforms.uModelAlphaClip.value = 0.4;
   
    screen.userData.monitors.forEach( (monitor) => {

      monitor.renderOrder = 1.0;
      monitor.visible = true;

      const uniforms = monitor.material.uniforms;
      uniforms.uPlaneAlpha.value = 1.0;     
      uniforms.uBrushVisible.value = brush.visible;
      uniforms.uSelectorVisible.value = selector3D.visible;

    });  

  }

  if ( mode === 'Edit' ) {

    container.material.opacity = 0.0;   
    container.userData.outline.visible = false;

    model.visible = false;
    model.material.uniforms.uModelAlpha.value = 0.0;
    model.material.uniforms.uModelAlphaClip.value = 0.0;
  
    screen.userData.monitors.forEach( (monitor) => {  

      const isSelected = ( monitor.userData.index === brush.userData.monitorIndex );   

      monitor.renderOrder = isSelected ? 1.5 : 1.0;
      monitor.visible = true;

      const uniforms = monitor.material.uniforms;
      uniforms.uPlaneAlpha.value = isSelected ? 1.0 : 0.6;
      uniforms.uBrushVisible.value = brush.visible;
      uniforms.uSelectorVisible.value = selector3D.visible;

    });  

  }

  if ( mode === 'Segment2D' ) {

    container.material.opacity = 0.0;   
    container.userData.outline.visible = false;

    model.visible = false;
    model.material.uniforms.uModelAlpha.value = 0.4;
    model.material.uniforms.uModelAlphaClip.value = 0.4;

    screen.userData.monitors.forEach( (monitor) => {  

      const isSelected = ( monitor.userData.index === brush.userData.monitorIndex );   

      monitor.renderOrder = isSelected ? 1.5 : 1.0;
      monitor.visible = true;

      const uniforms = monitor.material.uniforms;
      uniforms.uPlaneAlpha.value = isSelected ? 1.0 : 0.6;
      uniforms.uBrushVisible.value = brush.visible;
      uniforms.uSelectorVisible.value = selector3D.visible;

    });  

  }

  if ( mode === 'Segment3D' ) {

    container.material.opacity = 0.0;   
    container.userData.outline.visible = false;

    model.visible = false;
    model.material.uniforms.uModelAlpha.value = 0.4;
    model.material.uniforms.uModelAlphaClip.value = 0.4;

    screen.userData.monitors.forEach( (monitor) => {

      monitor.renderOrder = 1.0;
      monitor.visible = true;

      const uniforms = monitor.material.uniforms;
      uniforms.uPlaneAlpha.value = 1.0;     
      uniforms.uBrushVisible.value = brush.visible;
      uniforms.uSelectorVisible.value = selector3D.visible;

    });  
  }
  
}

// display

function setupDisplay () {

  // objects 3D

  setupScreen();
  setupModel();
  setupContainer(); 
  setupBrush();
  setupSelector3D();
  // setupSelector2D();

  // uniforms

  setupGlobalUniforms();
  setupScreenUniforms();
  setupModelUniforms();

  // parameters

  display.visible = false;
  display.matrixAutoUpdate = false;

  display.userData.modes = [ 'Place', 'Inspect', 'Edit', 'Segment3D', ]; 
  display.userData.history = [];
  display.userData.future = [];

  // visual UI

  updateUI(); 

}

function updateDisplay () {
  
  display.updateMatrix();

  // objects 3D

  if ( container.visible ) updateContainer();
  if ( screen.visible ) updateScreen();
  if ( model.visible) updateModel();
  if ( brush.visible ) updateBrush();
  // if ( selector2D.visible ) updateSelector2D();
  if ( selector3D.visible ) updateSelector3D();
  
  // uniforms

  updateGlobalUniforms();
  updateScreenUniforms();
  updateModelUniforms();

}

function shiftMode () {

  display.userData.modes.push( display.userData.modes.shift() );

  updateUI();

}

function unshiftMode () {

  display.userData.modes.unshift( display.userData.modes.pop() );

  updateUI();

}

function resetDisplay () {

  saveDisplay();

  display.quaternion.copy( new THREE.Quaternion() ); 

  updateDisplay();  
  
}

function saveDisplay () {

  display.updateMatrix();

  const record = { matrix: display.matrix.clone() };

  display.userData.history.unshift( record );

}

function undoDisplay () {

  display.updateMatrix();

  const record = { matrix: display.matrix.clone() };

  display.userData.future.unshift( record );

  if ( display.userData.history.length > 0) {

    display.matrix.copy( display.userData.history.shift().matrix );
    display.matrix.decompose( display.position, display.quaternion, display.scale ); 

    updateDisplay();

  }
  
}

function redoDisplay () {

  display.updateMatrix();

  const record = { matrix: display.matrix.clone() };
  display.userData.history.unshift( record );

  if ( display.userData.future.length > 0) {

    display.matrix.copy( display.userData.future.shift().matrix );
    display.matrix.decompose( display.position, display.quaternion, display.scale ); 

    updateDisplay();

  }

}

// volume

function setupVolumeObject () { 
    
  volume = { userData: {} };

  volume.userData.data0 = new Uint8Array();
  volume.userData.texture = new THREE.Data3DTexture();
  volume.userData.size = new THREE.Vector3();
  volume.userData.samples = new THREE.Vector3();
  volume.userData.voxelSize = new THREE.Vector3();

}

function updateVolume ( image3D ) { 

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
  volume.userData.image3D = image3D;
  volume.userData.data0 = image3D.getDataUint8();
  volume.userData.texture = texture;
  volume.userData.samples = samples;
  volume.userData.voxelSize = voxelSize;
  volume.userData.size = size;

}

function updateVolumeFromMask () {

  const image3D = mask.userData.image3D.clone();
  const data = image3D.getDataUint8().fill( 0 );

  const size = mask.userData.size.clone();
  const samples = mask.userData.samples.clone();
  const voxelSize = mask.userData.voxelSize.clone();

  const texture = new THREE.Data3DTexture( data, ...samples.toArray() );
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  // update user data
  volume.userData.image3D = image3D;
  volume.userData.data0 = data;
  volume.userData.texture = texture;
  volume.userData.samples = samples;
  volume.userData.voxelSize = voxelSize;
  volume.userData.size = size;

}

// mask

function setupMaskObject () { 

  mask = { userData: {} };

  mask.userData.data0 = new Uint8Array();
  mask.userData.texture = new THREE.Data3DTexture();
  mask.userData.samples = new THREE.Vector3();
  mask.userData.size = new THREE.Vector3();
  mask.userData.voxelSize = new THREE.Vector3();
  mask.userData.history = [];
  mask.userData.future = [];

}

function updateMask ( image3D ) { 

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
  mask.userData.image3D = image3D;
  mask.userData.data0 = image3D.getDataUint8();
  mask.userData.texture = texture;
  mask.userData.samples = samples;
  mask.userData.voxelSize = voxelSize;
  mask.userData.size = size;

}

function updateMaskTexture ( array, min, max ) {
 
  if ( array.length !== mask.userData.texture.image.data ) console.error('input array must be the same size as mask');

  const samples = mask.userData.samples;

  for ( let k = min.z; k <= max.z; k++ ) {
    const offsetK = samples.x * samples.y * k

    for ( let j = min.y; j <= max.y; j++ ) {
      const offsetJ = samples.x * j 

      for ( let i = min.x; i <= max.x; i++ ) {
        const n = i + offsetJ + offsetK;

        // update mask texture
        mask.userData.texture.image.data[n] = array[n];   

      }   
    }
  }
   
  mask.userData.texture.needsUpdate = true;

}

function updateMaskFromVolume () {
    
  const image3D = volume.userData.image3D.clone();
  image3D.resetData( 0 );
  image3D._metadata.statistics.min = 0;
  image3D._metadata.statistics.max = 0;

  const data = image3D.getDataUint8();
  const size = volume.userData.size.clone();
  const samples = volume.userData.samples.clone();
  const voxelSize = volume.userData.voxelSize.clone();

  const texture = new THREE.Data3DTexture( data, ...samples.toArray() );  
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  // update user data
  mask.userData.history = [];
  mask.userData.future = [];
  mask.userData.image3D = image3D;
  mask.userData.data0 = data;
  mask.userData.texture = texture;
  mask.userData.samples = samples;
  mask.userData.voxelSize = voxelSize;
  mask.userData.size = size;

}

function resetMask () {  

  for ( let i = 0; i < mask.userData.data0.length; i++ ) {

    mask.userData.texture.image.data[i] = mask.userData.data0[i];

  } 
  
  mask.userData.texture.needsUpdate = true;

  // update uniforms

  updateModelUniformsMask();
  updateScreenUniformsMask();

  computeModelBoundingBox();
  updateModelUniformsBox();

  updateDisplay();
}

function undoMask () {
  
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
    model.userData.box.copy( recordPrevious.box );

    updateModelUniformsBox();
    updateModelUniformsMask();
    updateScreenUniformsMask();

    updateModel();
    updateScreen();

  }
  
}

function redoMask () {
  
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
    model.userData.box.copy( recordNext.box );

    updateModelUniforms();
    updateScreenUniforms();

  }

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

  const length = 2 * volume.userData.size.length();
  const geometry = [0, 1, 2].map( (i) => new THREE.PlaneGeometry( length, length ) );
  const material = [0, 1, 2].map( (i) => new THREE.ShaderMaterial( {

    // shader parameters
    uniforms: {},
    vertexShader: vertexScreen,
    fragmentShader: fragmentScreen,
    glslVersion: THREE.GLSL3,

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

  screen.userData.planes = planes;
  screen.userData.monitors = monitors;  

  // add monitors
  screen.userData.monitors.forEach( (monitor, i) => {

    monitor.matrixAutoUpdate = false;
    monitor.updateMatrix();
    
    // in screen local coordinates
    const normal = new THREE.Vector3( 0, 0, 1 );
    monitor.userData.plane = new THREE.Plane( normal, 0 ).applyMatrix4( monitor.matrix );
    monitor.userData.plane0 = new THREE.Plane().copy( monitor.userData.plane );
    monitor.userData.index = i;

    screen.add( monitor );

  });

  setupScreenAxis();
  setupScreenCenter();

}

function setupScreenAxis () {

  screen.userData.monitors.forEach( (monitor, i) => {

    const direction = [ _xAxis, _yAxis, _zAxis][ i ].clone();
    const color = [ _red, _green, _blue][ i ].clone();
    const length = volume.userData.size.length();
    const origin = direction.clone().negate().multiplyScalar( 0.5 * length );
    const axis = new THREE.ArrowHelper( direction, origin, length, color );

    // axis user data
    axis.matrixAutoUpdate = false;
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

    const monitor = screen.userData.monitors[i];
    monitor.userData.plane.copy( monitor.userData.plane0 ).applyMatrix4( screen.matrix );

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

      axis.updateMatrix();

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


function resetScreen () {

  saveScreen( event );

  screen.position.copy( new THREE.Vector3() );
  screen.quaternion.copy( new THREE.Quaternion() );   
  screen.userData.monitors.forEach( (monitor) => {

    const uniforms = monitor.material.uniforms;
    uniforms.uPlaneVisible.value = true;

  });

  updateDisplay();
  
}

function saveScreen () {

  screen.updateMatrix();

  const record = { 

    matrix: screen.matrix.clone(),
    visible: screen.userData.monitors.map( (monitor) => monitor.material.uniforms.uPlaneVisible.value ),

  };

  screen.userData.history.unshift( record );

}

function undoScreen () {

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

function redoScreen () {
  
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

// model

function setupModel () {

  const size = new THREE.Vector3().copy( mask.userData.size );
  const geometry = new THREE.BoxGeometry( ...size.toArray() );
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,

    // // shader parameters
    uniforms: {},
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

  computeModelBoundingBox();

}
  
function updateModel () {
  
}

function computeModelBoundingBox () {
  
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

  projectBrushOnScreen();

}

function projectBrushOnScreen() {
 
  let intersections = intersectScreen( gestures.raycasters.view.ray );

  // filter invisible screen monitors and select the first monitor
  const selected = intersections.filter( (monitor) => monitor.object.material.uniforms.uPlaneVisible.value) [0];

  // copy intersection position to brush
  brush.userData.monitorIndex = undefined;

  if ( selected ) {

    brush.userData.monitorIndex = selected.object.userData.index;
    brush.userData.plane.copy( selected.object.userData.plane );
    brush.position.copy( display.worldToLocal( selected.point ) );
    brush.updateMatrix();    

    updateUI();

  }    

}

// selector2D


function setupSelector2D () {
  
  const boxSize = new THREE.Vector3( 1, 1, 1 );

  selector2D.clear();
  selector2D.geometry = new THREE.BoxGeometry( ...boxSize.toArray() );
  selector2D.material = new THREE.MeshBasicMaterial( { 
    color: 0x0055ff, 
    side: THREE.DoubleSide, 
    visible: false, 
    transparent: true,
    opacity: 0.1,
  });
 
  // setup selector objects

  selector2D.geometry.computeBoundingBox();
  selector2D.userData.pointLength = boxSize.length() * 0.04;
  selector2D.userData.pointScalar = 2;
  selector2D.userData.history = [];
  selector2D.userData.future = [];

  setupSelectorOutline2D();
  setupSelectorObb2D();
  setupSelectorVertices2D();
  setupSelectorFaces2D();

}

function setupSelectorOutline2D () {

  selector2D.userData.outline = new THREE.Box3Helper( selector2D.geometry.boundingBox, selector2D.material.color );
  selector2D.add( selector2D.userData.outline );  

}

function setupSelectorObb2D () {
  
  selector2D.userData.obb = new OBB().fromBox3( selector2D.geometry.boundingBox );
  selector2D.userData.obb0 = selector2D.userData.obb.clone();

}

function setupSelectorVertices2D () {
   
  const halfSize = new THREE.Vector3(
    selector2D.geometry.parameters.width,
    selector2D.geometry.parameters.height,
    selector2D.geometry.parameters.depth,
  ).divideScalar(2);

  const positions = [
    new THREE.Vector3(  halfSize.x,  halfSize.y,  halfSize.z ),
    new THREE.Vector3(  halfSize.x,  halfSize.y, -halfSize.z ),
    new THREE.Vector3(  halfSize.x, -halfSize.y,  halfSize.z ),
    new THREE.Vector3(  halfSize.x, -halfSize.y, -halfSize.z ),
    new THREE.Vector3( -halfSize.x,  halfSize.y,  halfSize.z ),
    new THREE.Vector3( -halfSize.x,  halfSize.y, -halfSize.z ),
    new THREE.Vector3( -halfSize.x, -halfSize.y,  halfSize.z ),
    new THREE.Vector3( -halfSize.x, -halfSize.y, -halfSize.z ),
  ]

  // add meshed to vertices

  const size = new THREE.Vector3().addScalar( selector2D.userData.pointLength );
  const radiusExpand = 2 * selector2D.userData.pointLength / 3 * selector2D.userData.pointScalar;
  const geometry = new THREE.BoxGeometry( ...size.toArray() );
  const material = new THREE.MeshBasicMaterial( { 

    color: 0x0055ff, 
    side: THREE.DoubleSide, 
    visible: true, 
    transparent: true,
    opacity: 0.5,
    depthTest: true,
    depthWrite: false,

  });
  
  selector2D.userData.vertices = new Array( positions.length ).fill();

  for ( let i = 0; i < positions.length; i++ ) {

    selector2D.userData.vertices[i] = new THREE.Mesh( geometry, material ); 
    selector2D.userData.vertices[i].position.copy( positions[i] );
    selector2D.userData.vertices[i].matrixAutoUpdate = false;
    selector2D.userData.vertices[i].renderOrder = selector2D.renderOrder - 0.5;

    selector2D.userData.vertices[i].userData.sphere = new THREE.Sphere( new THREE.Vector3(), radiusExpand );
    selector2D.userData.vertices[i].userData.sphere0 = selector2D.userData.vertices[i].userData.sphere.clone();

    selector2D.add( selector2D.userData.vertices[i] );

  }


}

function setupSelectorFaces2D () {

  const halfSize = new THREE.Vector3(
    selector2D.geometry.parameters.width,
    selector2D.geometry.parameters.height,
    selector2D.geometry.parameters.depth,
  ).divideScalar(2);

  const positions = [
    new THREE.Vector3(  halfSize.x, 0, 0 ),
    new THREE.Vector3( -halfSize.x, 0, 0 ),
    new THREE.Vector3( 0,  halfSize.y, 0 ),
    new THREE.Vector3( 0, -halfSize.y, 0 ),
    new THREE.Vector3( 0, 0,  halfSize.z ),
    new THREE.Vector3( 0, 0, -halfSize.z ),
  ]

  // add meshed to vertices

  const radius = 2 * selector2D.userData.pointLength / 3; 
  const radiusExpand = radius * selector2D.userData.pointScalar;
  const geometry = new THREE.SphereGeometry( radius );
  const material = new THREE.MeshBasicMaterial( { 

    color: 0xffff55, // 0x0055ff, 
    side: THREE.DoubleSide, 
    visible: true, 
    transparent: true,
    opacity: 0.5,
    depthTest: false,
    depthWrite: false,

  });
  
  selector2D.userData.faces = new Array( positions.length ).fill();

  for ( let i = 0; i < positions.length; i++ ) {

    selector2D.userData.faces[i] = new THREE.Mesh( geometry, material ); 
    selector2D.userData.faces[i].position.copy( positions[i] );
    selector2D.userData.faces[i].matrixAutoUpdate = false;
    selector2D.userData.faces[i].renderOrder = selector2D.renderOrder - 0.5;

    selector2D.userData.faces[i].userData.sphere = new THREE.Sphere( new THREE.Vector3(), radiusExpand );
    selector2D.userData.faces[i].userData.sphere0 = selector2D.userData.faces[i].userData.sphere.clone();

    selector2D.add( selector2D.userData.faces[i] );

  }

}

function updateSelector2D () {

  updateSelectorObb2D();
  updateSelectorVertices2D();
  updateSelectorFaces2D();

}

function updateSelectorObb2D () {

  selector2D.userData.obb.copy( selector2D.userData.obb0 ).applyMatrix4( selector2D.matrixWorld );

}

function updateSelectorVertices2D () {

  for ( let vertex, i = 0; i < selector2D.userData.vertices.length; i++ ) {

    vertex = selector2D.userData.vertices[i];

    vertex.scale.set( 1, 1, 1 ).divide( selector2D.scale ).multiplyScalar( (selector2D.scale.x + selector2D.scale.y + selector2D.scale.z) / 3 );
    vertex.updateMatrix();
    
    vertex.userData.sphere.copy( vertex.userData.sphere0 ).applyMatrix4( vertex.matrixWorld );

  }

}

function updateSelectorFaces2D () {

  for ( let face, i = 0; i < selector2D.userData.faces.length; i++ ) {

    face = selector2D.userData.faces[i];

    face.scale.set( 1, 1, 1 ).divide( selector2D.scale ).multiplyScalar( (selector2D.scale.x + selector2D.scale.y + selector2D.scale.z) / 3 );
    face.updateMatrix();
    
    face.userData.sphere.copy( face.userData.sphere0 ).applyMatrix4( face.matrixWorld );

  }

}

function intersectSelectorObb2D ( rayOrOrigin, direction ) {

  if ( rayOrOrigin instanceof THREE.Ray && direction === undefined ) {

    raycaster.set( rayOrOrigin.origin, rayOrOrigin.direction );

  } else {

    raycaster.set( rayOrOrigin, direction );

  }

  let intersections = raycaster.intersectObject( selector2D, false );

  // remove duplicates

  intersections = intersections.filter( (intersection0, i) => {

    return ! intersections.slice( i + 1 ).some( (intersection1) => Math.abs( intersection1.distance - intersection0.distance ) < 1e-6 );

  });

  return intersections;

}

function intersectSelectorVertices2D ( rayOrOrigin, direction ) {

  if ( rayOrOrigin instanceof THREE.Ray && direction === undefined ) {

    raycaster.set( rayOrOrigin.origin, rayOrOrigin.direction );

  } else {

    raycaster.set( rayOrOrigin, direction );

  }

  // get ray intersection with vertex sphere

  let indices = [];
  let points = [];  

  for ( let i = 0; i < selector2D.userData.vertices.length; i++ ) {

    let vertex = selector2D.userData.vertices[i];

    points.push( raycaster.ray.intersectSphere( vertex.userData.sphere, new THREE.Vector3() ) );

    indices.push( i );

  }

  // sort intersections based on distance from camera

  indices = indices.filter( (i) => points[i] instanceof THREE.Vector3 );

  let distance = [];

  for ( let i = 0; i < indices.length; i++ ) {
    
    let n = indices[i];

    distance.push( points[n].distanceTo( raycaster.ray.origin ) );

  }

  indices.sort( (i, j) => distance[i] - distance[j] );


  // create intersection object

  let intersections = [];

  for ( let i = 0; i < indices.length; i++ ) {

    let n = indices[i];

    intersections.push( {
  
      object: selector2D.userData.vertices[n],
      point: points[n],
      distance: distance[n],
  
    } );

  } 
 
  return intersections;

}

function intersectSelectorFaces2D ( rayOrOrigin, direction ) {

  if ( rayOrOrigin instanceof THREE.Ray && direction === undefined ) {

    raycaster.set( rayOrOrigin.origin, rayOrOrigin.direction );

  } else {

    raycaster.set( rayOrOrigin, direction );

  }

  // get ray intersection with vertex sphere

  let indices = [];
  let points = [];  

  for ( let i = 0; i < selector2D.userData.faces.length; i++ ) {

    let face = selector2D.userData.faces[i];

    points.push( raycaster.ray.intersectSphere( face.userData.sphere, new THREE.Vector3() ) );

    indices.push( i );

  }

  // sort intersections based on distance from camera

  indices = indices.filter( (i) => points[i] instanceof THREE.Vector3 );

  let distance = [];

  for ( let i = 0; i < indices.length; i++ ) {
    
    let n = indices[i];

    distance.push( points[n].distanceTo( raycaster.ray.origin ) );

  }

  indices.sort( (i, j) => distance[i] - distance[j] );

  
  // create intersection object

  let intersections = [];

  for ( let i = 0; i < indices.length; i++ ) {

    let n = indices[i];

    intersections.push( {
  
      object: selector2D.userData.faces[n],
      point: points[n],
      distance: distance[n],
  
    } );

  } 
 
  return intersections;

}

function intersectsSelector2D ( rayOrOrigin, direction ) {

  if ( intersectSelectorVertices2D( rayOrOrigin, direction ).length > 0 ) return 'vertex';
  if ( intersectSelectorFaces2D ( rayOrOrigin, direction ).length > 0 ) return 'face';
  if ( intersectSelectorObb2D ( rayOrOrigin, direction ).length > 0 ) return 'obb';

  return false;

}

function resetSelector2D () {

  saveSelector2D( event );

  selector2D.position.set( 0, 0, 0 );
  selector2D.scale.copy( volume.userData.size );
  selector2D.updateMatrix();

  updateSelector2D();  
  
}

function saveSelector2D () {

  selector2D.updateMatrix();

  const record = { 
    matrix: selector2D.matrix.clone(),
  };

  selector2D.userData.history.unshift( record );

}

function undoSelector2D () {

  selector2D.updateMatrix();

  const record = { matrix: selector2D.matrix.clone() };

  selector2D.userData.future.unshift( record );

  if ( selector2D.userData.history.length > 0) {

    selector2D.matrix.copy( selector2D.userData.history.shift().matrix );
    selector2D.matrix.decompose( selector2D.position, selector2D.quaternion, selector2D.scale ); 

    updateSelector2D();

  }
  
}

function redoSelector2D () {

  selector2D.updateMatrix();

  const record = { matrix: selector2D.matrix.clone() };
  selector2D.userData.history.unshift( record );

  if ( selector2D.userData.future.length > 0) {

    selector2D.matrix.copy( selector2D.userData.future.shift().matrix );
    selector2D.matrix.decompose( selector2D.position, selector2D.quaternion, selector2D.scale ); 

    updateSelector3D();

  }

}

// selector3D

function setupSelector3D () {
  
  selector3D.clear();

  const boxSize = new THREE.Vector3( 1, 1, 1 );
  selector3D.geometry = new THREE.BoxGeometry( ...boxSize.toArray() );
  selector3D.material = new THREE.MeshBasicMaterial( { 
    color: 0x0055ff, 
    side: THREE.DoubleSide, 
    visible: true, 
    transparent: true,
    opacity: 0.1,
  });
 
  // setup selector objects

  selector3D.geometry.computeBoundingBox();
  selector3D.userData.pointLength = boxSize.length() * 0.04;
  selector3D.userData.pointScalar = 2;
  selector3D.userData.history = [];
  selector3D.userData.future = [];

  setupSelectorOutline3D();
  setupSelectorObb3D();
  setupSelectorVertices3D();
  setupSelectorFaces3D();

  // update selector scale size

  selector3D.scale.copy( volume.userData.size );
  selector3D.updateMatrix();

}

function setupSelectorOutline3D () {

  selector3D.userData.outline = new THREE.Box3Helper( selector3D.geometry.boundingBox, selector3D.material.color );
  selector3D.add( selector3D.userData.outline );  

}

function setupSelectorObb3D () {
  
  selector3D.userData.obb = new OBB().fromBox3( selector3D.geometry.boundingBox );
  selector3D.userData.obb0 = selector3D.userData.obb.clone();

}

function setupSelectorVertices3D () {
   
  const halfSize = new THREE.Vector3(
    selector3D.geometry.parameters.width,
    selector3D.geometry.parameters.height,
    selector3D.geometry.parameters.depth,
  ).divideScalar(2);

  const positions = [
    new THREE.Vector3(  halfSize.x,  halfSize.y,  halfSize.z ),
    new THREE.Vector3(  halfSize.x,  halfSize.y, -halfSize.z ),
    new THREE.Vector3(  halfSize.x, -halfSize.y,  halfSize.z ),
    new THREE.Vector3(  halfSize.x, -halfSize.y, -halfSize.z ),
    new THREE.Vector3( -halfSize.x,  halfSize.y,  halfSize.z ),
    new THREE.Vector3( -halfSize.x,  halfSize.y, -halfSize.z ),
    new THREE.Vector3( -halfSize.x, -halfSize.y,  halfSize.z ),
    new THREE.Vector3( -halfSize.x, -halfSize.y, -halfSize.z ),
  ]

  // add meshed to vertices

  const size = new THREE.Vector3().addScalar( selector3D.userData.pointLength );
  const radiusExpand = 2 * selector3D.userData.pointLength / 3 * selector3D.userData.pointScalar;
  const geometry = new THREE.BoxGeometry( ...size.toArray() );
  const material = new THREE.MeshBasicMaterial( { 

    color: 0x0055ff, 
    side: THREE.DoubleSide, 
    visible: true, 
    transparent: true,
    opacity: 0.5,
    depthTest: true,
    depthWrite: false,

  });
  
  selector3D.userData.vertices = new Array( positions.length ).fill();

  for ( let i = 0; i < positions.length; i++ ) {

    selector3D.userData.vertices[i] = new THREE.Mesh( geometry, material ); 
    selector3D.userData.vertices[i].position.copy( positions[i] );
    selector3D.userData.vertices[i].matrixAutoUpdate = false;
    selector3D.userData.vertices[i].renderOrder = selector3D.renderOrder - 0.5;

    selector3D.userData.vertices[i].userData.sphere = new THREE.Sphere( new THREE.Vector3(), radiusExpand );
    selector3D.userData.vertices[i].userData.sphere0 = selector3D.userData.vertices[i].userData.sphere.clone();

    selector3D.add( selector3D.userData.vertices[i] );

  }


}

function setupSelectorFaces3D () {

  const halfSize = new THREE.Vector3(
    selector3D.geometry.parameters.width,
    selector3D.geometry.parameters.height,
    selector3D.geometry.parameters.depth,
  ).divideScalar(2);

  const positions = [
    new THREE.Vector3(  halfSize.x, 0, 0 ),
    new THREE.Vector3( -halfSize.x, 0, 0 ),
    new THREE.Vector3( 0,  halfSize.y, 0 ),
    new THREE.Vector3( 0, -halfSize.y, 0 ),
    new THREE.Vector3( 0, 0,  halfSize.z ),
    new THREE.Vector3( 0, 0, -halfSize.z ),
  ]

  // add meshed to vertices

  const radius = 2 * selector3D.userData.pointLength / 3; 
  const radiusExpand = radius * selector3D.userData.pointScalar;
  const geometry = new THREE.SphereGeometry( radius );
  const material = new THREE.MeshBasicMaterial( { 

    color: 0xffff55, // 0x0055ff, 
    side: THREE.DoubleSide, 
    visible: true, 
    transparent: true,
    opacity: 0.5,
    depthTest: false,
    depthWrite: false,

  });
  
  selector3D.userData.faces = new Array( positions.length ).fill();

  for ( let i = 0; i < positions.length; i++ ) {

    selector3D.userData.faces[i] = new THREE.Mesh( geometry, material ); 
    selector3D.userData.faces[i].position.copy( positions[i] );
    selector3D.userData.faces[i].matrixAutoUpdate = false;
    selector3D.userData.faces[i].renderOrder = selector3D.renderOrder - 0.5;

    selector3D.userData.faces[i].userData.sphere = new THREE.Sphere( new THREE.Vector3(), radiusExpand );
    selector3D.userData.faces[i].userData.sphere0 = selector3D.userData.faces[i].userData.sphere.clone();

    selector3D.add( selector3D.userData.faces[i] );

  }

}

function updateSelector3D () {

  updateSelectorObb3D();
  updateSelectorVertices3D();
  updateSelectorFaces3D();

}

function updateSelectorObb3D () {

  selector3D.userData.obb.copy( selector3D.userData.obb0 ).applyMatrix4( selector3D.matrixWorld );

}

function updateSelectorVertices3D () {

  for ( let vertex, i = 0; i < selector3D.userData.vertices.length; i++ ) {

    vertex = selector3D.userData.vertices[i];

    vertex.scale.set( 1, 1, 1 ).divide( selector3D.scale ).multiplyScalar( (selector3D.scale.x + selector3D.scale.y + selector3D.scale.z) / 3 );
    vertex.updateMatrix();
    
    vertex.userData.sphere.copy( vertex.userData.sphere0 ).applyMatrix4( vertex.matrixWorld );

  }

}

function updateSelectorFaces3D () {

  for ( let face, i = 0; i < selector3D.userData.faces.length; i++ ) {

    face = selector3D.userData.faces[i];

    face.scale.set( 1, 1, 1 ).divide( selector3D.scale ).multiplyScalar( (selector3D.scale.x + selector3D.scale.y + selector3D.scale.z) / 3 );
    face.updateMatrix();
    
    face.userData.sphere.copy( face.userData.sphere0 ).applyMatrix4( face.matrixWorld );

  }

}

function intersectSelectorObb3D ( rayOrOrigin, direction ) {

  if ( rayOrOrigin instanceof THREE.Ray && direction === undefined ) {

    raycaster.set( rayOrOrigin.origin, rayOrOrigin.direction );

  } else {

    raycaster.set( rayOrOrigin, direction );

  }

  let intersections = raycaster.intersectObject( selector3D, false );

  // remove duplicates

  intersections = intersections.filter( (intersection0, i) => {

    return ! intersections.slice( i + 1 ).some( (intersection1) => Math.abs( intersection1.distance - intersection0.distance ) < 1e-6 );

  });

  return intersections;

}

function intersectSelectorVertices3D ( rayOrOrigin, direction ) {

  if ( rayOrOrigin instanceof THREE.Ray && direction === undefined ) {

    raycaster.set( rayOrOrigin.origin, rayOrOrigin.direction );

  } else {

    raycaster.set( rayOrOrigin, direction );

  }

  // get ray intersection with vertex sphere

  let indices = [];
  let points = [];  

  for ( let i = 0; i < selector3D.userData.vertices.length; i++ ) {

    let vertex = selector3D.userData.vertices[i];

    points.push( raycaster.ray.intersectSphere( vertex.userData.sphere, new THREE.Vector3() ) );

    indices.push( i );

  }

  // sort intersections based on distance from camera

  indices = indices.filter( (i) => points[i] instanceof THREE.Vector3 );

  let distance = [];

  for ( let i = 0; i < indices.length; i++ ) {
    
    let n = indices[i];

    distance.push( points[n].distanceTo( raycaster.ray.origin ) );

  }

  indices.sort( (i, j) => distance[i] - distance[j] );


  // create intersection object

  let intersections = [];

  for ( let i = 0; i < indices.length; i++ ) {

    let n = indices[i];

    intersections.push( {
  
      object: selector3D.userData.vertices[n],
      point: points[n],
      distance: distance[n],
  
    } );

  } 
 
  return intersections;

}

function intersectSelectorFaces3D ( rayOrOrigin, direction ) {

  if ( rayOrOrigin instanceof THREE.Ray && direction === undefined ) {

    raycaster.set( rayOrOrigin.origin, rayOrOrigin.direction );

  } else {

    raycaster.set( rayOrOrigin, direction );

  }

  // get ray intersection with vertex sphere

  let indices = [];
  let points = [];  

  for ( let i = 0; i < selector3D.userData.faces.length; i++ ) {

    let face = selector3D.userData.faces[i];

    points.push( raycaster.ray.intersectSphere( face.userData.sphere, new THREE.Vector3() ) );

    indices.push( i );

  }

  // sort intersections based on distance from camera

  indices = indices.filter( (i) => points[i] instanceof THREE.Vector3 );

  let distance = [];

  for ( let i = 0; i < indices.length; i++ ) {
    
    let n = indices[i];

    distance.push( points[n].distanceTo( raycaster.ray.origin ) );

  }

  indices.sort( (i, j) => distance[i] - distance[j] );

  
  // create intersection object

  let intersections = [];

  for ( let i = 0; i < indices.length; i++ ) {

    let n = indices[i];

    intersections.push( {
  
      object: selector3D.userData.faces[n],
      point: points[n],
      distance: distance[n],
  
    } );

  } 
 
  return intersections;

}

function intersectsSelector3D ( rayOrOrigin, direction ) {

  if ( intersectSelectorVertices3D( rayOrOrigin, direction ).length > 0 ) return 'vertex';
  if ( intersectSelectorFaces3D ( rayOrOrigin, direction ).length > 0 ) return 'face';
  if ( intersectSelectorObb3D ( rayOrOrigin, direction ).length > 0 ) return 'obb';

  return false;

}

function resetSelector3D () {

  saveSelector3D( event );

  selector3D.position.set( 0, 0, 0 );
  selector3D.scale.copy( volume.userData.size );
  selector3D.updateMatrix();

  updateSelector3D();  
  
}

function saveSelector3D () {

  selector3D.updateMatrix();

  const record = { 
    matrix: selector3D.matrix.clone(),
  };

  selector3D.userData.history.unshift( record );

}

function undoSelector3D () {

  selector3D.updateMatrix();

  const record = { matrix: selector3D.matrix.clone() };

  selector3D.userData.future.unshift( record );

  if ( selector3D.userData.history.length > 0) {

    selector3D.matrix.copy( selector3D.userData.history.shift().matrix );
    selector3D.matrix.decompose( selector3D.position, selector3D.quaternion, selector3D.scale ); 

    updateSelector3D();

  }
  
}

function redoSelector3D () {

  selector3D.updateMatrix();

  const record = { matrix: selector3D.matrix.clone() };
  selector3D.userData.history.unshift( record );

  if ( selector3D.userData.future.length > 0) {

    selector3D.matrix.copy( selector3D.userData.future.shift().matrix );
    selector3D.matrix.decompose( selector3D.position, selector3D.quaternion, selector3D.scale ); 

    updateSelector3D();

  }

}
 
// global uniforms

function setupGlobalUniforms () {

  display.userData.uNormalize = new THREE.Matrix4();
  display.userData.uDeNormalize = new THREE.Matrix4();
  display.userData.uMatrix = new THREE.Matrix4();
  display.userData.uCameraPosition = new THREE.Vector3();
  display.userData.uPlaneHessian = new Array(3).fill().map( (i) => new THREE.Vector4() );
  display.userData.uPlaneNormal = new Array(3).fill().map( (i) => new THREE.Vector3() );
  display.userData.uPlaneOrigin = new THREE.Vector3(); 

}

function updateGlobalUniforms () {

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

// screen uniforms

function setupScreenUniforms() {

  setupScreenUniformsGeneric();
  setupScreenUniformsVolume();
  setupScreenUniformsMask();
  setupScreenUniformsPlanes();
  setupScreenUniformsBrush();
  setupScreenUniformsSelector();

}

function setupScreenUniformsGeneric() {

  screen.userData.monitors.forEach( (monitor) => {

    monitor.material.needsUpdate = true;
    const uniforms = monitor.material.uniforms;

    // static 
    uniforms.uBrightness = { value: 0.0 };
    uniforms.uContrast = { value: 1.2 };

    // dynamic
    uniforms.uNormalize = { value: new THREE.Matrix4() };

  });

}

function setupScreenUniformsVolume() {

  screen.userData.monitors.forEach( (monitor) => {

    monitor.material.needsUpdate = true;
    const uniforms = monitor.material.uniforms;

    // static 
    uniforms.uVolumeSize = { value: volume.userData.size };

    // dynamic
    uniforms.uVolumeMap = { value:  volume.userData.texture };


  });

}

function setupScreenUniformsMask () {

  screen.userData.monitors.forEach( (monitor) => {

    monitor.material.needsUpdate = true;
    const uniforms = monitor.material.uniforms;

    // static
    uniforms.uMaskSize = { value: mask.userData.size };

    // dynamic
    uniforms.uMaskMap = { value: mask.userData.texture };


  });
}

function setupScreenUniformsPlanes() {

  screen.userData.monitors.forEach( (monitor, i) => {

    const uniforms = monitor.material.uniforms;

    // static
    uniforms.uPlaneIndex = { value: i };

    // dynamic
    uniforms.uPlaneNormal = { value: [0,1,2].map( (i) => new THREE.Vector3() ) };
    uniforms.uPlaneOrigin = { value: new THREE.Vector3() };
    uniforms.uPlaneVisible = { value: true };
    uniforms.uPlaneAlpha = { value: 1.0 };

  } );
    

}

function setupScreenUniformsSelector() {

  screen.userData.monitors.forEach( (monitor) => {

    const uniforms = monitor.material.uniforms;

    // static
    uniforms.uSelectorColor = { value:  selector3D.material.color };
    uniforms.uSelectorOpacity = { value: selector3D.material.opacity };

    // dynamic
    uniforms.uSelectorVisible = { value : false };
    uniforms.uSelectorSize = { value: new THREE.Vector3() };
    uniforms.uSelectorCenter = { value: new THREE.Vector3() };

  } );

}

function setupScreenUniformsBrush () {
  
  screen.userData.monitors.forEach( (monitor) => {

    const uniforms = monitor.material.uniforms;

    // dynamic
    uniforms.uBrushVisible = { value: false };
    uniforms.uBrushColor = { value: new THREE.Vector3() };
    uniforms.uBrushRadius = { value: 0 };
    uniforms.uBrushCenter = { value: new THREE.Vector3() };
    
  } );
   
}

function updateScreenUniforms() {

  updateScreenUniformsGeneric();
  updateScreenUniformsMask();
  updateScreenUniformsPlanes();
  updateScreenUniformsBrush();
  updateScreenUniformsSelector();

}

function updateScreenUniformsGeneric() {

  screen.userData.monitors.forEach( (monitor) => {

    const uniforms = monitor.material.uniforms;

    uniforms.uNormalize.value.copy( display.userData.uNormalize );
  
  });

}

function updateScreenUniformsMask() {

  screen.userData.monitors.forEach( (monitor) => {

    monitor.material.needsUpdate = true;
    const uniforms = monitor.material.uniforms;

    uniforms.uMaskMap.value = mask.userData.texture;
   
  });

}

function updateScreenUniformsSelector() {

  screen.userData.monitors.forEach( (monitor) => {

    const uniforms = monitor.material.uniforms;

    uniforms.uSelectorVisible.value = selector3D.visible;
    uniforms.uSelectorSize.value.copy( selector3D.scale ).divide( volume.userData.size );
    uniforms.uSelectorCenter.value.copy( selector3D.position ).divide( volume.userData.size );
   
  });

}

function updateScreenUniformsBrush() {

  screen.userData.monitors.forEach( (monitor) => {

    const uniforms = monitor.material.uniforms;

    uniforms.uBrushVisible.value = brush.visible;
    uniforms.uBrushColor.value.setFromColor( brush.material.color );
    uniforms.uBrushRadius.value = brush.userData.sphere.radius * display.getWorldScale( _scale ).x;
    brush.getWorldPosition( uniforms.uBrushCenter.value );

  });

}

function updateScreenUniformsPlanes() {
  
  // update monitors
  screen.userData.monitors.forEach( (monitor, i) => {

    const uniforms = monitor.material.uniforms;

    // dynamic
    uniforms.uPlaneNormal.value.forEach( (value, i) => value.copy( display.userData.uPlaneNormal[i] ));
    uniforms.uPlaneOrigin.value.copy( display.userData.uPlaneOrigin );  

  });
}

// model uniforms

function setupModelUniforms() {

  setupModelUniformsGeneric();
  setupModelUniformsMask();
  setupModelUniformsPlanes();
  setupModelUniformsBox();

}

function setupModelUniformsGeneric() {

  const uniforms = model.material.uniforms;

  // static
  uniforms.uModelAlpha = { value: 1.0 };
  uniforms.uModelAlphaClip = { value: 1.0 };

  // dynamic
  uniforms.uNormalize = { value: new THREE.Matrix4() };
  uniforms.uDeNormalize = { value: new THREE.Matrix4() };
  uniforms.uMatrix = { value: new THREE.Matrix4() };
  uniforms.uCameraPosition = { value: new THREE.Vector3() };

}

function setupModelUniformsMask () {

  model.material.needsUpdate = true;
  const uniforms = model.material.uniforms;

  // static
  uniforms.uMaskSize = { value: mask.userData.size };
  uniforms.uMaskSamples = { value: mask.userData.samples };
  uniforms.uMaskVoxelSize = { value: mask.userData.voxelSize };
  uniforms.uMaskTexelSize = { value: mapVector( mask.userData.samples, (x) => 1/x ) };
  uniforms.uMaskResolution = { value: uniforms.uMaskTexelSize.value.length() };

  // dynamic
  uniforms.uMaskMap = { value: mask.userData.texture };  
 
};

function setupModelUniformsBox() {

  model.material.needsUpdate = true;
  const uniforms = model.material.uniforms;

  // dynamic
  uniforms.uBoxMin = { value: new THREE.Vector3().addScalar( -0.5 ) };
  uniforms.uBoxMax = { value: new THREE.Vector3().addScalar( +0.5 ) };

}

function setupModelUniformsPlanes() {

  const uniforms = model.material.uniforms;

  // dynamic
  uniforms.uPlaneHessian = { value: [0, 1, 2].map( (i) => new THREE.Vector4() ) };
  uniforms.uPlaneVisible = { value: [0, 1, 2].map( (i) => true ) };
  uniforms.uPlaneAlpha = { value: [0, 1, 2].map( (i) => 1.0 ) };

}

function updateModelUniforms() {

  updateModelUniformsGeneric();
  updateModelUniformsMask();
  updateModelUniformsPlanes();
  updateModelUniformsBox();

}

function updateModelUniformsGeneric() {

  const uniforms = model.material.uniforms;

  uniforms.uNormalize.value.copy( display.userData.uNormalize );
  uniforms.uDeNormalize.value.copy( display.userData.uDeNormalize );
  uniforms.uCameraPosition.value.copy( display.userData.uCameraPosition ); 
  uniforms.uMatrix.value.copy( display.userData.uMatrix );

}

function updateModelUniformsPlanes() {

  const uniforms = model.material.uniforms;

  uniforms.uPlaneHessian.value.forEach( (value, i) => value.copy( display.userData.uPlaneHessian[i] ));
  uniforms.uPlaneVisible.value.forEach( (_, i, array) => array[i] = screen.userData.monitors[i].material.uniforms.uPlaneVisible.value );
  uniforms.uPlaneAlpha.value.forEach( (_, i, array) => array[i] = screen.userData.monitors[i].material.uniforms.uPlaneAlpha.value );   

}

function updateModelUniformsMask () {

  model.material.needsUpdate = true;
  const uniforms = model.material.uniforms;

  uniforms.uMaskMap.value = mask.userData.texture;  

}

function updateModelUniformsBox () {

  model.material.needsUpdate = true;
  const uniforms = model.material.uniforms;

  uniforms.uBoxMin.value.copy( model.userData.box.min ).divide( mask.userData.size ); 
  uniforms.uBoxMax.value.copy( model.userData.box.max ).divide( mask.userData.size );

}

// events

function onVolumeUpload ( event ) {
  
  loadNIFTI( event.target.files[0] ).then( (image3D) => {

    updateVolume( image3D );  
    if ( ! mask.userData.image3D ) updateMaskFromVolume();
    
    setupScreen();
    setupModel();
    setupContainer(); 
    setupSelector3D();
    setupScreenUniforms();
    setupModelUniforms();

    updateScreenUniforms(); 
    updateModelUniforms();
    updateDisplay();
    updateUI();

    display.visible = true;

  });
}

function onMaskUpload ( event ) {

  loadNIFTI( event.target.files[0] ).then( (image3D) => {

    updateMask( image3D );
    if ( ! volume.userData.image3D ) updateVolumeFromMask();

    setupScreen();
    setupModel();
    setupContainer(); 
    setupSelector3D();
    setupScreenUniforms();
    setupModelUniforms();

    updateScreenUniforms(); 
    updateModelUniforms();
    updateDisplay();
    updateUI();

    display.visible = true;

  });

  loadRawNIFTI( event.target.files[0] ).then( (raw) => {

    mask.userData.raw = raw;
    
  });

}

function onMaskDownload ( event) {

  const header = mask.userData.raw.slice( 0, 352 );
  const headerTemp = new Uint16Array( header, 0, header.length );
  headerTemp[35] = 2; // convert data type to UInt8

  const image = mask.userData.texture.image.data;
  const data = [ headerTemp, new Uint16Array( image.buffer, 0, image.buffer.length ) ];
  const fileName = "mask.nii";

  saveData( data, fileName );

}
  
function onResize () {

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize( window.innerWidth, window.innerHeight );

}

function onButton ( event ) {

  display.visible = false;
  display.position.set( 0, 0, 0 );

  renderer.xr.enabled = true; 

  reticle.userData.enabled = true;

  hitTestSourceRequested = false;
  hitTestSource = null;

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

  reticle.visible = false;
  reticle.userData.enabled = false;

  camera.position.set( 1, 0.6, 1 );   

  display.position.copy( volume.userData.size ).divideScalar( 2 );
  display.userData.modes = [ 'Place', 'Inspect', 'Edit', 'Segment' ];

  updateDisplay();

}

// gestures
  
function onPolytap ( event ) {

  // console.log(`polyTap ${event.numTaps}: ${display.userData.modes[0]}`);

  if ( event.numTaps === 1 ) {

    if ( display.userData.modes[0] === 'Place' ) ;
    if ( display.userData.modes[0] === 'Inspect' ) ;
    if ( display.userData.modes[0] === 'Edit' ) ;
    if ( display.userData.modes[0] === 'Segment2D' ) ;
    if ( display.userData.modes[0] === 'Segment3D' ) ;

  }
  if ( event.numTaps === 2 ) {
        
    if ( display.userData.modes[0] === 'Place' ) onGesturePlaceDisplay( event );
    if ( display.userData.modes[0] === 'Inspect' ) onGestureHideScreenMonitor( event );
    if ( display.userData.modes[0] === 'Edit' ) onGestureToggleBrush( event );
    if ( display.userData.modes[0] === 'Segment2D' ) ;
    if ( display.userData.modes[0] === 'Segment3D' ) onGestureUpdateSegmentation3D( event );

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
    if ( display.userData.modes[0] === 'Segment2D' ) ;
    if ( display.userData.modes[0] === 'Segment3D' ) undoSelector3D( event );


  }

  if ( event.direction === 'UP'  ) {

    if ( display.userData.modes[0] === 'Place'   ) redoDisplay( event );
    if ( display.userData.modes[0] === 'Inspect' ) redoScreen( event );
    if ( display.userData.modes[0] === 'Edit'    ) redoMask( event );
    if ( display.userData.modes[0] === 'Segment2D' ) ;
    if ( display.userData.modes[0] === 'Segment3D' ) redoSelector3D( event );
    
  }

}

function onHold ( event ) {

  // console.log(`hold: ${display.userData.modes[0]}`);

  if ( display.userData.modes[0] === 'Place'   ) onGestureMoveDisplay( event );
  if ( display.userData.modes[0] === 'Inspect' ) {

    if ( event.start ) event.userData.flag = intersectsScreenCenter( gestures.raycasters.hand[0].ray );
      
    switch ( event.userData.flag ) {

      case true  : onGestureMoveScreen       ( event ); break;
      case false : onGestureMoveScreenMonitor( event ); break;

    }

  }
  if ( display.userData.modes[0] === 'Edit'    ) onGestureEditMask( event );
  if ( display.userData.modes[0] === 'Segment2D' ) ;
  if ( display.userData.modes[0] === 'Segment3D' ) {

    if ( event.start ) event.userData.flag = intersectsSelector3D( gestures.raycasters.hand[0].ray );

    switch ( event.userData.flag ) {

      case 'vertex' : onGestureMoveSelectorVertex3D( event ); break;
      case 'face'   : onGestureMoveSelectorFace3D  ( event ); break;
      case 'obb'    : onGestureMoveSelector3D      ( event ); break;

    }

  }

}

function onPan ( event ) {

  // console.log(`pan: ${display.userData.modes[0]}`);

  if ( display.userData.modes[0] === 'Place'   ) onGestureRotateDisplay( event );
  if ( display.userData.modes[0] === 'Inspect' ) onGestureRotateScreenMonitor( event );
  if ( display.userData.modes[0] === 'Edit'    ) onGestureRotateDisplay( event );
  if ( display.userData.modes[0] === 'Segment2D' ) ;
  if ( display.userData.modes[0] === 'Segment3D' ) onGestureRotateDisplay( event );

}
  
function onPinch ( event ) {

  // console.log(`pinch: ${display.userData.modes[0]}`);

  if ( display.userData.modes[0] === 'Place'   ) onGestureResizeDisplay ( event );
  if ( display.userData.modes[0] === 'Inspect' ) onGestureResizeDisplay ( event );
  if ( display.userData.modes[0] === 'Edit'    ) onGestureResizeBrush   ( event );
  if ( display.userData.modes[0] === 'Segment2D' ) ;
  if ( display.userData.modes[0] === 'Segment3D' ) onGestureResizeSelector3D( event );

} 

function onTwist ( event ) {

  // console.log(`twist: ${display.userData.modes[0]}`);

  if ( display.userData.modes[0] === 'Place') onGestureRollDisplay( event );
  if ( display.userData.modes[0] === 'Inspect') onGestureRollScreen( event );
  if ( display.userData.modes[0] === 'Edit') onGestureContrastScreen( event );
  if ( display.userData.modes[0] === 'Segment2D' ) ;
  if ( display.userData.modes[0] === 'Segment3D' ) onGestureRollDisplay( event );

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
  if ( display.userData.modes[0] === 'Segment2D' ) ;
  if ( display.userData.modes[0] === 'Segment3D' ) resetSelector3D( event );

}

// general gesture actions

function onGestureAttachObject ( event, object ) {
  
  let data = event.userData.cache = event.userData.cache ?? {};

  if ( event.start ){
    
    data.object = new THREE.Object3D();

    object.matrixWorld.decompose( data.object.position, data.object.quaternion, data.object.scale )
    data.object.updateMatrixWorld( true );

    gestures.controller[0].attach( data.object ); 

  } 

  if ( event.current ) {

    data.object.updateMatrixWorld( true );

    _matrix4.copy( object.parent.matrixWorld ).invert();
    _matrix4.multiply( data.object.matrixWorld );
    _matrix4.decompose( object.position, object.quaternion, object.scale );

    object.updateMatrix();
    
  } 
  
  if ( event.end ) {

    gestures.controller[0].remove( data.object ); 

    data = {};

  } 

}

function onGestureResizeObject ( event, object ) {

  let data = event.userData.cache = event.userData.cache ?? {};

  if ( event.start ) {
  
    data.scale0 = object.scale.clone();    
    data.scalar = 1;

  } 

  if ( event.current ) {

    data.scalar = gestures.parametersDual.distance / gestures.parametersDual.distance0;
    data.scalar = data.scalar ** 1.5;

    object.scale.copy( data.scale0 );
    object.scale.multiplyScalar( data.scalar );
    
  } 
  
  if ( event.end ) { 
    
    data = {};

  }

}

function onGestureTranslateObject ( event, object ) {
  
  let data = event.userData.cache = event.userData.cache ?? {};

  if ( event.start ){

    data.point = new THREE.Points();

    object.getWorldPosition( data.point.position );

    gestures.controller[0].attach( data.point ); 

  } 

  if ( event.current ) {

    data.point.getWorldPosition( object.position );

    object.parent.worldToLocal( object.position );
    object.updateMatrix();

  } 
  
  if ( event.end ) {

    gestures.controller[0].remove( data.point ); 

    data = {};

  } 

}

function onGestureRollObject ( event, object ) {
  
  let data = event.userData.cache = event.userData.cache ?? {};

  if ( event.start ){

    data.angle = 0;
    data.scalar = 1.2;

    data.axis = new THREE.Vector3();
    data.quaternion0 = object.quaternion.clone();

  } 

  if ( event.current ) {
  
    data.angle = gestures.parametersDual.angleOffset * Math.PI / 180;
    data.angle = - data.scalar * data.angle; 

    data.axis.copy( gestures.raycasters.view.ray.direction );

    object.quaternion.copy( data.quaternion0 )
    object.rotateOnWorldAxis( data.axis, data.angle );

  } 
  
  if ( event.end ) {

    data = {};

  } 

}

function onGestureTurnObject ( event, object ) {

  let data = event.userData.cache = event.userData.cache ?? {};

  if ( event.start ) {

    data.angle = 0;  // rad
    data.scalar = Math.PI / 60.0; // rad/mm

    data.axis = new THREE.Vector3();
    data.xAxis = new THREE.Vector3();
    data.yAxis = new THREE.Vector3();

    data.quaternion0 = object.quaternion.clone();

  } 

  if ( event.current ) {

    _vector2.copy( gestures.parameters[0].pointerOffset );

    data.angle = data.scalar * _vector2.length();

    data.yAxis.copy( _yAxis );
    data.xAxis.copy( _xAxis ).negate().transformDirection( camera.matrixWorld );

    data.axis.set( 0, 0, 0 );
    data.axis.addScaledVector( data.yAxis, _vector2.x );
    data.axis.addScaledVector( data.xAxis, _vector2.y );
    data.axis.normalize();

    object.quaternion.copy( data.quaternion0 );
    object.rotateOnWorldAxis( data.axis, data.angle );

  } 
  
  if ( event.end ) {
    
    data = {}; 

  }

}

function onGestureTranslateObjectOnWorldAxis ( event, object, axis ) {
  
  let data = event.userData.cache = event.userData.cache ?? {};

  if ( event.start ) {

    data.intersection = gestures.raycasters.hand[0].intersectObject( object, false )[0];

  }

  if ( event.start && data.intersection ) {

    object.parent.updateMatrixWorld( true );

    data.matrices = {
      w: new THREE.Matrix3().setFromMatrix4( object.parent.matrixWorld ).invert(),
    }

    data.points = {
      p: new THREE.Vector3().copy( data.intersection.point ),
      q: new THREE.Vector3(),
    }

    data.vectors = {
      t: new THREE.Vector3(),
    }

    data.shapes = {
      plane: new THREE.Plane(),
    }

    data.object = {
      p0: new THREE.Vector3().copy( object.position ),
    }

    data.shapes.plane.normal.copy( gestures.raycasters.view.ray.direction ).projectOnPlane( axis ).normalize();
    data.shapes.plane.setFromNormalAndCoplanarPoint( data.shapes.plane.normal, data.points.p );

  }

  if ( event.current && data.intersection ) {

    data.shapes.plane.normal.copy( gestures.raycasters.view.ray.direction ).projectOnPlane( axis ).normalize();

    gestures.raycasters.hand[0].ray.intersectPlane( data.shapes.plane, data.points.q );

    data.vectors.t.subVectors( data.points.q, data.points.p ).projectOnVector( axis ).applyMatrix3( data.matrices.w );

    object.position.copy( data.object.p0 ).add( data.vectors.t );
    object.updateMatrix();

  }

  if ( event.end ) {
    
    data = {};

  }

}

function onGestureRotateObjectOnWorldPivot ( event, object, point, direction ) {

  let data = event.userData.cache = event.userData.cache ?? {};
    
  if ( event.start ) {

    data.intersection = gestures.raycasters.hand[0].intersectObject( object, false )[0];

  }

  if ( event.start && data.intersection ) {

    object.parent.updateMatrixWorld( true );

    data.matrices = {
      w: new THREE.Matrix3().setFromMatrix4( object.parent.matrixWorld ).invert(),
    }

    data.points = {
      p: new THREE.Vector3().copy( data.intersection.point ),
      q: new THREE.Vector3(),
    }

    data.vectors = {
      t: new THREE.Vector3(),
    }

    data.shapes = {
      plane: new THREE.Plane(),
    }

    data.object = {
      p0: new THREE.Vector3().copy( object.position ),
    }

    data.shapes.plane.normal.copy( gestures.raycasters.view.ray.direction ).projectOnPlane( axis ).normalize();
    data.shapes.plane.setFromNormalAndCoplanarPoint( data.shapes.plane.normal, data.points.p );

  }

  if ( event.current && data.intersection ) {

    data.shapes.plane.normal.copy( gestures.raycasters.view.ray.direction ).projectOnPlane( axis ).normalize();

    gestures.raycasters.hand[0].ray.intersectPlane( data.shapes.plane, data.points.q );

    data.vectors.t.subVectors( data.points.q, data.points.p ).projectOnVector( axis ).applyMatrix3( data.matrices.m );

    object.position.copy( data.object.p0 ).add( data.vectors.t );

  }

  if ( event.end ) {
    
    data = {};

  }

}

// display 

function onGesturePlaceDisplay ( event ) {

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

function onGestureMoveDisplay ( event ) {

  onGestureTranslateObject( event, display );

  if ( event.start ) saveDisplay();
  if ( event.current ) updateDisplay();

}

// function onGestureRotateDisplay ( event ) {

//   let data = event.userData;

//   if ( event.start ) {

//     data.angle = 0;  
//     data.up = new THREE.Vector3();
//     data.right = new THREE.Vector3();
//     data.axis = new THREE.Vector3();
//     data.pointerOffset = new THREE.Vector2();
//     data.quaternion0 = display.quaternion.clone(); 
    
//     saveDisplay();  

//   } 

//   if ( event.current ) {

//     data.pointerOffset.copy( gestures.parameters[0].pointerOffset );
    
//     data.up.set( 0 , 1, 0 ).multiplyScalar( data.pointerOffset.x );
//     data.right.set( -1, 0, 0 ).transformDirection( camera.matrixWorld ).multiplyScalar( data.pointerOffset.y );

//     data.axis.addVectors( data.up, data.right ).normalize();
//     data.angle = Math.PI / 60.0 * data.pointerOffset.length();

//     display.quaternion.copy( data.quaternion0 );
//     display.rotateOnWorldAxis( data.axis, data.angle );

//     updateDisplay();

//   } 
  
//   if ( event.end ) {
    
//     data = {}; 

//   }

// }

function onGestureResizeDisplay ( event ) {

  onGestureResizeObject( event, display );

  if ( event.start ) saveDisplay();
  if ( event.current ) updateDisplay();

}

function onGestureRollDisplay ( event ) {

  onGestureRollObject( event, display );

  if ( event.start ) saveDisplay();
  if ( event.current ) updateDisplay();

}

function onGestureRotateDisplay ( event ) {

  onGestureTurnObject( event, display );

  if ( event.start ) saveDisplay();
  if ( event.current ) updateDisplay();
}

// screen

function onGestureMoveScreen ( event ) {

  onGestureTranslateObject( event, screen );

  if ( event.start ) saveScreen();

  if ( event.current ) {

    updateScreen();
    updateScreenUniformsPlanes();
    updateModelUniformsPlanes();

  }

}

function onGestureRollScreen ( event ) {

  onGestureRollObject( event, screen );

  if ( event.start ) saveScreen();
  
  if ( event.current ) {

    updateScreen();
    updateScreenUniformsPlanes();
    updateModelUniformsPlanes();

  }

}

function onGestureContrastScreen ( event ) {

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

function onGestureHideScreenMonitor ( event ) {

  if ( event.end ) {

    const selected = intersectScreen( gestures.raycasters.hand[0].ray )[0];
  
    if ( selected ) {
  
      saveScreen( event );
      
      const uniforms = selected.object.material.uniforms;
      uniforms.uPlaneVisible.value = ! uniforms.uPlaneVisible.value;
  
    }
    
  }

}

// function onGestureMoveScreenMonitor ( event ) {

//   let data = event.userData;

//   if ( event.start ) {

//     data.selected = intersectScreen( gestures.raycasters.hand[0].ray )
//     data.selected = data.selected.filter( (x) => x.object.material.uniforms.uPlaneVisible.value ) [0];

//   }

//   if ( data.selected ) {

//     if ( event.start ) { 

//       saveScreen() 
//       data.axis = data.selected.object.userData.plane.normal.clone();

//     };

//     onGestureTranslateObjectOnWorldAxis( event, data.selected.object, data.axis );

//     if ( event.current ) {

//       updateScreen();
//       updateScreenUniformsPlanes();
//       updateModelUniformsPlanes();

//     }

//   }


// }

function onGestureMoveScreenMonitor ( event ) {

  let data = event.userData;

  if (event.start) {
  
    data.selected = intersectScreen( gestures.raycasters.hand[0].ray )
    .filter( (intersection) => intersection.object.material.uniforms.uPlaneVisible.value ) [0];

    if ( data.selected ) {

      saveScreen( event );

      scene.attach( screen ); // screen becomes a world object

      updateScreen();
      updateScreenUniformsPlanes();

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
    camera.getWorldDirection( data.hitPlane.normal ).projectOnPlane( data.direction ).normalize();

    // intersect ray and plane
    gestures.raycasters.hand[0].ray.intersectPlane(data.hitPlane, data.point); // world cs

    // move screen depending on intersection
    if ( data.point ) {

      data.translation.subVectors(data.point, data.origin).projectOnVector(data.direction);
      data.position.copy(data.position0).add(data.translation);

      screen.position.copy( data.position );

      updateScreen();
      updateScreenUniformsPlanes();

      // // move screen only if the new position is inside the container
      // if ( container.userData.obb.containsPoint(data.position) ) {

        
      // }
    }
  }

  if ( event.end && data.selected ) {

    display.attach(screen);

    updateScreen();
    updateScreenUniformsPlanes();

    model.material.uniforms.uModelAlpha.value = 1.0;
    model.material.uniforms.uModelAlphaClip.value = 0.4;
    model.material.needsUpdate;

    data = {};


  }
}

function onGestureRotateScreenMonitor ( event ) {

  let data = event.userData;

  if ( event.start ){

    // get screen intersections with visible monitors
    data.selected = intersectScreen( gestures.raycasters.hand[0].ray )
    .filter( (intersection) => intersection.object.material.uniforms.uPlaneVisible.value )[0];
   
    if ( data.selected ) {
      
      saveScreen( event );

      scene.attach( screen ); // screen becomes a world object

      updateScreen();
      updateScreenUniforms();

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
          
    gestures.raycasters.hand[0].ray.intersectPlane( data.hitPlane, data.point ); // world cs

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

// brush

function onGestureEditMask ( event ) {

  let data = event.userData;

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

    // update uniforms

    updateScreenUniformsMask();
    updateModelUniformsMask();

    if ( brush.userData.mode === 'ADD' ) updateModelUniformsBox();

  }

  if ( event.end ) {

    mask.userData.history.unshift( data.record );

    // update model uniforms
    if ( brush.userData.mode === 'SUB' ) {

      computeModelBoundingBox();
      updateModelUniformsBox();

    } 

    model.material.needsUpdate = true;

    data = {};
  }
}

function onGestureToggleBrush ( event ) {

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

function onGestureResizeBrush ( event ) {

  onGestureResizeObject( event, brush );

  if ( event.current ) updateScreenUniformsBrush();

}

// selector3D

async function computeSegmentation3D() {

  const array = new Uint8Array( mask.userData.data0.length ).fill( 1 );
  return array;

}

async function onGestureUpdateSegmentation3D ( event ) {

  if ( event.end ) {

    const array = await computeSegmentation3D();

    const points = selector3D.userData.vertices.map( (vertex) => vertex.position.clone().applyMatrix4( selector3D.matrix ) );
    const box = new THREE.Box3().setFromPoints( points );
  
    const boxMin = positionToSample( box.min );
    const boxMax = positionToSample( box.max );
      
    updateMaskTexture( array, boxMin, boxMax );
    
    updateModelUniformsMask();
    updateScreenUniformsMask();
  
    computeModelBoundingBox();   
    updateModelUniformsBox(); 

    updateDisplay();

  }

}

function onGestureResizeSelector3D ( event ) {

  onGestureResizeObject( event, selector3D );

  if ( event.start ) saveSelector3D();
  if ( event.current ) {

    updateSelector3D();
    updateScreenUniformsSelector();

  }

}

function onGestureMoveSelector3D ( event ) {

  onGestureTranslateObject( event, selector3D );

  if ( event.start ) saveSelector3D();
  if ( event.current ) updateSelector3D();

}

function onGestureMoveSelectorVertex3D ( event ) {

  let data = event.userData;

  if ( event.start ) {

    data.intersection = intersectSelectorVertices3D( gestures.raycasters.hand[0].ray )[0];

  }
  
  if ( event.start && data.intersection ) {

    saveSelector3D( event );

    // display local coordinate system

    data.selector = {
      scale0:    new THREE.Vector3().copy( selector3D.scale ),   
      position0: new THREE.Vector3().copy( selector3D.position ),
    }

    data.matrices = {
      w: new THREE.Matrix4().copy( display.matrixWorld ).invert(), // world -> display coordinate system transformation
      m: new THREE.Matrix4().copy( selector3D.matrix ), // selector -> display coordinate system transformation
    }

    data.points = {
      o:  new THREE.Vector3().copy( data.intersection.object.position ).applyMatrix4( data.matrices.m ), // selected face sphere center
      p:  new THREE.Vector3().copy( data.intersection.point ).applyMatrix4( data.matrices.w ), // intersection point of selected face sphere and hand ray
      q:  new THREE.Vector3(), // later intersection point of plane with hand ray
    };

    data.vectors = {
      s:  new THREE.Vector3().copy( mapVector( data.points.o, Math.sign ) ),
      op: new THREE.Vector3().subVectors( data.points.p, data.points.o ),
      pq: new THREE.Vector3(),
    }

    data.shapes = {
      object3D: new THREE.Object3D(),
    }

    // world coordinates
    data.shapes.object3D.position.copy( data.intersection.point );
    gestures.controller[0].attach( data.shapes.object3D ); 

  }

  if ( event.current && data.intersection ) {

    // update point position
    data.shapes.object3D.getWorldPosition( data.points.q ).applyMatrix4( data.matrices.w );

    // get intersection vector
    data.vectors.pq.subVectors( data.points.q, data.points.p );

    // update selector position  
    selector3D.position.copy( data.selector.position0 ).addScaledVector( data.vectors.pq, 0.5 );
    
    // update selector scale
    data.vectors.pq.multiply( data.vectors.s );
    selector3D.scale.copy( data.selector.scale0 ).add( data.vectors.pq );

    // update selector
    updateSelector3D();
    
  }

  if ( event.end ) {

    gestures.controller[0].remove( data.shapes.object3D ); 

    data = {};

  }

}

function onGestureMoveSelectorFace3D ( event ) {

  let data = event.userData;

  if ( event.start ) {

    data.intersection = intersectSelectorFaces3D( gestures.raycasters.hand[0].ray )[0];

  }

  if ( event.start && data.intersection ) {

    saveSelector3D( event );

    // display local coordinate system

    data.selector = {
      scale0:    new THREE.Vector3().copy( selector3D.scale ),   
      position0: new THREE.Vector3().copy( selector3D.position ),
    }

    data.matrices = {
      w: new THREE.Matrix4().copy( display.matrixWorld ).invert(), // world -> display coordinate system transformation
      m: new THREE.Matrix4().copy( selector3D.matrix ), // selector -> display coordinate system transformation
    }

    data.points = {
      o:  new THREE.Vector3().copy( data.intersection.object.position ).applyMatrix4( data.matrices.m ), // selected face sphere center
      p:  new THREE.Vector3().copy( data.intersection.point ).applyMatrix4( data.matrices.w ), // intersection point of selected face sphere and hand ray
      q:  new THREE.Vector3(), // later intersection point of plane with hand ray
    };

    data.vectors = {
      n:  new THREE.Vector3(),
      s:  new THREE.Vector3().copy( mapVector( data.points.o, Math.sign ) ),
      d:  new THREE.Vector3().subVectors( data.points.o, data.selector.position0 ).normalize(), // direction normal of selector box face
      op: new THREE.Vector3().subVectors( data.points.p, data.points.o ),
      pq: new THREE.Vector3(),
    }

    data.vectors.n.copy( gestures.raycasters.view.ray.direction ).transformDirection( data.matrices.w ).projectOnPlane( data.vectors.d ).normalize();

    data.shapes = {
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint( data.vectors.n, data.points.p ), // intersection plane centered at point 
      ray:   new THREE.Ray().copy( gestures.raycasters.hand[0].ray ).applyMatrix4( data.matrices.w ), // intersection hand ray in local coordinates
      line:  new THREE.Line3().set( data.points.p, data.points.p.clone().add( data.vectors.d ) ), // projection line to the direction of face
    }

  }

  if ( event.current && data.intersection ) {

    // update plane
    data.shapes.plane.normal.copy( gestures.raycasters.view.ray.direction ).transformDirection( data.matrices.w ).projectOnPlane( data.vectors.d ).normalize();
  
    // update ray 
    data.shapes.ray.copy( gestures.raycasters.hand[0].ray ).applyMatrix4( data.matrices.w );
   
    // intersect ray with plane
    data.shapes.ray.intersectPlane( data.shapes.plane, data.points.q );

    if ( data.points.q ) {

      // project point to line
      data.shapes.line.closestPointToPoint( data.points.q, false, data.points.q ); 

      // get intersection vector
      data.vectors.pq.subVectors( data.points.q, data.points.p );    

      // update selector position  
      selector3D.position.copy( data.selector.position0 ).addScaledVector( data.vectors.pq, 0.5 );

      // update selector scale
      data.vectors.pq.multiply( data.vectors.s );
      selector3D.scale.copy( data.selector.scale0 ).add( data.vectors.pq );

      // update selector
      updateSelector3D();
      
    }    

  }

  if ( event.end ) {

    data = {};

  }

}

// selector 2D 

function onGestureSelect2D ( event ) {

  data = event.userData;

  if ( event.start ) {
    
    brush.userData.monitorIndex;

    data.matrices = {
      w:  new THREE.Matrix3().setFromMatrix4( screen.matrixWorld ).invert(),
      m: new THREE.Matrix3().setFromMatrix4( screen.matrixWorld ).invert().premultiply( brush.parent.matrixWorld ),
    }

    data.points = {
      p: new THREE.Vector3().copy( brush.position ).applyMatrix4( data.matrices.m ),
      q: new THREE.Vector3(),
    }

    data.vectors = {
      pq: new THREE.Vector3(),
      s:  new THREE.Vector3().copy( mapVector( data.points.p, Math.sign ) ),
    }

  }

  if ( event.current ) {

    data.points.q.copy( brush.position ).applyMatrix4( data.matrices.m );

    data.vectors.pq.subVectors( data.points.q, data.points.p );

    // update selector position  
    selector2D.position.copy( data.points.p ).addScaledVector( data.vectors.pq, 0.5 );
    
    // update selector scale
    selector2D.scale.copy( data.vectors.pq ).multiply( data.vectors.s );;

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

function loadRawNIFTI ( file ) {

  return new Promise( (resolve, reject) => {

    if ( ! file ) reject("Error: No file selected");   
    const fileReader = new FileReader();

    fileReader.readAsArrayBuffer( file );
    fileReader.onloadend = (event) => {

      if ( event.target.readyState === FileReader.DONE ) {
        
        let result;

        if ( nifti.isCompressed( event.target.result ) ) {

          result = nifti.decompress( event.target.result );

        } else {

          result = event.target.result;

        }

        resolve( result );

      }
    }
		  
  });

}

function saveData ( data, fileName ) {

	const element = document.createElement("a");
	document.body.appendChild( element );
  element.style.display = 'none';

  // Ensure data is in an array and specify the MIME type (if known/applicable)
  const blob = new Blob( data, { type: 'application/octet-stream' } );
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
  const axes = [ _xAxis, _yAxis, _zAxis ].map( (axis) => axis.clone() );
  const correlation = axes.map( (axis) => 
    Math.abs( _vector3.copy( vector ).projectOnVector( axis ).length() )
  );
 
  // determine the closest axis to the vector
  const index = correlation.indexOf( Math.max(...correlation) );
  const axis = axes[ index ].multiplyScalar( octant[ index ] );
  axis.transformDirection( screen.matrixWorld );

  // return the axis in world coordinates
  return axis;
}

function formatVector( vector, digits ) {

  let sign = vector.toArray().map( (component) => ( component > 0 ) ? '+' : '-' );

  if ( vector instanceof THREE.Vector2 ) return `(${sign[0] + Math.abs(vector.x).toFixed(digits)}, ${sign[1] + Math.abs(vector.y).toFixed(digits)})`;
  if ( vector instanceof THREE.Vector3 ) return `(${sign[0] + Math.abs(vector.x).toFixed(digits)}, ${sign[1] + Math.abs(vector.y).toFixed(digits)}, ${sign[2] + Math.abs(vector.z).toFixed(digits)})`;

}

function mapVector ( vector, fun ) {

  _vector3.set(

    fun( vector.x ),
    fun( vector.y ),
    fun( vector.z ),
    
  )

  return _vector3.clone();
  
}

function transformArray ( array, box, fun ) {

  let index, offsetX, offsetY, offsetZ;
  

  for ( let k = box.min.z; k <= box.max.z; k++ ) {

    offsetZ = size.x * size.y * k


    for ( let j = box.min.y; j <= box.max.y; j++ ) {

      offsetY = size.x * j 


      for ( let i = box.min.x; i <= box.max.x; i++ ) {

        offsetX = i;

        // linear index

        index = offsetX + offsetY + offsetZ;
        
        // element wise function

        array[index] = fun( i, j, k );

      }   
    }
  }

  return array;

}

// voxel functions

function index3dToLinear ( index3D, size ) {  

  const offsetX = index3D.x;
  const offsetY = index3D.y * size.x;
  const offsetZ = index3D.z * size.x * size.y;

  return offsetX + offsetY + offsetZ;

}

function indexLinearTo3d ( index, size ) {

  const k = Math.floor( index / ( size.x * size.y ) ); 
  const j = Math.floor( ( index - k * size.x * size.y ) / size.x );
  const i = Math.floor( index - k * size.x * size.y - j * size.x ); // or index % size.x

  return _vector3.set( k, j, i );

}

function worldPositionToVoxel( position ) {

  _matrix4.copy( display.matrixWorld ).invert();

  _vector3
  .copy( position ) // copy world position
  .applyMatrix4( _matrix4 ) // convert from world to display local coordinates
  .divide( volume.userData.size ) // normalize local position to range [ -0.5, 0.5 )
  .addScalar( 0.5 ) // change offset of normalized position to range [ 0, 1 )
  .multiply( volume.userData.samples ) // range [ 0, samples_max )
  .floor(); // get the sample
  
  return _vector3;

}

function voxelToWorldPosition( index3D ) {

  _vector3
  .copy( index3D )  // copy index 3D 
  .divide( volume.userData.samples ) // get the normalized position in range [ 0, 1 ];
  .subScalar( 0.5 ) // offset normalized position to range [ -0.5, 0.5 ];
  .multiply( volume.userData.size ) // convert to display local position
  .applyMatrix4( display.matrixWorld ); // convert to world coordinates

  return _vector3

}

// segmentation

async function runSegmentation() {

  const dimension = 'z';
  const number = Math.round( volume.userData.image3D.getDimensionSize( dimension ) / 3 );

  const image3D = volume.userData.image3D;
  const image2D = image3D.getSlice( dimension, number );
  image2D._metadata.min = image3D._metadata.statistics.min;
  image2D._metadata.max = image3D._metadata.statistics.max;

  const data = image2D.getDataAsUInt8Array();
  const width = volume.userData.samples.x;
  const height = volume.userData.samples.y;
  const channels = 1;

  const points = [[[
    volume.userData.image3D.getDimensionSize( 'x' ) / 2,
    volume.userData.image3D.getDimensionSize( 'y' ) / 2,
  ]]];

  worker.postMessage( { 
    data: data, 
    width: width, 
    height: height, 
    channels: channels, 
    points: points 
  } );

}

// Xenova

function setupWorkerXenova () {

  worker = new Worker('./prm/workerXenova.js', {
    type: 'module',
  });

  worker.addEventListener( 'message', (event) => {

    if ( event.data.type === 'result' ) onWorkerXenovaDecodeResult( event );
          
  });

}

function onWorkerXenovaDecodeResult( event ) {

  const { mask, scores } = event.data.data;

}

// Mobile Sam

async function setupWorkerMobileSam() {

  worker = new Worker( 'prm/workerMobileSam.js', {
    type: 'module',
  });

  worker.addEventListener( 'message', (event) => {

    if ( event.data.type === 'encode' ) onWorkerMobileSamEncodeResult( event );
    if ( event.data.type === 'decode' ) onWorkerMobileSamDecodeResult( event );
      
  });

  worker.postMessage( { type: 'load', data: {} } );
  
}

function onWorkerMobileSamEncodeResult( event ) {
}

function onWorkerMobileSamDecodeResult( event ) {
}