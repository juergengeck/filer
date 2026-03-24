import type {BlobDescriptor} from '../recipes/BlobRecipes.js';
import {createFileWriteStream} from '@refinio/one.core/lib/system/storage-streams.js';
import type {UnversionedObjectResult} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';

export async function storeFileWithBlobDescriptor(
    file: File
): Promise<UnversionedObjectResult<BlobDescriptor>> {
    const stream = createFileWriteStream();
    stream.write(await file.arrayBuffer());
    const blob = await stream.end();

    const {lastModified, name, size, type} = file;

    const blobDescriptor: BlobDescriptor = {
        $type$: 'BlobDescriptor',
        data: blob.hash,
        lastModified,
        name,
        size,
        type
    };

    return await storeUnversionedObject(blobDescriptor);
}
