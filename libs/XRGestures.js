import * as THREE from 'three';

// standalone functions
function not( boolean ) { 
    return !boolean; 
}
function delay( duration = 1000 ) {  
    return new Promise( resolve => setTimeout( resolve, duration ) ); 
}

class XRGestures extends THREE.EventDispatcher {
    
    constructor( renderer ){
        super();
        
        if ( !renderer ) {
            console.error('XRGestures must be passed a renderer');
            return;
        }
               
        // initialize variables

        this.global = {

            screenSize:             new THREE.Vector2(),
            renderer:               renderer,
            headset:                renderer.xr.getCamera(),
            controller:             [0, 1].map( i => renderer.xr.getController(i) ),

            numConnected:           0,  
            isConnected:            [0, 1, 2, 3].map( () => false ),
            toReset:                [0, 1, 2].map( () => false ),

            clock:                  [0, 1, 2, 3].map( () => new THREE.Clock() ),
            duration:               [0, 1, 2, 3].map( () => 0 ),

            laser:                  [0, 1, 3].map( () => new THREE.ArrowHelper() ),
            raycaster:              [0, 1, 3].map( () => new THREE.Raycaster() ),
            toIntersect:            [0, 1, 2].map( () => [] ),
            intersections:          [0, 1, 3].map( () => undefined ),
        }
                  
        this.world = {

            viewDirection:          new THREE.Vector3(),
            handDirection:          [0, 1, 2].map( i => new THREE.Vector3() ),

            pastPositions:          [0, 1, 2].map( () => [] ),
            smoothPositions:        [0, 1, 2].map( () => [] ),
            center:                 [0, 1, 2].map( () => new THREE.Vector2() ),
        }

        this.view = {

            pastPositions:          [0, 1, 2].map( () => [] ),
            pastAngles:             [0, 1, 2].map( () => [] ),
            smoothPositions:        [0, 1, 2].map( () => [] ),
            center:                 [0, 1, 2].map( () => new THREE.Vector2() ),
            displacement:           [0, 1, 2].map( () => new THREE.Vector2() ),            
            radius:                 [0, 1, 2].map( () => 0 ),
            angle:                  [0, 1, 2].map( () => 0 ),
            turnAngle:              [0, 1, 2].map( () => 0 ),
            pathLength:             [0, 1, 2].map( () => 0 ),
            radialSpeed:            [0, 1, 2].map( () => 0 ),
            coverSpeed:             [0, 1, 2].map( () => 0 ),
            angularSpeed:           [0, 1, 2].map( () => 0 ),
            turnDeviation:          [0, 1, 2].map( () => 0 ),

            pairAxis:               new THREE.Vector2(),
            pairCenter:             new THREE.Vector2(),
            pairDisplacement:       new THREE.Vector2(),
            pairDiameter:           0,
            pairAngle:              0,
            gapDiameter:            0,
            gapAngle:               0,
            gapDiametralSpeed:      0,
            gapAngularSpeed:        0,
        }

        this.detect = {

            isDelayed: false,
            gesture: undefined,
            gestureTypes: [ 'tap', 'polytap', 'swipe', 'hold', 'pan', 'glide', 'swirl', 'pinch', 'twist', 'explode', 'implode', 'dualswipe', 'dualhold', 'dualpan' ],

            tap:        { isStart: false, isCurrent: false, isEnd: false, userData: {}, },
            polytap:    { isStart: false, isCurrent: false, isEnd: false, userData: {}, numTaps: 0, timeoutID: undefined },
            swipe:      { isStart: false, isCurrent: false, isEnd: false, userData: {}, direction: undefined, },
            hold:       { isStart: false, isCurrent: false, isEnd: false, userData: {}, },
            pan:        { isStart: false, isCurrent: false, isEnd: false, userData: {}, },
            glide:      { isStart: false, isCurrent: false, isEnd: false, userData: {}, startDistance: 0, distance: 0, delta: 0, direction: new THREE.Vector3(), },
            swirl:      { isStart: false, isCurrent: false, isEnd: false, userData: {}, startTheta: 0, theta: 0, delta: 0, },
            pinch:      { isStart: false, isCurrent: false, isEnd: false, userData: {}, startScale: 0, scale: 0, delta: 0, },
            twist:      { isStart: false, isCurrent: false, isEnd: false, userData: {}, startTheta: 0, theta: 0, delta: 0, },
            explode:    { isStart: false, isCurrent: false, isEnd: false, userData: {}, },
            implode:    { isStart: false, isCurrent: false, isEnd: false, userData: {}, },
            dualswipe:  { isStart: false, isCurrent: false, isEnd: false, userData: {}, },
            dualhold:   { isStart: false, isCurrent: false, isEnd: false, userData: {}, },
            dualpan:    { isStart: false, isCurrent: false, isEnd: false, userData: {}, },
        }

        this.helper = {}

        // setup variables

        this.global.controller.forEach((controller, index) => {
            controller.userData.index = index;
            controller.addEventListener( 'connected',    async (event) => await this.onConnected( event ));
            controller.addEventListener( 'disconnected', async (event) => await this.onDisconnected( event ));
        });    

        this.global.laser.forEach( (laser) => {
            laser.setColor( 0x006677 );
            laser.setLength( 3 );
        } );

        this.global.screenSize.copy( this.getScreenSize() );
               
    }

    //  controller events
    
    async onConnected( event ) {
        const i = event.target.userData.index;

        await delay( XRGestures.CONTROLLER_DELAY );
            this.global.controller[ i ].updateMatrixWorld( true );
            this.resetController( i );
            this.updateWorldCenter( i );   
            this.updateViewCenter( i );   

            this.global.intersections[ i ] = undefined; 
            this.updateWorldHandDirection( i );
            this.updateIntersections( i );     

            this.global.isConnected[ i ] = true; //console.log(`connected[${index}]`)
            this.global.numConnected += 1;
            this.global.clock[ i ].start();
            this.global.duration[ i ] = 0;

        if ( this.global.numConnected === 2 ) {
            this.resetController( 2 );
            this.updateWorldCenter( 2 );   
            this.updateViewCenter( 2 );   
            this.updateViewPairAxis();  

            this.global.isConnected[ 2 ] = true; //console.log(`connected[${index}]`)
            this.global.clock[ 2 ].start();
            this.global.duration[ 2 ] = 0;

            this.global.intersections[ 2 ] = undefined; 
            this.updateWorldHandDirection( 2 );
            this.updateIntersections( 2 );     
        } 
        if ( this.global.numConnected === 1 ) {
            this.global.isConnected[ 3 ] = true; //console.log(`connected[${index}]`)
            this.global.clock[ 3 ].start();
            this.global.duration[ 3 ] = 0;
        }
    }

