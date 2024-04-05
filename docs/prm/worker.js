import 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest'
import 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.14.0/ort.wasm.min.js'

ort.env.wasm.wasmPaths = "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.14.0/"

let tensor, embedding, encoder, decoder, image;

self.onmessage = async (event) => {

  let { type, input } = event.data;

  if ( type === 'load' ) {

    let start = Date.now(); 

    ort.env.wasm.numThreads = 1;
    
    encoder = await ort.InferenceSession.create( "mobilesam.encoder.onnx" ); 
    decoder = await ort.InferenceSession.create( "mobilesam.decoder.quant.onnx" );

    // console.log("Encoder Session", encoder);
    // console.log("Decoder session", decoder);
  
    self.postMessage({
      type: "load",    
      output: {
        time: ( Date.now() - start ) / 1000,
      }, 
    });

  }

  if ( type === "encode" ) {

    try {

      let start = Date.now(); 

      image  = input;
      tensor = tf.tensor( image.data, [image.width, image.height, 1], 'float32' ); 

      // normalize image histogram 
      const moments = tf.moments( tensor );
      tensor = tensor.sub( moments.mean ).div( moments.variance.sqrt() );

      // normalize image values 
      tensor = tf.div( tensor.sub( tensor.mean() ), tensor.max().sub( tensor.min() ) ).mul( 255 ); 
      
      // prepare formatting
      tensor = tf.image.resizeBilinear( tensor, [1024, 1024] ); 
      tensor = tf.image.grayscaleToRGB( tensor );
  
      ort.env.wasm.numThreads = 5;   
      let feeds = { input_image: new ort.Tensor( tensor.dataSync(), tensor.shape ) };
      let results = await encoder.run( feeds ); // image_embeddings
  
      embedding = results.image_embeddings;

      // console.log( 'Encoding result:', results );

      self.postMessage({
        type: "encode",    
        output: {
          embedding: embedding,
          time: ( Date.now() - start ) / 1000,
        }, 
      });


    } catch ( error ) {

      console.log( `caught error: ${error}` );

    } 

  }

  if ( type === 'decode' ) {

    try {

      const start = Date.now();

      ort.env.wasm.numThreads = 5;   

      input.points = input.points.map( point => point.map( x => Math.round( 1024 * x ) ) );

      let feeds = {
        image_embeddings: embedding,
        point_coords:   new ort.Tensor( new Float32Array( input.points.flat() ), [1, input.points.length, 2]  ),
        point_labels:   new ort.Tensor( new Float32Array( input.labels ), [1, input.labels.length] ),  // label can be 0 or -1
        mask_input:     new ort.Tensor( new Float32Array( 256 * 256 ), [1, 1, 256, 256] ),
        has_mask_input: new ort.Tensor( new Float32Array( [0] ), [1] ),
        orig_im_size:   new ort.Tensor( new Float32Array( [image.width, image.height] ), [2] ),
      }

      let results = await decoder.run( feeds ); // results = masks, iou_predictions, low_res_masks 
      
      tensor = tf.tensor( results.masks.data, results.masks.dims ).squeeze();
      tensor = tf.mul( tensor, 255 ).maximum( 0 ).minimum( 255 );  
      tensor = tf.greater( tensor, 0 ).mul( 255 );

      // console.log( "Generated mask:", results );

      self.postMessage({
        type: "decode",
        output: { 
          mask: tensor.dataSync(), 
          time: ( Date.now() - start ) / 1000,
        },
      });

      
    } catch (error) {

      console.log(`caught error: ${error}`);
      
    }  

  }


};
