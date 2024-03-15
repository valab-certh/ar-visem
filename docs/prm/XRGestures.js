import * as THREE from 'three';

// standalone variables

const _pointer    = new THREE.Vector2();
const _vector     = new THREE.Vector2();
const _position   = new THREE.Vector3();
const _pointer0   = new THREE.Vector2();
const _pointer1   = new THREE.Vector2();

// standalone functions

function not( boolean ) { 

    return ! boolean; 

}

function delay( duration ) {  

    return new Promise( resolve => setTimeout( resolve, duration ) ); 

}

function formatVector( vector, digits ) {

    let sign = vector.toArray().map( (component) => ( component > 0 ) ? '+' : '-' );

    if ( vector instanceof THREE.Vector2 ) return `(${sign[0] + Math.abs(vector.x).toFixed(digits)}, ${sign[1] + Math.abs(vector.y).toFixed(digits)})`;
    if ( vector instanceof THREE.Vector3 ) return `(${sign[0] + Math.abs(vector.x).toFixed(digits)}, ${sign[1] + Math.abs(vector.y).toFixed(digits)}, ${sign[2] + Math.abs(vector.z).toFixed(digits)})`;

}

// class

class XRGestures extends THREE.EventDispatcher {
    
    constructor( renderer ) {

        if ( ! renderer ) console.error('XRGestures must be passed a renderer');

        super();           

        
        // controller parameters
        
        this.parameters = [ 0, 1 ].map( (i) => ({

            connected:      false,

            clock:          new THREE.Clock(),
            duration:       0,       

            pointer:        new THREE.Vector2(),
            pointer0:       new THREE.Vector2(),
            pointerOffset:  new THREE.Vector2(), 

            pointerBuffer:  new Array( XRGestures.BUFFER_LENGTH ).fill().map( () => new THREE.Vector2() ),
            pointerSmooth:  new Array( XRGestures.BUFFER_LENGTH ).fill().map( () => new THREE.Vector2() ),

            distance:       0,     
            angle:          0,
            angleBuffer:    new Array( XRGestures.BUFFER_LENGTH ).fill( 0 ),
    
            radialSpeed:    0,
            angularSpeed:   0,

            pathDistance:   0,                                         
            turnAngle:      0,

            pathSpeed:      0,
            turnSpeed:      0,
            turnDeviation:  0,   

        }) );     

        this.parametersDual = {

            connected:      false,

            clock:          new THREE.Clock(),
            duration:       0,       

            median:         new THREE.Vector2(),
            median0:        new THREE.Vector2(),
            medianOffset:   new THREE.Vector2(),

            vector:         new THREE.Vector2(),
            vector0:        new THREE.Vector2(),
            vectorBuffer:   new Array( XRGestures.BUFFER_LENGTH ).fill().map( () => new THREE.Vector2() ),

            distance:       0,
            distance0:      0,
            distanceOffset: 0,

            angle:          0,    
            angle0:         0,
            angleOffset:    0,

            turnAngle:      0,
            angleBuffer:    new Array( XRGestures.BUFFER_LENGTH ).fill( 0 ),

            radialSpeed:    0,
            angularSpeed:   0,
        
        };


        // detector parameters
       
        this.detector = {

            numConnected: 0,

            delayed: false,
            gesture: undefined,

            gestures: [ 

                'tap', 
                'polytap', 
                'swipe', 
                'hold', 
                'pan', 
                'pinch', 
                'twist', 
                'explode', 
                'implode',                 

            ],
        };

        this.detector.gestures.forEach( (gesture) => this.createGesture(gesture) );
        
        this.detector.tap.numTaps = 0;

        this.detector.polytap.timeoutID = undefined;
        this.detector.polytap.numTaps = 0;

        this.detector.swipe.timeoutID = undefined;
        this.detector.swipe.direction = undefined;
        this.detector.swipe.directions = [ 'RIGHT', 'UP', 'LEFT', 'DOWN'] ;

        this.listenGestures();


        // controllers handles
        
        this.controller = [ 0, 1 ].map( (i) => renderer.xr.getController(i) );       
        this.controller.forEach( (controller, i) => {
                    
            controller.userData.index = i;                     
            controller.userData.parameters = this.parameters[i];
            controller.userData.parametersDual = this.parametersDual;

            controller.addEventListener( 'connected',  async (event) => await this.onConnected( event ));
            controller.addEventListener( 'disconnected', async (event) => await this.onDisconnected( event ));            

        });

        
        // other

        this.renderer = renderer;
        this.camera = renderer.xr.getCamera();


        // raycasters

        this.raycasters = {

            view: new THREE.Raycaster(),
            hand: [ 0, 1 ].map( () => new THREE.Raycaster() ),

        }

               
    }

    //  controller events
    
    async onConnected( event ) {
        
        const controller = event.target;
        const i = controller.userData.index;

        await delay( XRGestures.CONTROLLER_DELAY ); // need this to avoid some transient phenomenon, without it 

        this.detector.numConnected += 1;                            

        this.startParameters( i );

        if ( this.detector.numConnected === 2 ) {

            this.startDualParameters();

        }  

    }