    async onDisconnected( event ) {
        const i = event.target.userData.index; 

        await delay( XRGestures.CONTROLLER_DELAY );
            this.global.controller[ i ].updateMatrixWorld( true );
            this.global.isConnected[ i ] = false; //console.log(`disconnected[${index}]`)  
            this.global.numConnected -= 1;
            this.global.clock[ i ].stop();   
        
        if ( this.global.numConnected < 2 ) {
            this.global.isConnected[ 2 ] = false; //console.log(`connected[${index}]`)
            this.global.clock[ 2 ].stop(); 
        }
        if ( this.global.numConnected < 1 ) {
            this.global.isConnected[ 3 ] = false; //console.log(`connected[${index}]`)
            this.global.clock[ 3 ].stop(); 
        }
    }     
    
    resetController( i ) {    
        this.resetWorldVariables( i );
        this.resetViewVariables( i );
    }

    updateController( i ) {
        if (i in [0, 1]) this.global.controller[ i ].updateMatrixWorld( true );
        this.updateWorldVariables( i );
        this.updateViewVariables( i )            
    }

    // update loop

    update() {  

        // controller 1 or 2
        if ( this.global.isConnected[ 0 ] || this.global.isConnected[ 1 ] ) {
            this.global.duration[ 3 ] = this.global.clock[ 3 ].getElapsedTime() * 1000;    
            this.global.headset.updateMatrixWorld( true );
            this.updateWorldViewDirection();     
        }        

        // controller 1
        if ( this.global.isConnected[ 0 ] ) {
            this.global.duration[ 0 ] = this.global.clock[ 0 ].getElapsedTime() * 1000;
            this.updateController( 0 );
        }

        // controller 2
        if ( this.global.isConnected[ 1 ] ) {
            this.global.duration[ 1 ] = this.global.clock[ 1 ].getElapsedTime() * 1000;
            this.updateController( 1 );
        }

        // controllers 1 and 2
        if ( this.global.isConnected[ 0 ] && this.global.isConnected[ 1 ] ) {
            this.global.duration[ 2 ] = this.global.clock[ 2 ].getElapsedTime() * 1000;
            this.updateController( 2 );
        }

        if ( !this.detect.isDelayed ) { 
            this.detectTap();
            this.detectPolyTap();
            this.detectSwipe(); 
            this.detectPan();  // pan is a parent gesture to the glide and swirl
            // this.detectGlide();        
            // this.detectSwirl();   
            this.detectHold();               
            this.detectDualHold();
            // this.detectDualPan(); // dual pan is a parent gesture to the pinch and twist
            this.detectPinch();
            this.detectTwist();   
            this.detectDualSwipe();
            this.detectExplode();
            this.detectImplode();
                    
        } //else console.log('delay');
    }    

    // gesture detectors

    detectTap() {  

        if ( not( this.detect.tap.isStart )) {

            if ( not( this.global.numConnected === 1 )) return;
            this.startDetect('tap');
        }

        if ( this.detect.tap.isCurrent ) {

            if ( not( this.global.numConnected === 0 )) return;
            if ( not( this.global.duration[ 0 ] < XRGestures.TAP_DURATION_MAX )) return;
            if ( not( this.view.radius[ 0 ] < XRGestures.TAP_RADIUS_MAX )) return;                
            this.detect.polytap.numTaps += 1;     
            this.dispatchEvent( { type: 'tap' } );
            this.endDetect('tap');
        }

        if ( this.detect.tap.isEnd ) {
            this.resetDetect('tap');
        }
    }

    detectPolyTap() {  

        if ( not( this.detect.polytap.isStart )) {

            if ( not( this.detect.gesture === undefined )) return;
            if ( not( this.detect.polytap.numTaps === 1 )) return;
            this.startDetect('polytap');
            this.detect.polytap.timeoutID = setTimeout( () => this.endDetect('polytap'), XRGestures.POLYTAP_DURATION );
        }

        if ( this.detect.polytap.isCurrent ) {

            if ( this.detect.gesture !== undefined || this.global.numConnected === 2 ) { 
                clearTimeout( this.detect.polytap.timeoutID );
                this.resetDetect('polytap');
                this.detect.polytap.numTaps = 0; 
            };
        }

        if ( this.detect.polytap.isEnd ) {
            this.dispatchEvent( { type: 'polytap', isEnd: true, numTaps: this.detect.polytap.numTaps } );
            this.delayDetectUntil( XRGestures.DETECT_DELAY, () => this.resetDetectExcept() );
            this.detect.polytap.numTaps = 0; 
        }
    }

    detectSwipe() {

        if ( not( this.detect.swipe.isStart )) {

            if ( not( this.detect.gesture === undefined )) return;
            if ( not( this.global.numConnected === 1 )) return;
            if ( not( this.view.radius[ 0 ] > XRGestures.SWIPE_RADIUS_MIN )) return;
            if ( not( this.view.radialSpeed[ 0 ] > XRGestures.SWIPE_RADIAL_SPEED_MIN )) return;
            this.startDetect('swipe');
            this.detect.swipe.timeout = setTimeout( () => this.resetDetect('swipe'), XRGestures.SWIPE_DURATION_MAX );
        }

        if ( this.detect.swipe.isCurrent ) {

            if ( not( this.global.numConnected === 0 )) return;    
            this.detect.gesture = 'swipe';
            this.resetDetectExcept('swipe');
            this.endDetect('swipe');
        }

        if ( this.detect.swipe.isEnd ) { 

            const displacement = this.view.displacement[ 0 ];
            const direction = 
                ( displacement.y >  Math.abs(displacement.x) ) ? "UP"    :
                ( displacement.y < -Math.abs(displacement.x) ) ? "DOWN"  :
                ( displacement.x >  Math.abs(displacement.y) ) ? "RIGHT" :
                ( displacement.x < -Math.abs(displacement.y) ) ? "LEFT"  : 
                undefined
            ;

            if ( direction ) {
                this.dispatchEvent( { 
                    type: 'swipe', 
                    isStart: true, 
                    isCurrent: true, 
                    isEnd: true, 
                    direction: direction, 
                    userData: this.detect.swipe.userData 
                } );
                this.delayDetectUntil( XRGestures.DETECT_DELAY, () => this.resetDetectExcept() );
                
            } else this.resetDetectExcept();  
        }
        
    }

