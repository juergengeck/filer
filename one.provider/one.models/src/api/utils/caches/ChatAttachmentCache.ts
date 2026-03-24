import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {OneObjectTypes} from '@refinio/one.core/lib/recipes.js';
import {OEvent} from '../../../misc/OEvent.js';

/**
 * This cache caches attachments stored as blob descriptors.
 *
 * This is necessary, because on rerender of chat messags we do not want to load attachments again. This would take too
 * much time because we would have to load them and the browser would have to decode them again.
 */
export default class ChatAttachmentCache {
    public onUpdate = new OEvent<() => void>();
    public onError = new OEvent<(error: any) => void>();

    private isInitialized = true;
    private cache = new Map<SHA256Hash, OneObjectTypes | undefined>();

    /**
     * Cleanup the instance.
     *
     * After this function is called this class cannot be reused.
     */
    public shutdown() {
        this.isInitialized = false;
        this.cache.clear();
    }

    /**
     * Loads an attachment asynchronously and emits onUpdate event when it is done.
     *
     * For the moment nothing is monitored after the image is loaded. This API was intended for versioned objects, where
     * the versioned object is monitored for new version.
     *
     * @param hash
     */
    public monitorAttachment(hash: SHA256Hash): void {
        this.assertInitialized();

        if (this.cache.has(hash)) {
            return;
        }

        // Set to undefined, so that the previous 'if' prevents other monitor calls to also load the same info.
        this.cache.set(hash, undefined);

        (async () => {
            const attachment = await getObject(hash);
            if (attachment) {
                this.cache.set(hash, attachment);
                this.onUpdate.emit();
            }
        })().catch(e => this.onError.emit(e));
    }

    /**
     * Get the attachment synchronously
     *
     * @param hash
     * @returns if undefined, either monitorAttachment has not finished loading the data or was never called
     */
    public queryAttachment(hash: SHA256Hash): OneObjectTypes | undefined {
        this.assertInitialized();
        return this.cache.get(hash);
    }

    public initialized(): boolean {
        return this.isInitialized;
    }

    private assertInitialized() {
        if (!this.isInitialized) {
            throw new Error(
                'ChatAttachmentCache: You cannot use any method of this class, because it is already shut down.'
            );
        }
    }
}