    async onDisconnected( event ) {

        const controller = event.target;
        const i = controller.userData.index;

        await delay( XRGestures.CONTROLLER_DELAY );

        this.detector.numConnected -= 1; 

        this.stopParameters( i );

        if ( this.detector.numConnected < 2 ) {

            this.stopDualParameters();

        } 
    
    }     

    // update loop

    update() {  
     
        if ( ! this.renderer.xr.isPresenting ) console.error('XRGestures must be in xr mode');

        this.camera.updateMatrix();    

        this.updateViewRaycaster();


        if ( this.parameters[0].connected ) {

            this.controller[0].updateMatrix();

            this.updateParameters(0);
            this.updateHandRaycaster(0);

        }

        if ( this.parameters[1].connected ) {

            this.controller[1].updateMatrix();

            this.updateParameters(1);
            this.updateHandRaycaster(1);
        
        }

        if ( this.parametersDual.connected ) {

            this.updateDualParameters();  

        }
        
        if ( ! this.detector.delayed ) { 

            this.detectGestures();

        } // else console.log( 'delay' );


    }    

    // gesture detectors

    detectGestures() {

        // order does matter 

        this.detectTap();                                   
        this.detectPolyTap();
        this.detectSwipe();
        this.detectHold();
        this.detectPan();
        this.detectPinch();
        this.detectTwist();
        this.detectExplode();
        this.detectImplode();

    }

    detectTap() {  

        if ( ! this.detector.tap.start ) {

            if ( this.detector.numConnected === 1 ) this.startGesture('tap');

        }

        if ( this.detector.tap.current ) {

            if ( not( this.detector.numConnected === 0 )) return;
            if ( not( this.parameters[0].duration < XRGestures.TAP_DURATION_MAX )) return;
            if ( not( this.parameters[0].distance < XRGestures.TAP_DISTANCE_MAX )) return;  

            this.detector.tap.numTaps += 1;     

            this.dispatchEvent( { type: 'tap', start: true, current: true, end: true, numTaps: this.detector.tap.numTaps } );  
            this.endGesture('tap');

        }

        if ( this.detector.tap.end ) {

            this.resetGesture('tap');

        }

    }
    
    detectPolyTap() {  

        if ( ! this.detector.polytap.start ) {

            if ( not( this.detector.gesture === undefined )) return;
            if ( not( this.detector.tap.numTaps === 1 )) return;        

            this.detector.gesture = 'polytap';
            this.detector.polytap.numTaps = this.detector.tap.numTaps;
            this.detector.polytap.timeoutID = setTimeout( () => this.endGesture('polytap'), XRGestures.POLYTAP_DURATION );

            this.dispatchEvent( { type: 'polytap', start: true, numTaps: this.detector.polytap.numTaps, userData: this.detector.polytap.userData } ); 
            this.startGesture('polytap');

        }

        if ( this.detector.polytap.current ) {          

            this.dispatchEvent( { type: 'polytap', current: true, numTaps: this.detector.polytap.numTaps, userData: this.detector.polytap.userData } ); 

            // break condition
            if ( this.detector.numConnected > 1 ) { 
              
                clearTimeout( this.detector.polytap.timeoutID );
                this.resetGesture('polytap');   

                this.detector.tap.numTaps = 0; 
                this.detector.polytap.numTaps = 0;            

            }

            // refresh condition
            if ( this.detector.tap.numTaps > this.detector.polytap.numTaps ) {

                clearTimeout( this.detector.polytap.timeoutID );

                this.detector.polytap.numTaps = this.detector.tap.numTaps;
                this.detector.polytap.timeoutID = setTimeout( () => this.endGesture('polytap'), XRGestures.POLYTAP_DURATION );

            }
        }

        if ( this.detector.polytap.end ) {

            this.dispatchEvent( { type: 'polytap', end: true, numTaps: this.detector.polytap.numTaps, userData: this.detector.polytap.userData } ); 
            this.delayDetector( XRGestures.DETECT_DELAY ); 
            this.resetGestureAll();

            this.detector.tap.numTaps = 0;
            this.detector.polytap.numTaps = 0; 

        }
    }

    detectSwipe() {

        if ( ! this.detector.swipe.start ) {

            if ( not( this.detector.gesture === undefined )) return;
            if ( not( this.detector.numConnected === 1 )) return;
            if ( not( this.parameters[0].pathDistance > XRGestures.SWIPE_DISTANCE_MIN )) return;
            if ( not( this.parameters[0].pathSpeed > XRGestures.SWIPE_PATH_SPEED_MIN )) return;

            this.startGesture('swipe');

        }

        if ( this.detector.swipe.current ) {

            if ( this.detector.numConnected === 0 ) {

                this.detector.gesture = 'swipe';

                this.resetGestureExcept('swipe');
                this.endGesture('swipe');

            }
           
        }

        if ( this.detector.swipe.end ) { 

            let i = this.sectorIndex( this.parameters[0].angle, 4 );
            this.detector.swipe.direction = this.detector.swipe.directions[i];   

            this.dispatchEvent( { type: 'swipe', start: true, current: true, end: true, direction: this.detector.swipe.direction, userData: this.detector.swipe.userData } );
            this.delayDetector( XRGestures.DETECT_DELAY );   
            this.resetGestureAll();

        }
        
    }
   