    detectHold() {        

        if ( not( this.detect.hold.isStart )) {

            if ( not( this.detect.gesture === undefined )) return;
            if ( not( this.global.numConnected === 1 ) ) return;
            if ( not( this.view.radius[ 0 ] < XRGestures.HOLD_START_RADIUS_MAX ) ) return;
            if ( not( this.global.duration[ 0 ] > XRGestures.HOLD_START_DURATION_MIN ) ) return;
            this.detect.gesture = 'hold';
            this.dispatchEvent( { type: 'hold', isStart: true, userData: this.detect.hold.userData, } );
            this.resetDetectExcept('hold');
            this.startDetect('hold');
        } 

        if ( this.detect.hold.isCurrent ) {        

            if ( this.global.numConnected === 2 ) this.resetDetect('hold');
            this.dispatchEvent( { type: 'hold', isCurrent: true, userData: this.detect.hold.userData, } );
        
            if ( not( this.global.numConnected === 0 )) return
            this.endDetect('hold');
        } 
        
        if ( this.detect.hold.isEnd ) {            
            this.dispatchEvent( { type: 'hold', isEnd: true, userData: this.detect.hold.userData, } );
            this.delayDetectUntil( XRGestures.DETECT_DELAY, () => this.resetDetectExcept() ); 
        }

    }  
    
    detectPan() {

        if ( not( this.detect.pan.isStart )) {

            if ( not( this.detect.gesture === undefined )) return;
            if ( not( this.global.numConnected === 1 ) ) return;
            if ( not( this.view.radius[ 0 ] > XRGestures.PAN_START_RADIUS_MIN )) return;
            if ( not( this.global.duration[ 0 ] < XRGestures.PAN_START_DURATION_MAX ) ) return;
            if ( not( this.view.radialSpeed[ 0 ] < XRGestures.PAN_RADIAL_SPEED_MAX )) return;
            this.detect.gesture = 'pan';       
            this.dispatchEvent( { type: 'pan', isStart: true, userData: this.detect.pan.userData, } );
            this.resetDetectExcept('pan');
            this.startDetect('pan');
        } 

        if ( this.detect.pan.isCurrent ) {  

            if ( this.global.numConnected === 2 ) this.resetDetect('pan');
            this.dispatchEvent( { type: 'pan', isCurrent: true, userData: this.detect.pan.userData, } );
        
            if ( not( this.global.numConnected === 0 ) ) return
            this.endDetect('pan');
        } 
        
        if ( this.detect.pan.isEnd ) {
            this.dispatchEvent( { type: 'pan', isEnd: true, userData: this.detect.pan.userData, } );
            this.delayDetectUntil( XRGestures.DETECT_DELAY, () => this.resetDetectExcept() );    
        }
    }

    detectGlide() {

        if ( not( this.detect.glide.isStart )) {

            if ( not( this.detect.gesture === undefined )) return;
            if ( not( this.global.numConnected === 1 ) ) return;
            if ( not( this.view.pathLength[ 0 ] > XRGestures.GLIDE_START_PATH_LENGTH_MIN )) return;
            if ( not( this.view.turnDeviation[ 0 ] < XRGestures.GLIDE_START_TURN_DEVIATION_MAX ) ) return;  
            if ( not( this.view.radialSpeed[ 0 ] < XRGestures.GLIDE_START_RADIAL_SPEED_MAX )) return; 
            this.detect.gesture = 'glide';       
            this.detect.glide.direction = this.view.displacement[0].clone().normalize(); // mm
            this.detect.glide.startDistance = this.view.radius[0]; // mm
            this.detect.glide.distance = 0; // mm
            this.dispatchEvent( { type: 'glide', isStart: true, origin: this.detect.glide.origin, direction: this.detect.glide.direction, userData: this.detect.glide.userData, } );
            this.resetDetectExcept('glide');
            this.startDetect('glide');
        } 

        if ( this.detect.glide.isCurrent ) {  

            if ( this.global.numConnected === 2 ) this.resetDetect('glide');
            const previous = this.detect.glide.distance;
            this.detect.glide.distance = this.view.displacement[0].dot( this.detect.glide.direction ) - this.detect.glide.startDistance; // 
            this.detect.glide.delta =  this.detect.glide.distance - previous; // mm
            this.dispatchEvent( { type: 'glide', isCurrent: true, distance: this.detect.glide.distance, delta: this.detect.glide.delta, origin: this.detect.glide.origin, direction: this.detect.glide.direction, userData: this.detect.glide.userData, } );
        
            if ( not( this.global.numConnected === 0 ) ) return
            this.endDetect('glide');
        } 
        
        if ( this.detect.glide.isEnd ) {
            this.dispatchEvent( { type: 'glide', isEnd: true, userData: this.detect.glide.userData, } );
            this.delayDetectUntil( XRGestures.DETECT_DELAY, () => this.resetDetectExcept() );    
        }
    }

    detectSwirl() {
        
        if ( not( this.detect.swirl.isStart )) {

            if ( not( this.detect.gesture === undefined )) return;
            if ( not( this.global.numConnected === 1 ) ) return;
            if ( not( this.view.pathLength[ 0 ] > XRGestures.SWIRL_START_PATH_LENGTH_MIN )) return; 
            if ( not( this.view.turnDeviation[ 0 ] > XRGestures.SWIRL_START_TURN_DEVIATION_MIN ) ) return; 
            this.detect.gesture = 'swirl';       
            this.detect.swirl.startTheta = this.view.angle[ 0 ]; // degrees
            this.detect.swirl.theta = 0; // degrees
            this.dispatchEvent( { type: 'swirl', isStart: true, userData: this.detect.swirl.userData } );
            this.resetDetectExcept('swirl');
            this.startDetect('swirl');
        } 

        if ( this.detect.swirl.isCurrent ) {  

            if ( this.global.numConnected === 2 ) this.resetDetect('swirl');
            const previous = this.detect.swirl.theta; // degrees
            this.detect.swirl.theta = this.view.angle[ 0 ] - this.detect.swirl.startTheta; // degrees
            this.detect.swirl.delta = this.detect.swirl.theta - previous; // degrees
            this.dispatchEvent( { type: 'swirl', isCurrent: true, theta: this.detect.swirl.theta, delta: this.detect.swirl.delta, userData: this.detect.swirl.userData } );
        
            if ( not( this.global.numConnected === 0 ) ) return;
            this.endDetect('swirl');
        } 
        
        if ( this.detect.swirl.isEnd ) {
            this.dispatchEvent( { type: 'swirl', isEnd: true, userData: this.detect.swirl.userData  } );
            this.delayDetectUntil( XRGestures.DETECT_DELAY, () => this.resetDetectExcept() ); 
        }
    }

