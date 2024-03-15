import 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest'
import 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.14.0/ort.wasm.min.js'

ort.env.wasm.wasmPaths = "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.14.0/"

let image;
let embedding;  
let encoder
let decoder

self.onmessage = async (event) => {

  let { type, data } = event.data;

  if ( type === 'load' ) {

    ort.env.wasm.numThreads = 1;
    
    encoder = await ort.InferenceSession.create( "mobilesam.encoder.onnx" );
    decoder = await ort.InferenceSession.create( "mobilesam.decoder.quant.onnx" );

    console.log("Encoder Session", encoder);
    console.log("Decoder session", decoder);

  }

  if ( type === "encode" ) {

    ort.env.wasm.numThreads = 1;   

    image = data; // imageData format

    let tensor = await ort.Tensor.fromImage( image, options = { resizedWidth: 1024, resizedHeight: 684 } );
    tensor = tf.tensor( tensor.data, tensor.dims );
    tensor = tensor.reshape([3, 684, 1024]);
    tensor = tensor.transpose([1, 2, 0]).mul(255);
    tensor = new ort.Tensor( await tensor.data(), tensor.shape );

    let results;
    const feeds = { input_image: tensor };

    let start = Date.now(); 
    
    try {

      // results = image_embeddings
      results = await encoder.run( feeds );
      
      embedding = results.image_embeddings;
      
      console.log( 'Encoding result:', results );

    } catch ( error ) {

      console.log( `caught error: ${error}` );

    } 
  
    let end = Date.now(); 

    self.postMessage({
      type: "encode",    
      data: {}, 
    });

    console.log( `Computing image embedding took ${(end - start) / 1000} seconds` );

  }

  if ( type === 'decode' ) {

    ort.env.wasm.numThreads = 1;   

    const points  = new ort.Tensor( new Float32Array( data.points.flat() ), [1, data.points.flat().length, 2]  );
    const labels  = new ort.Tensor( new Float32Array( data.labels.flat() ), [1, data.labels.flat().length,] );
    const mask    = new ort.Tensor( new Float32Array(256 * 256), [1, 1, 256, 256] );
    const hasMask = new ort.Tensor( new Float32Array([0]), [1] );
    const size    = new ort.Tensor( new Float32Array([image.height, image.width]), [2] );
  
    const feeds = {
      image_embeddings: embedding,
      point_coords: points,
      point_labels: labels,
      mask_input: mask,
      has_mask_input: hasMask,
      orig_im_size: size,
    };
  
    let results;

    start = Date.now();

    try {

      // results = masks, iou_predictions, low_res_masks 
      results = await decoder.run( feeds );

      console.log("Generated mask:", masks);
     
      
    } catch (error) {

      console.log(`caught error: ${error}`);
      
    }  

    end = Date.now(); 

  
    self.postMessage({
      type: "decode",
      data: { 
        masks: results.masks.toImageData(), 
      },
    });

    console.log(`generating masks took ${(end - start) / 1000} seconds`);

  }


};