    detectHold() {        

        if ( ! this.detector.hold.start ) {

            if ( not( this.detector.gesture === undefined )) return;
            if ( not( this.detector.numConnected === 1 ) ) return;
            if ( not( this.parameters[0].pathDistance < XRGestures.HOLD_START_DISTANCE_MAX ) ) return;
            if ( not( this.parameters[0].duration > XRGestures.HOLD_START_DURATION_MIN ) ) return;

            this.detector.gesture = 'hold';

            this.dispatchEvent( { type: 'hold', start: true, userData: this.detector.hold.userData, } ); 
            this.resetGestureExcept('hold');
            this.startGesture('hold');

        } 

        if ( this.detector.hold.current ) {        

            this.dispatchEvent( { type: 'hold', current: true, userData: this.detector.hold.userData, } ); 

            if ( this.detector.numConnected > 1 ) this.resetGesture('hold');
            if ( this.detector.numConnected === 0 ) this.endGesture('hold');

        } 
        
        if ( this.detector.hold.end ) {            

            this.dispatchEvent( { type: 'hold', end: true, userData: this.detector.hold.userData, } );
            this.delayDetector( XRGestures.DETECT_DELAY ); 
            this.resetGestureAll();

        }

    }  

    detectPan() {

        if ( ! this.detector.pan.start ) {

            if ( not( this.detector.gesture === undefined )) return;
            if ( not( this.detector.numConnected === 1 ) ) return;
            if ( not( this.parameters[0].pathDistance > XRGestures.PAN_START_DISTANCE_MIN )) return;
            if ( not( this.parameters[0].pathSpeed < XRGestures.PAN_PATH_SPEED_MAX )) return;

            this.detector.gesture = 'pan';     

            this.dispatchEvent( { type: 'pan', start: true, userData: this.detector.pan.userData, } ); 
            this.resetGestureExcept('pan');
            this.startGesture('pan');

        } 

        if ( this.detector.pan.current ) {  

            this.dispatchEvent( { type: 'pan', current: true, userData: this.detector.pan.userData, } ); 

            if ( this.detector.numConnected === 2 ) this.resetGesture('pan');

            if ( this.detector.numConnected === 0 ) this.endGesture('pan');        

        } 
        
        if ( this.detector.pan.end ) {

            this.dispatchEvent( { type: 'pan', end: true, userData: this.detector.pan.userData, } ); 
            this.delayDetector( XRGestures.DETECT_DELAY ); 
            this.resetGestureAll();
  
        }     

    }
    
    detectPinch() {

        if ( ! this.detector.pinch.start ) {

            if ( not( this.detector.gesture === undefined ) ) return;
            if ( not( this.detector.numConnected === 2 ) ) return;
            if ( not( Math.abs( this.parametersDual.distanceOffset ) > XRGestures.PINCH_START_DIAMETER_OFFSET_MIN ) ) return;
            if ( not( Math.abs( this.parametersDual.angleOffset ) < XRGestures.PINCH_START_ANGLE_OFFSET_MAX ) ) return;  
            if ( not( Math.abs( this.parametersDual.radialSpeed ) < XRGestures.PINCH_START_RADIAL_SPEED_MAX )) return;   

            this.detector.gesture = 'pinch';           

            this.dispatchEvent( { type: 'pinch', start: true, userData: this.detector.pinch.userData } );
            this.resetGestureExcept('pinch');
            this.startGesture('pinch');
        } 

        if ( this.detector.pinch.current ) {
           
            this.dispatchEvent( { type: 'pinch', current: true, userData: this.detector.pinch.userData } );
        
            if ( this.detector.numConnected < 2 ) this.endGesture('pinch');

        } 
        
        if ( this.detector.pinch.end ) {

            this.dispatchEvent( { type: 'pinch', end: true, userData: this.detector.pinch.userData } );
            this.delayDetector( XRGestures.DETECT_DELAY ); 
            this.resetGestureAll(); 

        }

    }

    detectTwist() {
        
        if ( ! this.detector.twist.start ) {

            if ( not( this.detector.gesture === undefined )) return;
            if ( not( this.detector.numConnected === 2 ) ) return;
            if ( not( this.parametersDual.distance > XRGestures.TWIST_START_DISTANCE_MIN ) ) return;
            if ( not( Math.abs( this.parametersDual.distanceOffset ) < XRGestures.TWIST_START_DIAMETER_OFFSET_MAX ) ) return;
            if ( not( Math.abs( this.parametersDual.angleOffset ) > XRGestures.TWIST_START_ANGLE_OFFSET_MIN ) ) return;

            this.detector.gesture = 'twist';         
               
            this.dispatchEvent( { type: 'twist', start: true, userData: this.detector.twist.userData, } );                
            this.resetGestureExcept('twist');
            this.startGesture('twist');

        } 

        if ( this.detector.twist.current ) {           

            this.dispatchEvent( { type: 'twist', current: true, userData: this.detector.twist.userData, } );
        
            if ( this.detector.numConnected < 2 ) this.endGesture('twist');        

        } 
        
        if ( this.detector.twist.end ) {

            this.dispatchEvent( { type: 'twist', end: true, userData: this.detector.twist.userData, } );
            this.delayDetector( XRGestures.DETECT_DELAY ); 
            this.resetGestureAll();

        }
    }

