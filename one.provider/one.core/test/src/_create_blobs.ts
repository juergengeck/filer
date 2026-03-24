/*
  eslint-disable no-console,
  @typescript-eslint/no-use-before-define,
  @typescript-eslint/no-unsafe-call
 */

import type {BLOB, CLOB} from '../../lib/recipes.js';
import type {FileCreation} from '../../lib/storage-base-common.js';
import {storeArrayBufferAsBlob, storeUTF8Clob} from '../../lib/storage-blob.js';

export async function createBlobsAndClobs(): Promise<{
    blobs: [FileCreation<BLOB>, FileCreation<BLOB>];
    clobs: [FileCreation<CLOB>, FileCreation<CLOB>];
}> {
    // Some BLOBs and CLOBs to sprinkle them in as true leaf nodes
    const uint8Array1 = new Uint8Array(Math.round(Math.random() * 20000) + 10000);

    for (let j = 0; j < uint8Array1.byteLength; j++) {
        uint8Array1[j] = 255 - (j % 256);
    }

    const blobResult1 = await storeArrayBufferAsBlob(uint8Array1.buffer);

    const uint8Array2 = new Uint8Array(Math.round(Math.random() * 5000) + 4000);

    for (let j = 0; j < uint8Array2.byteLength; j++) {
        uint8Array2[j] = j % 256;
    }

    const blobResult2 = await storeArrayBufferAsBlob(uint8Array2.buffer);

    const clobResult1 = await storeUTF8Clob(
        `
<h2>5.3 Somatosensory Neurons have Receptive Fields</h2>h2>

<p>Each subcortical somatosensory neuron responds to modality-specific stimuli applied to a specific
region of the body or face.</p>

<p>For example, an axon in the medial lemniscus (i.e., the fiber tract) that responds to tactile
stimulation of the right index finger pad will not respond to tactile stimulation of any other
area in the hand, body or face. The stimulated area producing the response is called the neuron’s
receptive field (Figure 5.3). The neuron’s receptive field can also be defined anatomically as
that area of the sense organ (i.e., skin, muscles or joints) innervated directly or indirectly by
the neuron. Consequently, a somatosensory neuron can be described to channel information about
stimulus location - as well as stimulus modality. Furthermore, the size of a neuron’s receptive
field is related to the body area innervated/represented. The receptive fields of neurons
innervating/representing the finger pads, lips, and tongue are the smallest, whereas those of
neurons innervating/representing the shoulders, back and legs are the largest. For greater
accuracy in locating the point of stimulus contact or movement, smaller cutaneous receptive fields
are required. For fine motor control, as in playing the piano or speaking, small proprioceptive
receptive fields are required.</p>

`.repeat(5)
    );

    const clobResult2 = await storeUTF8Clob(
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor' +
            ' incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud' +
            ' exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure' +
            ' dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.' +
            ' Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt' +
            ' mollit anim id est laborum.\n\n'.repeat(10)
    );

    return {
        blobs: [blobResult1, blobResult2],
        clobs: [clobResult1, clobResult2]
    };
}