    detectPinch() {

        if ( not( this.detect.pinch.isStart )) {

            if ( not( this.detect.gesture === undefined )) return;
            if ( not( this.global.numConnected === 2 ) ) return;
            if ( not( Math.abs(this.view.gapDiameter) > XRGestures.PINCH_START_GAP_DIAMETER_MIN ) ) return;
            if ( not( Math.abs(this.view.gapAngle) < XRGestures.PINCH_START_GAP_ANGLE_MAX ) ) return;  
            if ( not( Math.abs(this.view.gapDiametralSpeed) < XRGestures.PINCH_START_GAP_DIAMETRAL_SPEED_MAX )) return;       
            this.detect.gesture = 'pinch';
            this.detect.pinch.startScale = this.view.pairDiameter;
            this.detect.pinch.scale = 0;
            this.dispatchEvent( { type: 'pinch', isStart: true, userData: this.detect.pinch.userData } );
            this.resetDetectExcept('pinch');
            this.startDetect('pinch');
        } 

        if ( this.detect.pinch.isCurrent ) {
            const previous = this.detect.pinch.scale;
            this.detect.pinch.scale = this.view.pairDiameter - this.detect.pinch.startScale;
            this.detect.pinch.delta = this.detect.pinch.scale - previous;
            this.dispatchEvent( { type: 'pinch', isCurrent: true, scale: this.detect.pinch.scale, delta: this.detect.pinch.delta, userData: this.detect.pinch.userData } );
        
            if ( this.global.numConnected === 2 ) return
            this.endDetect('pinch');
        } 
        
        if ( this.detect.pinch.isEnd ) {
            this.dispatchEvent( { type: 'pinch', isEnd: true } );
            this.delayDetectUntil( XRGestures.DETECT_DELAY, () => this.resetDetectExcept() );
        }

    }

    detectTwist() {
        
        if ( not( this.detect.twist.isStart )) {

            if ( not( this.detect.gesture === undefined )) return;
            if ( not( this.global.numConnected === 2 ) ) return;
            if ( not( this.view.pairDiameter > XRGestures.TWIST_START_PAIR_DIAMETER_MIN ) ) return;
            if ( not( Math.abs(this.view.gapDiameter) < XRGestures.TWIST_START_GAP_DIAMETER_MAX ) ) return;
            if ( not( Math.abs(this.view.gapAngle) > XRGestures.TWIST_START_GAP_ANGLE_MIN ) ) return;
            this.detect.gesture = 'twist';
            this.detect.twist.startTheta = this.view.pairAngle;
            this.detect.twist.theta = 0;   
            this.dispatchEvent( { type: 'twist', isStart: true, userData: this.detect.twist.userData, } );                
            this.resetDetectExcept('twist');
            this.startDetect('twist');
        } 

        if ( this.detect.twist.isCurrent ) {
            const previous = this.detect.twist.theta;
            this.detect.twist.theta = this.reduceAngle(this.view.pairAngle - this.detect.twist.startTheta);
            this.detect.twist.delta = this.detect.twist.theta - previous;
            this.dispatchEvent( { type: 'twist', isCurrent: true, theta: this.detect.twist.theta, delta: this.detect.twist.delta, userData: this.detect.twist.userData, } );
        
            if ( this.global.numConnected === 2 ) return;
            this.endDetect('twist');
        } 
        
        if ( this.detect.twist.isEnd ) {
            this.dispatchEvent( { type: 'twist', isEnd: true, userData: this.detect.twist.userData, } );
            this.delayDetectUntil( XRGestures.DETECT_DELAY, () => this.resetDetectExcept() );
        }
    }

    detectExplode() {

        if ( not( this.detect.explode.isStart )) {

            if ( not( this.detect.gesture === undefined )) return;
            if ( not( this.global.numConnected === 2 )) return;
            if ( not( this.view.gapDiameter > XRGestures.EXPLODE_GAP_DIAMETER_MIN )) return;
            if ( not( Math.abs(this.view.gapDiametralSpeed) > XRGestures.EXPLODE_GAP_DIAMETRAL_SPEED_MIN )) return;
            this.startDetect('explode');
            setTimeout( () => this.resetDetect('explode'), XRGestures.EXPLODE_DURATION_MAX );
        }

        if ( this.detect.explode.isCurrent ) {

            if ( not( this.global.numConnected == 0 )) return;        
            this.detect.gesture = 'explode';
            this.resetDetectExcept('explode');
            this.endDetect('explode')
        }

        if ( this.detect.explode.isEnd ) {      
            this.dispatchEvent( { type: 'explode', } );
            this.delayDetectUntil( XRGestures.DETECT_DELAY, () => this.resetDetectExcept() );
        }
    }

    detectImplode() {

        if ( not( this.detect.implode.isStart )) {

            if ( not( this.detect.gesture === undefined )) return;
            if ( not( this.global.numConnected === 2 )) return;
            if ( not( this.view.gapDiameter < XRGestures.IMPLODE_GAP_DIAMETER_MAX )) return;
            if ( not( Math.abs(this.view.gapDiametralSpeed) > XRGestures.IMPLODE_GAP_DIAMETRAL_SPEED_MIN )) return;
            this.startDetect('implode');
            setTimeout( () => this.resetDetect('implode'), XRGestures.IMPLODE_DURATION_MAX );
        }

        if ( this.detect.implode.isCurrent ) {

            if ( not( this.global.numConnected == 0 )) return;        
            this.detect.gesture = 'implode';
            this.resetDetectExcept('implode');
            this.endDetect('implode')
        }

        if ( this.detect.implode.isEnd ) {      
            this.dispatchEvent( { 
                type: 'implode', 
                isStart: true,
                isCurrent: true,
                isEnd: true, 
                userData: this.detect.implode.userData, } );
            this.delayDetectUntil( XRGestures.DETECT_DELAY, () => this.resetDetectExcept() );
        }
    }
    
    detectDualSwipe() {

        if ( not( this.detect.dualswipe.isStart )) {

            if ( not( this.detect.gesture === undefined )) return;
            if ( not( this.global.numConnected === 2 )) return;
            if ( not( this.view.radius[ 2 ] > XRGestures.DUALSWIPE_RADIUS_MIN )) return;
            if ( not( this.view.radialSpeed[ 2 ] > XRGestures.DUALSWIPE_RADIAL_SPEED_MIN )) return;
            if ( not( this.global.duration[ 2 ] < XRGestures.DUALSWIPE_DURATION_MAX )) return;    
            this.startDetect('dualswipe');
        }

        if ( this.detect.dualswipe.isCurrent ) {

            if ( not( this.global.duration[ 2 ] < XRGestures.DUALSWIPE_DURATION_MAX )) this.resetDetect('dualswipe'); 
            if ( not( this.global.numConnected < 2 ) ) return;    
            this.detect.gesture = 'dualswipe';
            this.resetDetectExcept('dualswipe');
            this.endDetect('dualswipe');
        }

        if ( this.detect.dualswipe.isEnd ) { 
            
            const displacement = this.view.displacement[ 2 ];
            const direction = 
                ( displacement.y >  Math.abs(displacement.x) ) ? "UP"    :
                ( displacement.y < -Math.abs(displacement.x) ) ? "DOWN"  :
                ( displacement.x >  Math.abs(displacement.y) ) ? "RIGHT" :
                ( displacement.x < -Math.abs(displacement.y) ) ? "LEFT"  : 
                undefined
            ;

            if ( direction ) {
                this.dispatchEvent( { type: 'dualswipe', direction: direction, userData: this.detect.dualswipe.userData } );
                this.delayDetectUntil( XRGestures.DETECT_DELAY, () => this.resetDetectExcept() );
                
            } else this.resetDetectExcept();  
        
        }
            
    }