    detectExplode() {

        if ( ! this.detector.explode.start ) {

            if ( not( this.detector.gesture === undefined )) return;
            if ( not( this.detector.numConnected === 2 )) return;
            if ( not( this.parametersDual.distanceOffset > XRGestures.EXPLODE_DIAMETER_OFFSET_MIN )) return;
            if ( not( Math.abs( this.parametersDual.radialSpeed ) > XRGestures.EXPLODE_RADIAL_SPEED_MIN )) return;

            this.startGesture('explode');

        }

        if ( this.detector.explode.current ) {

            if ( this.detector.numConnected < 2 ) {

                this.detector.gesture = 'explode';

                this.resetGestureExcept('explode');
                this.endGesture('explode');

            }
           
        }

        if ( this.detector.explode.end ) {  

            this.dispatchEvent( { type: 'explode', start: true, current: true, end: true, userData: this.detector.explode.userData, } );
            this.delayDetector( XRGestures.DETECT_DELAY ); 
            this.resetGestureAll();

        }
    }

    detectImplode() {

        if ( ! this.detector.implode.start ) {

            if ( not( this.detector.gesture === undefined )) return;
            if ( not( this.detector.numConnected === 2 )) return;
            if ( not( this.parametersDual.distanceOffset  < XRGestures.IMPLODE_DIAMETER_OFFSET_MAX )) return;
            if ( not( Math.abs( this.parametersDual.radialSpeed ) > XRGestures.IMPLODE_RADIAL_SPEED_MIN )) return;
            
            this.startGesture('implode');

        }

        if ( this.detector.implode.current ) {

            if ( this.detector.numConnected < 2 ) {

                this.detector.gesture = 'implode';

                this.resetGestureExcept('implode');
                this.endGesture('implode');

            }        
            
        }

        if ( this.detector.implode.end ) {  

            this.dispatchEvent( { type: 'implode', start: true, current: true, end: true, userData: this.detector.implode.userData, } );
            this.delayDetector( XRGestures.DETECT_DELAY ); 
            this.resetGestureAll();

        }
    }

    // gesture listeners

    listenGestures() {

        this.addEventListener( 'tap',     (event) => this.onTap( event ) );
        this.addEventListener( 'polytap', (event) => this.onPolytap( event ) );
        this.addEventListener( 'hold',    (event) => this.onHold( event ) );
        this.addEventListener( 'pan' ,    (event) => this.onPan( event ) );
        this.addEventListener( 'swipe',   (event) => this.onSwipe( event ) );    
        this.addEventListener( 'pinch',   (event) => this.onPinch( event ) );        
        this.addEventListener( 'twist',   (event) => this.onTwist( event ) );        
        this.addEventListener( 'explode', (event) => this.onExplode( event ) );        
        this.addEventListener( 'implode', (event) => this.onImplode( event ) );        

    }

    onTap( event ) {

        // console.log(`tap ${event.numTaps}`);

    }

    onPolytap( event ) {

        if ( event.start )   console.log(`polytap start ${event.numTaps}`);
        if ( event.current ) console.log(`polytap current ${event.numTaps}`);
        if ( event.end )     console.log(`polytap end ${event.numTaps}`);

    }

    onSwipe( event ) {

        console.log(`swipe ${event.direction}`);        

    }

    onHold( event ) {

        if ( event.start )   console.log(`hold start`);
        if ( event.current ) console.log(`hold current`);
        if ( event.end )     console.log(`hold end`);

    }

    onPan( event ) {
        
        if ( event.start )   console.log(`pan start`);
        if ( event.current ) console.log(`pan current`);
        if ( event.end )     console.log(`pan end`);

    }

    onPinch( event ) {
        
        if ( event.start )   console.log(`pinch start`);
        if ( event.current ) console.log(`pinch current`);
        if ( event.end )     console.log(`pinch end`);

    }

    onTwist( event ) {
        
        if ( event.start )   console.log(`twist start`);
        if ( event.current ) console.log(`twist current`);
        if ( event.end )     console.log(`twist end`);

    }

    onExplode( event ) {
        
        console.log(`explode`);       

    }

    onImplode( event ) {
        
        console.log(`implode`);       

    }

    // update controller parameters

