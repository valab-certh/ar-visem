import { AutoModel, AutoProcessor, RawImage, Tensor } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0';

self.onmessage = async (event) => {

    const { data, width, height, channels, points } = event.data;

    const modelID = 'Xenova/slimsam-77-uniform'; //'Xenova/slimsam-77-uniform', // 'Xenova/medsam-vit-base'
    const model = await AutoModel.from_pretrained( modelID );
    const processor = await AutoProcessor.from_pretrained( modelID );

    const image = await new RawImage( data, width, height, channels);
    const inputs = await processor( image, points );
    const outputs = await model(inputs);
    
    const tensor = await processor.post_process_masks( outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes );
    const masks = await RawImage.fromTensor( tensor[0][0] );

    self.postMessage({
        type: 'result',
        data: {
            mask: masks,
            scores: outputs.iou_scores.data,
        },
    });   

};