    detectDualPan() {
        
        if ( not( this.detect.dualpan.isStart )) {

            if ( not( this.detect.gesture === undefined )) return;
            if ( not( this.global.numConnected === 2 ) ) return;
            if ( not( this.view.radius[ 0 ] > XRGestures.DUALPAN_START_RADIUS_MIN ) ) return;
            if ( not( this.view.radius[ 1 ] > XRGestures.DUALPAN_START_RADIUS_MIN ) ) return;
            if ( not( this.view.radialSpeed[ 0 ] < XRGestures.DUALPAN_RADIAL_SPEED_MAX )) return;
            if ( not( this.view.radialSpeed[ 1 ] < XRGestures.DUALPAN_RADIAL_SPEED_MAX )) return;
            if ( not( this.global.duration[ 2 ] < XRGestures.DUALPAN_START_DURATION_MAX ) ) return;
            this.detect.gesture = 'dualpan';       
            this.dispatchEvent( { type: 'dualpan', isStart: true, userData: this.detect.dualpan.userData, } );
            this.resetDetectExcept('dualpan');
            this.startDetect('dualpan');
        } 

        if ( this.detect.dualpan.isCurrent ) {           
            this.dispatchEvent( { type: 'dualpan', isCurrent: true, userData: this.detect.dualpan.userData, } );
        
            if ( this.global.numConnected === 2 ) return
            this.endDetect('dualpan');
        } 
        
        if ( this.detect.dualpan.isEnd ) {
            this.dispatchEvent( { type: 'dualpan', isEnd: true, userData: this.detect.dualpan.userData, } );
            this.delayDetectUntil( XRGestures.DETECT_DELAY, () => this.resetDetectExcept() );
        }

    }
    
    detectDualHold() {

        if ( not( this.detect.dualhold.isStart )) {

            if ( not( this.detect.gesture === undefined )) return;
            if ( not( this.global.numConnected === 2 ) ) return;
            if ( not( this.view.radius[ 0 ] < XRGestures.DUALHOLD_START_RADIUS_MAX ) ) return;
            if ( not( this.view.radius[ 1 ] < XRGestures.DUALHOLD_START_RADIUS_MAX ) ) return;
            if ( not( this.global.duration[ 2 ] > XRGestures.DUALHOLD_START_DURATION_MIN ) ) return;
            this.detect.gesture = 'dualhold';
            this.dispatchEvent( { type: 'dualhold', isStart: true } );
            this.resetDetectExcept('dualhold');
            this.startDetect('dualhold');
        } 

        if ( this.detect.dualhold.isCurrent ) {        
            this.dispatchEvent( { type: 'dualhold', isCurrent: true } );
        
            if ( this.global.numConnected === 2 ) return
            this.endDetect('dualhold');
        } 
        
        if ( this.detect.dualhold.isEnd ) {    
            this.dispatchEvent( { type: 'dualhold', isEnd: true } );
            this.delayDetectUntil( XRGestures.DETECT_DELAY, () => this.resetDetectExcept() );
        }
        
    }

    // update global variables
    
    updateGlobalVariables() {
        
    }

    updateIntersections( i ) {
        this.global.raycaster[ i ].ray.origin.copy(  this.world.center[ i ] );
        this.global.raycaster[ i ].ray.direction.copy( this.world.handDirection[ i ] );

        if ( this.global.toIntersect[ i ].length ) {
            this.global.intersections[ i ] = this.global.raycaster[ i ].intersectObjects( this.global.toIntersect[ i ], false );
        };        
    }

    updateLaser( i ) {
        this.global.laser[ i ].position.copy( this.global.raycaster[ i ].ray.origin );
        this.global.laser[ i ].setDirection( this.global.raycaster[ i ].ray.direction );

        if ( this.global.intersections[ i ] ) {
            this.global.laser[ i ].setLength( this.global.intersections[ i ].distance );

        } else {
            this.global.laser[ i ].setLength( 3 );
        }
    }

    // update world variables

    resetWorldVariables( i ) {
        
        if ( this.global.isConnected[ i ] ) return;        
        this.world.handDirection[ i ] = new THREE.Vector3();
        this.world.pastPositions[ i ] = [];
        this.world.smoothPositions[ i ] = [];
    }

    updateWorldVariables( i ) {
        
        // this.updateWorldViewDirection();
        this.updateWorldHandDirection( i );
        this.updateWorldPastPositions( i );
        this.updateWorldSmoothPositions( i );
    }
   
    updateWorldViewDirection() {
        this.global.headset.getWorldDirection( this.world.viewDirection );
        // console.log(`viewDirection: x=${this.world.viewDirection.x.toFixed(2)}, y=${this.world.viewDirection.y.toFixed(2)}, z=${this.world.viewDirection.z.toFixed(2)}`)
    }
   
    updateWorldHandDirection( i ) {
        
        if ( i in [0, 1] ) {
            this.global.controller[ i ].getWorldDirection( this.world.handDirection[ i ] );
            this.world.handDirection[ i ].negate();

        } else {
            this.world.handDirection[ 2 ] = new THREE.Vector3()
            .add( this.world.handDirection[0] )
            .add( this.world.handDirection[1] )
            .normalize();
        }

        // console.log(`handDirection: x=${this.world.handDirection[i].x.toFixed(2)}, y=${this.world.handDirection[i].y.toFixed(2)}, z=${this.world.handDirection[i].z.toFixed(2)}`)
    }

    updateWorldPastPositions( i ) {    
        const position = (i in [0, 1])
            ? this.global.controller[i].position.clone() // m
            : new THREE.Vector3()
            .add( this.global.controller[0].position )
            .add( this.global.controller[1].position )
            .divideScalar( 2 ); // m
        ;
        this.world.pastPositions[ i ].unshift( position ); 

        if ( this.world.pastPositions[ i ].length <= XRGestures.PAST_LENGTH ) return;
        this.world.pastPositions[ i ].pop();       
    }