    resetParameters( i ) {

        this.parameters[i].connected = false;

        this.parameters[i].clock.stop();
        this.parameters[i].duration = 0;

        this.parameters[i].pointer.set( 0, 0 );        
        this.parameters[i].pointer0.set( 0, 0 );
        this.parameters[i].pointerOffset.set( 0, 0 ); 

        this.parameters[i].pointerBuffer.forEach( (pointer) => pointer.set( 0, 0 ) );
        this.parameters[i].pointerSmooth.forEach( (pointer) => pointer.set( 0, 0 ) );

        this.parameters[i].distance = 0;
        this.parameters[i].angle = 0;
        this.parameters[i].angleBuffer.fill( 0 );

        this.parameters[i].radialSpeed = 0;
        this.parameters[i].angularSpeed = 0;

        this.parameters[i].pathDistance = 0; 
        this.parameters[i].turnAngle = 0;

        this.parameters[i].pathSpeed = 0;
        this.parameters[i].turnSpeed = 0;
        this.parameters[i].turnDeviation = 0;

    }

    startParameters( i ) {

        this.resetParameters(i);

        this.parameters[i].connected = true;
        this.parameters[i].clock.start();

        this.updatePointer(i);
        this.parameters[i].pointer0.copy( this.parameters[i].pointer );
        this.parameters[i].pointerBuffer.forEach( (pointer) => pointer.copy( this.parameters[i].pointer0 ) );
        this.parameters[i].pointerSmooth.forEach( (pointer) => pointer.copy( this.parameters[i].pointer0 ) );

    }

    stopParameters( i ) {

        this.parameters[i].connected = false;
        this.parameters[i].clock.stop();

    }

    updateParameters( i ) {     
        
        this.updateDuration(i);

        this.updatePointer(i);
        this.updatePointerOffset(i);

        this.updatePointerBuffer(i);
        this.updatePointerSmooth(i);

        this.updateAngle(i); 
        this.updateAngleBuffer(i);
        this.updateTurnAngle(i);

        this.updateDistance(i);
        this.updateCoverDistance(i);

        this.updateRadialSpeed(i); 
        this.updateAngularSpeed(i);  

        this.updatePathSpeed(i); 
        this.updateTurnSpeed(i);  
        this.updateTurnDeviation(i);  
        
        // this.printParameters( i, 3 );

    } 

    printParameters( i, digits ) {

        console.log(`parameters${i}: \n\n\tduration = ${this.parameters[i].duration.toFixed(digits)} ms` );

        console.log(`parameters${i}: \n\n\tpointer = ${formatVector( this.parameters[i].pointer, digits )} mm` );
        console.log(`parameters${i}: \n\n\tpointer0 = ${formatVector( this.parameters[i].pointer0, digits )} mm` );
        console.log(`parameters${i}: \n\n\tpointerOffset = ${formatVector( this.parameters[i].pointerOffset, digits )} mm` );

        console.log(`parameters${i}: \n\n\tpointerBuffer[ 0 ] = ${formatVector( this.parameters[i].pointerBuffer[0], digits )} mm \n\n\tpointerBuffer[end] = ${formatVector( this.parameters[i].pointerBuffer[XRGestures.BUFFER_LENGTH - 1], digits )} mm`);
        console.log(`parameters${i}: \n\n\tpointerSmooth[ 0 ] = ${formatVector( this.parameters[i].pointerSmooth[0], digits )} mm \n\n\tpointerBuffer[end] = ${formatVector( this.parameters[i].pointerSmooth[XRGestures.BUFFER_LENGTH - 1], digits )} mm`);

        console.log(`parameters${i}: \n\n\tdistance = ${this.parameters[i].distance.toFixed(digits)} mm`);
        console.log(`parameters${i}: \n\n\tpathDistance = ${this.parameters[i].pathDistance.toFixed(digits)} mm`);

        console.log(`parameters${i}: \n\n\tangle = ${this.parameters[i].angle.toFixed(digits)} °`);
        console.log(`parameters${i}: \n\n\tturnAngle = ${this.parameters[i].turnAngle.toFixed(digits)} °`);
        console.log(`parameters${i}: \n\n\tangleBuffer[ 0 ] = ${this.parameters[i].angleBuffer[0].toFixed(digits)} ° \n\n\tangleBuffer[end] = ${this.parameters[i].angleBuffer[XRGestures.BUFFER_LENGTH - 1].toFixed(digits)} °`);
    
        console.log(`parameters${i}: \n\n\tradialSpeed = ${this.parameters[i].radialSpeed.toFixed(digits)} m/s`);
        console.log(`parameters${i}: \n\n\tangularSpeed = ${this.parameters[i].angularSpeed.toFixed(digits)} °/ms`);
        
        console.log(`parameters${i}: \n\n\tpathSpeed = ${this.parameters[i].pathSpeed.toFixed(digits)} m/s`);
        console.log(`parameters${i}: \n\n\tturnSpeed = ${this.parameters[i].turnSpeed.toFixed(digits)} °/ms`);
        console.log(`parameters${i}: \n\n\tturnDeviation = ${this.parameters[i].turnDeviation.toFixed(digits)} °/mm`);

    }

    updateDuration( i ) {

        this.parameters[i].duration = this.parameters[i].clock.getElapsedTime() * 1000; // ms

    }

    updatePointer( i ) {    
    
        _position.copy( this.controller[i].position ); // m
        _position.applyMatrix4( this.camera.matrixWorldInverse ); // m

        this.parameters[i].pointer.set( _position.x * 1000, _position.y * 1000 ); // mm

    }

    updatePointerBuffer( i ) {    
    
        this.parameters[i].pointerBuffer.unshift( this.parameters[i].pointerBuffer.pop() );  // mm
        this.parameters[i].pointerBuffer[0].copy( this.parameters[i].pointer ); // mm

    }

    updatePointerSmooth( i ) {
    
        // compute average pointer 

        _pointer.set( 0, 0 );

        for ( let n = 0; n < XRGestures.WINDOW_SMOOTH; ++n ) {

            _pointer.add( this.parameters[i].pointerBuffer[n] ); 

        }
        _pointer.divideScalar( XRGestures.WINDOW_SMOOTH ); // mm

        // save in buffer

        this.parameters[i].pointerSmooth.unshift( this.parameters[i].pointerSmooth.pop() );  // mm
        this.parameters[i].pointerSmooth[0].copy( _pointer ); // mm

    }

    updatePointerOffset( i ) {

        this.parameters[i].pointerOffset.subVectors(
            this.parameters[i].pointer,
            this.parameters[i].pointer0,        
        ); 
       
    }
    
    updateDistance( i ) {

        this.parameters[i].distance = this.parameters[i].pointerOffset.length(); // mm

    }

    updateCoverDistance( i ) {
        
        _pointer0.copy( this.parameters[i].pointerSmooth[0] ); // mm
        _pointer1.copy( this.parameters[i].pointerSmooth[1] ); // mm

        let step = _vector.subVectors( _pointer0, _pointer1 ).length();  
        
        this.parameters[i].pathDistance += step; // mm

    }

    updateAngle( i ) {   

        let angle = THREE.MathUtils.radToDeg( this.parameters[i].pointerOffset.angle() );  // °       
       
        if ( this.parameters[i].distance < 0.1 ) angle = 0; // °  
        

        let step = angle - this.parameters[i].angle; // °         
        
        if ( Math.abs(step) > 180 )  step -= 360 * Math.sign( step ); // °  


        this.parameters[i].angle += step ; // °  

    }

    updateAngleBuffer( i ) {

        this.parameters[i].angleBuffer.unshift( this.parameters[i].angleBuffer.pop() ); 
        this.parameters[i].angleBuffer[0] = this.parameters[i].angle;

    }

    updateTurnAngle( i ) {       

        let step = Math.abs( this.parameters[i].angleBuffer[0] - this.parameters[i].angleBuffer[1] ); // °                           
        this.parameters[i].turnAngle += step ; // °  

    } 

    updateRadialSpeed( i ) {  

        this.parameters[i].radialSpeed = this.parameters[i].distance / this.parameters[i].duration; // m/s

    }

    updateAngularSpeed( i ) {

        this.parameters[i].angularSpeed = this.parameters[i].angle / this.parameters[i].duration; // °/ms

    }

    updatePathSpeed( i ) {  

        this.parameters[i].pathSpeed = this.parameters[i].pathDistance / this.parameters[i].duration; // m/s

    }

    updateTurnSpeed( i ) {

        this.parameters[i].turnSpeed = this.parameters[i].turnAngle / this.parameters[i].duration; // °/ms

    }

    updateTurnDeviation( i ) {
    
        this.parameters[i].turnDeviation = this.parameters[i].turnAngle / this.parameters[i].pathDistance; // °/mm

        if ( this.parameters[i].pathDistance < 0.01 ) this.parameters[i].turnDeviation = 0;
            

    }   

    // update dual controller parameters

    resetDualParameters() {

        this.parametersDual.connected = false;
        
        this.parametersDual.clock.stop();
        this.parametersDual.duration = 0;

        this.parametersDual.median.set( 0, 0 );    
        this.parametersDual.median0.set( 0, 0 );   
        this.parametersDual.medianOffset.set( 0, 0 );     

        this.parametersDual.vector.set( 0, 0 );
        this.parametersDual.vector0.set( 0, 0 );
        this.parametersDual.vectorBuffer.forEach((vector) => vector.set( 0, 0 )),

        this.parametersDual.distance = 0;
        this.parametersDual.distance0 = 0;
        this.parametersDual.distanceOffset = 0;

        this.parametersDual.angle = 0;
        this.parametersDual.angle0 = 0;
        this.parametersDual.angleOffset = 0;

        this.parametersDual.turnAngle = 0;
        this.parametersDual.angleBuffer.fill( 0 );

        this.parametersDual.radialSpeed = 0;
        this.parametersDual.angularSpeed = 0;
    }

    startDualParameters() {
        
        this.resetDualParameters();

        this.parametersDual.connected = true;    
        this.parametersDual.clock.start();

        this.updateDualVector();
        this.parametersDual.vector0.copy( this.parametersDual.vector );
        this.parametersDual.vectorBuffer.forEach((vector) => vector.copy( this.parametersDual.vector0 ));

        this.updateDualDistance();
        this.parametersDual.distance0 = this.parametersDual.distance;
        
        this.updateDualAngle()
        this.parametersDual.angle0 = this.parametersDual.angle;
        this.parametersDual.angleBuffer.fill( this.parametersDual.angle0 );
        
        this.updateDualMedian()
        this.parametersDual.median0.copy( this.parametersDual.median );

    }