    updateWorldSmoothPositions( i ) { 
        const positions = this.world.pastPositions[ i ]; // mm
        if ( !positions ) return;

        const portion = positions.slice( 0, XRGestures.SMOOTH_WINDOW );
        const average = portion.reduce( (sum, p) => sum.add( p ), new THREE.Vector3() ).divideScalar( portion.length );
        this.world.smoothPositions[ i ].unshift( average ); 

        if ( this.world.smoothPositions[ i ].length <= XRGestures.PAST_LENGTH ) return;
        this.world.smoothPositions[ i ].pop();       
    }

    updateWorldCenter( i ) {
        const center = (i in [0, 1])
            ? this.global.controller[i].position.clone() // m
            : new THREE.Vector3()
            .add( this.global.controller[0].position )
            .add( this.global.controller[1].position )
            .divideScalar( 2 ); // m
        ;
        this.world.center[ i ] = center; // mm
    }
   
    // update view variables

    resetViewVariables( i ) {

        if ( this.global.isConnected[ i ] ) return;        
        this.view.center[ i ]          = new THREE.Vector2();
        this.view.displacement[ i ]    = new THREE.Vector2();
        this.view.radius[ i ]          = 0;
        this.view.angle[ i ]           = 0;
        this.view.turnAngle[ i ]       = 0;
        this.view.pathLength[ i ]      = 0;
        this.view.radialSpeed[ i ]     = 0;
        this.view.angularSpeed[ i ]    = 0;
        this.view.turnDeviation[ i ]   = 0;
        this.view.coverSpeed[ i ]      = 0;
        this.view.smoothPositions[ i ] = [];
        this.view.pastPositions[ i ]   = [];
        this.view.pastAngles[ i ]      = [];

        if ( i in [0, 1] ) return; 
        this.view.pairCenter           = new THREE.Vector2();
        this.view.pairAxis             = new THREE.Vector2();
        this.view.pairDisplacement     = new THREE.Vector2();
        this.view.pairDiameter         = 0;
        this.view.pairAngle            = 0;
        this.view.gapDiameter          = 0;
        this.view.gapAngle             = 0;
        this.view.gapDiametralSpeed    = 0;
        this.view.gapAngularSpeed      = 0;
    }
     
    updateViewVariables( i ) {

        this.updateViewPastPositions( i );
        this.updateViewSmoothPositions( i ); 
        this.updateViewAngle( i ); 
        this.updateViewPastAngles( i );
        this.updateViewDisplacement( i );
        this.updateViewRadius( i );
        this.updateViewRadialSpeed( i );   
        this.updateViewAngularSpeed( i );   
        this.updateViewPathLength( i );
        this.updateViewCoverSpeed( i );   
        this.updateViewTurnAngle( i );
        this.updateViewTurnDeviation( i );   
        
        /* debugging */ {
            // console.log(`view: position: x=${this.view.pastPositions[i][0].x.toFixed(4)}, y=${this.view.pastPositions[i][0].y.toFixed(4)}`)
            // console.log(`view: smoothPosition: x=${this.view.smoothPositions[i][0].x.toFixed(4)}, y=${this.view.smoothPositions[i][0].y.toFixed(4)}`)
            // console.log(`view: center: x=${this.view.center[i].x.toFixed(4)}, y=${this.view.center[i].y.toFixed(4)}`)
            // console.log(`view: displacement: x=${this.view.displacement[i].x.toFixed(4)}, y=${this.view.displacement[i].y.toFixed(4)}`)
            // console.log(`view: radius=${this.view.radius[i].toFixed(4)}, pathLength=${this.view.pathLength[i].toFixed(2)}`);
            // console.log(`view: angle=${this.view.angle[i].toFixed(2)}, turnAngle=${this.view.turnAngle[i].toFixed(2)}`);
            // console.log(`view: turnDeviation=${this.view.turnDeviation[i].toFixed(2)}`);
            // console.log(`view: length=${this.view.pastPositions[i].length}`);
        }
    
        if ( i in [0, 1] ) return;   
        this.updateViewPairCenter();
        this.updateViewPairDisplacement();
        this.updateViewPairDiameter();
        this.updateViewPairAngle();
        this.updateViewGapDiameter();
        this.updateViewGapAngle();
        this.updateViewGapDiametralSpeed();
        this.updateViewGapAngularSpeed();

        /* debugging */ {
            // console.log(`view: smoothPosition: x=${this.view.smoothPositions[i][0].x.toFixed(4)}, y=${this.view.smoothPositions[i][0].y.toFixed(4)}`)
            // console.log(`view: pairCenter:   x=${this.view.pairCenter.x.toFixed(2)}, y=${this.view.pairCenter.y.toFixed(2)}`)
            // console.log(`view: radius=${this.view.radius[i].toFixed(4)}, pathLength=${this.view.pathLength[i].toFixed(2)}`);
            // console.log(`view: angle=${this.view.angle[i].toFixed(2)}, turnAngle=${this.view.turnAngle[i].toFixed(2)}`);
            // console.log(`view: pairDiameter=${this.view.pairDiameter.toFixed(3)}, pairAngle=${this.view.pairAngle.toFixed(3)}`);
            // console.log(`view: gapDiameter=${this.view.gapDiameter.toFixed(3)}, gapAngle=${this.view.gapAngle.toFixed(3)}`);
            // console.log(`view: gapDiametralSpeed=${(this.view.gapDiametralSpeed*1e+3).toFixed(4)}, gapAngularSpeed=${(this.view.gapAngularSpeed*1e+3).toFixed(4)}`);
        }
    }  
  
    updateViewPastPositions( i ) {    
        const vector = (i in [0, 1])
            ? this.global.controller[i].position.clone() // m
            : this.global.controller
            .reduce( (sum, ctrl) => sum.add(ctrl.position.clone()), new THREE.Vector3())
            .divideScalar( 2 ); // m
        ;
        const position = this.toScreenUnits( vector.project( this.global.headset ) ); // mm
        this.view.pastPositions[ i ].unshift( position ); 

        if ( this.view.pastPositions[ i ].length <= XRGestures.PAST_LENGTH ) return;
        this.view.pastPositions[ i ].pop();       
    }