    stopDualParameters() {

        this.parametersDual.connected = false;        
        this.parametersDual.clock.stop();

    }

    updateDualParameters() {

        this.updateDualDuration();

        this.updateDualMedian();
        this.updateDualMedianOffset();

        this.updateDualVector();
        this.updateDualVectorBuffer();

        this.updateDualDistance();
        this.updateDualDistanceOffset();

        this.updateDualAngle(); 
        this.updateDualAngleOffset();
        
        this.updateDualAngleBuffer();
        this.updateDualTurnAngle();

        this.updateDualRadialSpeed();   
        this.updateDualAngularSpeed();  
                             
        // this.printDualParameters( 3 );

    } 

    printDualParameters( digits ) {

        console.log(`parametersDual: \n\n\tduration = ${this.parametersDual.duration.toFixed(digits)} ms` );

        console.log(`parametersDual: \n\n\tmedian = ${formatVector( this.parametersDual.median, digits )} mm` );
        console.log(`parametersDual: \n\n\tmedian0 = ${formatVector( this.parametersDual.median0, digits )} mm` );

        console.log(`parametersDual: \n\n\tvector = ${formatVector( this.parametersDual.vector, digits )} mm` );
        console.log(`parametersDual: \n\n\tvector0 = ${formatVector( this.parametersDual.vector0, digits )} mm` );
        console.log(`parametersDual: \n\n\tvectorBuffer[ 0 ] = ${formatVector( this.parametersDual.vectorBuffer[0], digits )} mm \n\n\tpointerBuffer[end] = ${formatVector( this.parametersDual.vectorBuffer[XRGestures.BUFFER_LENGTH - 1], digits )} mm`);

        console.log(`parametersDual: \n\n\tdistance = ${this.parametersDual.distance.toFixed(digits)} mm`);
        console.log(`parametersDual: \n\n\tdistance0 = ${this.parametersDual.distance0.toFixed(digits)} mm`);
        console.log(`parametersDual: \n\n\tdistanceOffset = ${this.parametersDual.distanceOffset.toFixed(digits)} mm`);

        console.log(`parametersDual: \n\n\tangle = ${this.parametersDual.angle.toFixed(digits)} °`);
        console.log(`parametersDual: \n\n\tangle0 = ${this.parametersDual.angle0.toFixed(digits)} °`);
        console.log(`parametersDual: \n\n\tturnAngle = ${this.parametersDual.turnAngle.toFixed(digits)} °`);
        console.log(`parametersDual: \n\n\tangleBuffer[ 0 ] = ${this.parametersDual.angleBuffer[0].toFixed(digits)} ° \n\n\tangleBuffer[end] = ${this.parametersDual.angleBuffer[XRGestures.BUFFER_LENGTH - 1].toFixed(digits)} °`);
    
        console.log(`parametersDual: \n\n\tradialSpeed = ${this.parametersDual.radialSpeed.toFixed(digits)} m/s`);
        console.log(`parametersDual: \n\n\tangularSpeed = ${this.parametersDual.angularSpeed.toFixed(digits)} °/ms`);    

    }

    updateDualDuration() {

        this.parametersDual.duration = this.parametersDual.clock.getElapsedTime() * 1000; // ms

    }

    updateDualVector() {
      
        _pointer0.copy( this.parameters[0].pointer ); // mm
        _pointer1.copy( this.parameters[1].pointer ); // mm        
        this.parametersDual.vector.subVectors( _pointer1, _pointer0 ); // mm   

    }

    updateDualVectorBuffer() {
        
        this.parametersDual.vectorBuffer.unshift( this.parametersDual.vectorBuffer.pop() ); 
        this.parametersDual.vectorBuffer[0].copy( this.parametersDual.vector );   

    }

    updateDualDistance() {

        this.parametersDual.distance = this.parametersDual.vector.length(); // mm

    }

    updateDualDistanceOffset() {
        
        this.parametersDual.distanceOffset = this.parametersDual.distance -  this.parametersDual.distance0;

    }

    updateDualAngle() {

        let angle = THREE.MathUtils.radToDeg( this.parametersDual.vector.angle() );  // °       
        let step = angle - this.parametersDual.angle; // ° 

        if ( Math.abs( step ) > 180 )  step -= 360 * Math.sign( step ); // °

        this.parametersDual.angle += step ; // °     

    }

    updateDualAngleOffset() {
        
        this.parametersDual.angleOffset = this.parametersDual.angle -  this.parametersDual.angle0;

    }

    updateDualAngleBuffer() {

        this.parametersDual.angleBuffer.unshift( this.parametersDual.angleBuffer.pop() ); 
        this.parametersDual.angleBuffer[0] = this.parametersDual.angle;

    }

    updateDualTurnAngle() {     

        let step = Math.abs( this.parametersDual.angleBuffer[0] - this.parametersDual.angleBuffer[1] ); // °                           
        this.parametersDual.turnAngle += step; // °  

    }

    updateDualMedian() {

        _pointer0.copy( this.parameters[0].pointer ); // mm
        _pointer1.copy( this.parameters[1].pointer ); // mm

        this.parametersDual.median.addVectors( _pointer0, _pointer1 ).subScalar( 2 );

    }

    updateDualMedianOffset() {

        this.parametersDual.medianOffset.subVectors( 
            this.parametersDual.median, 
            this.parametersDual.median0,
        );

    }

    updateDualRadialSpeed() {

        this.parametersDual.radialSpeed = this.parametersDual.distanceOffset / this.parametersDual.duration; // m/s

    }

    updateDualAngularSpeed() {

        this.parametersDual.angularSpeed = this.parametersDual.angleOffset / this.parametersDual.duration; //  °/ms

    }

    // update raycasters

    updateViewRaycaster() {

        this.camera.getWorldPosition( this.raycasters.view.ray.origin );
        this.camera.getWorldDirection( this.raycasters.view.ray.direction );

        // console.log(`viewRay.direction = ${formatVector( this.raycasters.viewRay.direction, 2 )} mm`)

    }

    updateHandRaycaster( i ) {
        
        this.controller[i].getWorldPosition( this.raycasters.hand[i].ray.origin );
        this.controller[i].getWorldDirection( this.raycasters.hand[i].ray.direction ).negate();

        // console.log(`handRay[${i}].direction = ${formatVector( this.raycasters.handRay[i].direction, 2 )} mm`)

    }

    // helper functions

    createGesture( name ) {

        this.detector[ name ] = {

            start: false, 
            current: false, 
            end: false, 
            userData: {},

        }
        
    }

    startGesture( gesture ) {

        if ( this.detector.gestures.includes( gesture ) ) {

            this.detector[gesture].start = true;
            this.detector[gesture].current = true;

        }
       
    }

    endGesture( gesture ) {

        if( this.detector.gestures.includes( gesture ) ) {

            this.detector[gesture].end = true;
            this.detector[gesture].current = false;

        }
       
    }

    resetGesture( gesture ) {

        if( this.detector.gestures.includes( gesture ) ) {

            this.detector[gesture].start = false;
            this.detector[gesture].current = false;
            this.detector[gesture].end = false;
            
        }

        if ( gesture === this.detector.gesture ) this.detector.gesture = undefined;
              
    }

    resetGestureExcept( exception ) {

        this.detector.gestures.forEach( (gesture) => { 

            if( gesture !== exception ) this.resetGesture( gesture );
        
        }); 

    }

    resetGestureAll() {

        this.detector.gestures.forEach( (gesture) => this.resetGesture( gesture ) ); 
                
    }

    delayDetector( delay ) {

        this.detector.delayed = true;
        setTimeout( () => this.detector.delayed = false, delay );

    }

    // utils

    reduceAngle ( theta ) {

        return ((theta + 180) % 360 + 360) % 360 - 180;

    }

    angleBrach ( theta ) {

        return Math.floor((theta + 180) / 360);
        
    }

    sectorIndex ( theta, divisor ) {

        const slice = 360 / divisor; 
        return THREE.MathUtils.euclideanModulo( Math.round( theta / slice ), divisor); // degree

    }

}

// gesture constants

XRGestures.CONTROLLER_DELAY = 20; // ms    

XRGestures.DETECT_DELAY = 100; // ms

XRGestures.BUFFER_LENGTH = 2; 

XRGestures.WINDOW_SMOOTH = 1;

XRGestures.TAP_DURATION_MAX = 150; // ms
XRGestures.TAP_DISTANCE_MAX = 10; // mm

XRGestures.POLYTAP_DURATION = 230; // ms

XRGestures.SWIPE_DISTANCE_MIN = 3; // mm
XRGestures.SWIPE_PATH_SPEED_MIN = 0.08; // m/s

XRGestures.HOLD_START_DURATION_MIN = 500; // ms
XRGestures.HOLD_START_DISTANCE_MAX = 3; // mm

XRGestures.PAN_START_DISTANCE_MIN = 3; // mm
XRGestures.PAN_PATH_SPEED_MAX = 0.08; // m/s

XRGestures.PINCH_START_DIAMETER_OFFSET_MIN = 5; // mm
XRGestures.PINCH_START_ANGLE_OFFSET_MAX = 10; // °
XRGestures.PINCH_START_RADIAL_SPEED_MAX = 0.12; // m/s

XRGestures.TWIST_START_DIAMETER_OFFSET_MAX = 5; // mm
XRGestures.TWIST_START_DISTANCE_MIN = 30; // mm
XRGestures.TWIST_START_ANGLE_OFFSET_MIN = 10; // °

XRGestures.EXPLODE_DIAMETER_OFFSET_MIN = 11; // mm 
XRGestures.EXPLODE_RADIAL_SPEED_MIN = 0.12; // mm 

XRGestures.IMPLODE_DIAMETER_OFFSET_MAX = -11; // mm 
XRGestures.IMPLODE_RADIAL_SPEED_MIN = 0.12; // mm 


export { XRGestures };