    updateViewSmoothPositions( i ) { 
        const pastPositions = this.view.pastPositions[ i ]; // mm
        if ( !pastPositions ) return;

        const windowPositions = pastPositions.slice( 0, XRGestures.SMOOTH_WINDOW );
        const position = windowPositions.reduce((sum, point) => sum.add(point), new THREE.Vector2()).divideScalar( windowPositions.length );  // mm
        this.view.smoothPositions[ i ].unshift( position ); 

        if ( this.view.smoothPositions[ i ].length <= XRGestures.PAST_LENGTH ) return;
        this.view.smoothPositions[ i ].pop();       
    }

    updateViewPathLength( i ) {
        const position0 = this.view.smoothPositions[ i ][ 0 ]; // mm
        const position1 = this.view.smoothPositions[ i ][ 1 ]; // mm
        if ( !position1 ) return;

        const tangent = new THREE.Vector2().subVectors( position0, position1 ).length();
        const length = ( tangent > 1e-2 ) ? tangent : 0
        this.view.pathLength[ i ] += length; // mm
    }

    updateViewCenter( i ) {
        const position = (i in [0, 1])
            ? this.global.controller[i].position.clone() // m
            : this.global.controller
            .reduce( (sum, ctrl) => sum.add( ctrl.position ), new THREE.Vector3())
            .divideScalar( 2 ); // m
        ;
        const center = this.toScreenUnits( position.project( this.global.headset ) ); // mm
        this.view.center[ i ] = center; // mm
    }

    updateViewDisplacement( i ) {
        const center = this.view.center[ i ]; // mm
        const position = this.view.smoothPositions[ i ][ 0 ]; // mm
        const displacement = new THREE.Vector2().subVectors( position, center ); // mm 
        this.view.displacement[ i ] = displacement; // mm
    }

    updateViewRadius( i ) {
        const radius = this.view.displacement[ i ].length(); // mm
        this.view.radius[ i ] = radius; // mm
    }
    
    updateViewAngle( i ) {   
        const displacement = this.view.displacement[ i ]; // mm
        const angle0 = ( displacement.length() > 0.1 ) ? Math.atan2( displacement.y, displacement.x ) * 180/Math.PI : 0; // degrees                
        const angle1 = this.view.angle[ i ]; // degrees
        const diff = angle0 - angle1; // degrees  
        const step = ( Math.abs(diff) > 180 ) ? diff - 360 * Math.sign(diff) : diff; // degrees
        this.view.angle[ i ] += step ; // degrees    
    }

    updateViewPastAngles( i ) {
        const angle = this.view.angle[ i ]; // degrees
        this.view.pastAngles[ i ].unshift( angle ); // degrees

        if ( this.view.pastAngles[ i ].length <= XRGestures.PAST_LENGTH ) return;
        this.view.pastAngles[ i ].pop();
    }

    updateViewTurnAngle( i ) {
        const position0 = this.view.smoothPositions[ i ][ 0 ]; // mm
        const position1 = this.view.smoothPositions[ i ][ 1 ]; // mm
        if ( !position1 ) return;

        const angle0 = this.view.pastAngles[ i ][ 0 ]; // degrees  
        const angle1 = this.view.pastAngles[ i ][ 1 ]; // degrees 
        const stepAngle = ( angle1 ) ? angle0 - angle1 : 0; // degrees  
        const stepLength = position0.distanceTo( position1 ); // mm    

        const step = ( Math.abs(stepAngle) > 1 && stepLength > 0.2 ) ?  Math.abs(stepAngle) : 0;
        this.view.turnAngle[ i ] += step ; // degrees    
    } 

    updateViewRadialSpeed( i ) {
        const radius = this.view.radius[ i ];  // mm
        const duration = this.global.duration[ i ];  // ms
        const speed = radius / duration;
        this.view.radialSpeed[ i ] = speed;
    } 

    updateViewCoverSpeed( i ) {
        const length = this.view.pathLength[ i ];  // mm
        const duration = this.global.duration[ i ];  // ms
        const speed = length / duration;
        this.view.coverSpeed[ i ] = speed;
    }

    updateViewAngularSpeed( i ) {
        const angle = this.view.angle[ i ];  // degrees
        const duration = this.global.duration[ i ];  // ms
        const speed = angle / duration;
        this.view.angularSpeed[ i ] = speed;
    }

    updateViewTurnDeviation( i ) {
        const angle = this.view.turnAngle[ i ];    // degrees
        const length = this.view.pathLength[ i ];  // mm
        const deviation = ( length > 0.01 ) ? angle / length : 0; 
        this.view.turnDeviation[ i ] = deviation;
    }   

    updateViewPairAxis() {
        const projection = this.global.controller.map( c => c.position.clone().project( this.global.headset ) ); // NCD
        const position = projection.map( p => this.toScreenUnits( p ) ); // mm
        const axis =( this.global.clock[0].startTime <= this.global.clock[1].startTime ) // mm
            ? new THREE.Vector2().subVectors( position[1], position[0] ) 
            : new THREE.Vector2().subVectors( position[0], position[1] )
        ;
        this.view.pairAxis = axis; // mm
    }

    updateViewPairCenter() {
        const center = this.view.smoothPositions[ 2 ][ 0 ]; // mm
        this.view.pairCenter = center; // mm
    }

    updateViewPairDisplacement() {
        const position = [0, 1].map( i => this.view.smoothPositions[ i ][ 0 ] ); // mm
        if ( position.includes(undefined) ) return;

        const displacement = ( this.global.clock[0].startTime <= this.global.clock[1].startTime ) // mm
            ? new THREE.Vector2().subVectors( position[1], position[0] ) 
            : new THREE.Vector2().subVectors( position[0], position[1] )
        ;
        this.view.pairDisplacement = displacement; // mm
    }

    updateViewPairDiameter() {
        const displacement = this.view.pairDisplacement; // mm
        const diameter = displacement.length(); // mm
        this.view.pairDiameter = diameter; // mm
    }

    updateViewPairAngle() {
        const displacement = this.view.pairDisplacement;  // mm
        const angle0 = ( displacement.length() > 0 ) ? Math.atan2( displacement.y, displacement.x ) * 180/Math.PI : 0; // degrees      
        const angle1 = this.view.pairAngle; // degrees
        const diff = angle0 - angle1; // degrees  
        const step = ( Math.abs(diff) > 180 ) ? diff - 360 * Math.sign(diff) : diff; // degrees
        this.view.pairAngle += step ; // degrees    
    } 

    updateViewGapDiameter() {
        const axis = this.view.pairAxis; // mm
        if ( !axis ) return; 
        
        const diameter = this.view.pairDisplacement.length(); // mm
        const gapDiameter = diameter - axis.length(); // mm
        this.view.gapDiameter = gapDiameter; // mm
    }

    updateViewGapAngle() {
        const axis = this.view.pairAxis; // mm
        if ( !axis ) return; 

        const angle = this.view.pairAngle; // degrees
        const angleAxis = ( axis.length() > 0 ) ? Math.atan2( axis.y, axis.x ) * 180/Math.PI : 0; // degrees      
        const gapAngle = angle - angleAxis; // degrees
        this.view.gapAngle = gapAngle ; // degrees 
    }

    updateViewGapDiametralSpeed() {
        const diameter = this.view.gapDiameter; // mm
        const duration = this.global.duration[ 2 ];  // ms
        const speed = diameter / duration;
        this.view.gapDiametralSpeed = speed;
    }

    updateViewGapAngularSpeed() {
        const angle = this.view.gapAngle;
        const duration = this.global.duration[ 2 ];  // ms
        const speed = angle / duration;
        this.view.gapAngularSpeed = speed;
    }

    // helper functions

    startDetect( type ) {

        if( !this.detect.gestureTypes.includes( type ) ) return;
        this.detect[type].isStart = true;
        this.detect[type].isCurrent = true;
    }

    endDetect( type ) {

        if( !this.detect.gestureTypes.includes( type ) ) return;
        this.detect[type].isCurrent = false;
        this.detect[type].isEnd = true;
    }

    resetDetect( type ) {

        if( !this.detect.gestureTypes.includes( type ) ) return;
        this.detect[type].isStart = false;
        this.detect[type].isCurrent = false;
        this.detect[type].isEnd = false;
    }

    resetDetectExcept( type ) {

        this.detect.gestureTypes.forEach( (gesture) => { 
            if( not( type === gesture)) this.resetDetect( gesture ); 
        });        

        if ( type === undefined ) this.detect.gesture = undefined;
    }

    delayDetectUntil( delay = XRGestures.DETECT_DELAY, onDelayEnd = () => {} ) {
        this.detect.isDelayed = true;
        setTimeout(() => { this.detect.isDelayed = false; onDelayEnd() }, delay);
    }

    reduceAngle( theta ) {
        return ((theta + 180) % 360 + 360) % 360 - 180;
    }

    reduceBranch( theta ) {
        return Math.floor((theta + 180) / 360);
    }

    getScreenSize() {       
         
        //DPI IS DEVICE SPECIFIC FOR GOOGLE PIXEL 4 ONLY
        const DPR = this.global.renderer.getPixelRatio();
        const DPI = 2 * DPR * 76; // factor of 2 due to high density, 76 or 96 in some cases. 

        const canvasPixels = this.global.renderer.getSize( new THREE.Vector2() ); // logical pixels
        const screenPixels = new THREE.Vector2().copy( canvasPixels ).multiplyScalar( DPR ); // physical pixels
        const screenSize = new THREE.Vector2().copy( screenPixels ).divideScalar( DPI  ); // physical pixels to inches
        screenSize.multiplyScalar( 25.4 ); // inches to mm

        return screenSize;
    }

    toScreenUnits( position ) {
        return position.clone().divideScalar( 2 ).multiply( this.global.screenSize ); // NDC to mm
    }

    toNormalizedUnits( position ) {    
        return position.clone().divide( this.global.screenSize ).multiplyScalar( 2 ); // mm to NDC
    }

}

XRGestures.UP_VECTOR = new THREE.Vector3( 0, 1, 0 ) ;
XRGestures.RIGHT_VECTOR = new THREE.Vector3( 1, 0, 0 );

XRGestures.PAST_LENGTH = 1; 
XRGestures.SMOOTH_WINDOW = 1;

XRGestures.CONTROLLER_DELAY = 20; // ms    
XRGestures.DETECT_DELAY = 200; // ms

XRGestures.TAP_RADIUS_MAX = 10; // mm
XRGestures.TAP_DURATION_MAX = 150; // ms

XRGestures.POLYTAP_DURATION = 500; // ms

XRGestures.SWIPE_RADIUS_MIN = 12; // mm
XRGestures.SWIPE_RADIAL_SPEED_MIN = 0.1; // mm/ms
XRGestures.SWIPE_DURATION_MAX = 300; // ms

XRGestures.HOLD_START_DURATION_MIN = 500; // ms
XRGestures.HOLD_START_RADIUS_MAX = 2; // mm

XRGestures.PAN_START_DURATION_MAX = 500; // ms
XRGestures.PAN_START_RADIUS_MIN = 2; // mm
XRGestures.PAN_RADIAL_SPEED_MAX = 0.1; // mm/ms

XRGestures.GLIDE_START_RADIAL_SPEED_MAX = 0.08; // mm/ms
XRGestures.GLIDE_START_PATH_LENGTH_MIN = 5; // mm
XRGestures.GLIDE_START_TURN_DEVIATION_MAX = 0.85; // degrees/mm

XRGestures.SWIRL_START_PATH_LENGTH_MIN = 5; // mm
XRGestures.SWIRL_START_TURN_DEVIATION_MIN = 0.85; // degrees/mm

XRGestures.PINCH_START_GAP_DIAMETER_MIN = 10; // mm
XRGestures.PINCH_START_GAP_ANGLE_MAX = 20; // degrees
XRGestures.PINCH_START_GAP_DIAMETRAL_SPEED_MAX = 0.08; // mm/ms

XRGestures.TWIST_START_GAP_DIAMETER_MAX = 10; // mm
XRGestures.TWIST_START_PAIR_DIAMETER_MIN = 30; // mm
XRGestures.TWIST_START_GAP_ANGLE_MIN = 20; // degrees

XRGestures.EXPLODE_GAP_DIAMETER_MIN = 10; // mm 
XRGestures.EXPLODE_GAP_DIAMETRAL_SPEED_MIN = 0.1; // mm 
XRGestures.EXPLODE_DURATION_MAX = 300; // ms

XRGestures.IMPLODE_GAP_DIAMETER_MAX = -10; // mm 
XRGestures.IMPLODE_GAP_DIAMETRAL_SPEED_MIN = 0.1; // mm 
XRGestures.IMPLODE_DURATION_MAX = 300; // ms

XRGestures.DUALSWIPE_RADIUS_MIN = 25; // mm
XRGestures.DUALSWIPE_RADIAL_SPEED_MIN = 0.01; // mm/ms
XRGestures.DUALSWIPE_DURATION_MAX = 400; // ms

XRGestures.DUALPAN_START_DURATION_MAX = 500; // ms
XRGestures.DUALPAN_START_RADIUS_MIN = 2; // mm
XRGestures.DUALPAN_RADIAL_SPEED_MAX = 0.1; // mm/ms

XRGestures.DUALHOLD_START_DURATION_MIN = 500; // ms
XRGestures.DUALHOLD_START_RADIUS_MAX = 2; // mm

export { XRGestures };