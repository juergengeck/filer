import {readBlobAsArrayBuffer, storeArrayBufferAsBlob} from '@refinio/one.core/lib/storage-blob.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {ChannelInfo} from '../recipes/ChannelRecipes.js';
import type ChannelManager from './ChannelManager.js';
import type {ObjectData, QueryOptions, RawChannelEntry} from './ChannelManager.js';
import {Model} from './Model.js';

import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import {AcceptedMimeType} from '../recipes/DocumentRecipes/DocumentRecipes_1_1_0.js';
import type {DocumentInfo_1_1_0} from '../recipes/DocumentRecipes/DocumentRecipes_1_1_0.js';
import type {DocumentInfo as DocumentInfo_1_0_0} from '../recipes/DocumentRecipes/DocumentRecipes_1_0_0.js';
import {OEvent} from '../misc/OEvent.js';

export type DocumentInfo = DocumentInfo_1_1_0;

/**
 * This model implements the possibility of adding a document into a journal
 * and keeping track of the list of the documents.
 */
export default class DocumentModel extends Model {
    channelManager: ChannelManager;
    public static readonly channelId = 'document';
    private disconnect: (() => void) | undefined;

    // @Override base class event
    public onUpdated: OEvent<(timeOfEarliestChange: Date) => void> = new OEvent<
        (timeOfEarliestChange: Date) => void
    >();

    /**
     * Construct a new instance
     *
     * @param channelManager - The channel manager instance
     */
    constructor(channelManager: ChannelManager) {
        super();
        this.channelManager = channelManager;
    }

    /**
     * Check if the model is initialized
     * @returns true if the model is initialized, false otherwise
     */
    public isInitialized(): boolean {
        return this.state.currentState === 'Initialised';
    }

    /**
     * Initialize this instance
     *
     * This must be done after the one instance was initialized.
     */
    async init(): Promise<void> {
        this.state.assertCurrentState('Uninitialised');

        this.disconnect = this.channelManager.onUpdated(this.handleOnUpdated.bind(this));
        await this.channelManager.createChannel(DocumentModel.channelId);

        this.state.triggerEvent('init');
    }

    /**
     * Shutdown module
     */
    async shutdown(): Promise<void> {
        this.state.assertCurrentState('Initialised');

        if (this.disconnect) {
            this.disconnect();
        }
        this.state.triggerEvent('shutdown');
    }

    /**
     * Create a new reference to a document.
     *
     * @param document - The document.
     * @param mimeType
     * @param documentName
     * @param channelId - The default is DocumentModel.channelId
     * @param channelOwner
     */
    async addDocument(
        document: ArrayBuffer,
        mimeType: DocumentInfo['mimeType'],
        documentName: DocumentInfo['documentName'],
        channelId: string = DocumentModel.channelId,
        channelOwner?: SHA256IdHash<Person> | null | undefined
    ): Promise<void> {
        this.state.assertCurrentState('Initialised');

        const oneDocument = await storeArrayBufferAsBlob(document);
        await this.channelManager.postToChannel(
            channelId,
            {
                $type$: 'DocumentInfo_1_1_0',
                mimeType: mimeType,
                documentName: documentName,
                document: oneDocument.hash
            },
            channelOwner
        );
    }

    /**
     * Getting all the documents stored in ONE.
     *
     * @returns an array of documents.
     */
    async documents(): Promise<ObjectData<DocumentInfo_1_1_0>[]> {
        this.state.assertCurrentState('Initialised');

        const documentsData = (await this.channelManager.getObjects({
            types: ['DocumentInfo_1_1_0', 'DocumentInfo'],
            channelId: DocumentModel.channelId
        })) as ObjectData<DocumentInfo_1_1_0 | DocumentInfo_1_0_0>[];

        return documentsData.map(
            (documentData: ObjectData<DocumentInfo_1_1_0 | DocumentInfo_1_0_0>) => {
                /** Update older versions of type {@link DocumentInfo_1_0_0} to {@link DocumentInfo_1_1_0} **/
                if (documentData.data.$type$ === 'DocumentInfo') {
                    documentData.data = {
                        document: documentData.data.document,
                        $type$: 'DocumentInfo_1_1_0',
                        /** any {@link DocumentInfo_1_0_0} was saved as a PDF in the past **/
                        mimeType: AcceptedMimeType.PDF,
                        documentName: ''
                    };
                    return documentData;
                } else {
                    return documentData;
                }
            }
        ) as ObjectData<DocumentInfo_1_1_0>[];
    }

    /**
     * returns iterator for DocumentInfo_1_1_0
     * @param queryOptions
     */
    async *documentsIterator(
        queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<DocumentInfo_1_1_0>> {
        this.state.assertCurrentState('Initialised');

        for await (const document of this.channelManager.objectIteratorWithType('DocumentInfo', {
            ...queryOptions,
            channelId: DocumentModel.channelId
        })) {
            yield {
                ...document,
                data: {
                    document: document.data.document,
                    $type$: 'DocumentInfo_1_1_0',
                    /** any {@link DocumentInfo_1_0_0} was saved as a PDF in the past **/
                    mimeType: AcceptedMimeType.PDF,
                    documentName: ''
                },
                // This is already there from "...document.js" above, but for TypeScript we need to
                // recast the type of this property
                dataHash: document.dataHash as unknown as SHA256Hash<DocumentInfo_1_1_0>
            };
        }
        yield* this.channelManager.objectIteratorWithType('DocumentInfo_1_1_0', {
            ...queryOptions,
            channelId: DocumentModel.channelId
        });
    }

    /**
     * Getting a document with a specific id.
     *
     * @param id - the id of the document.
     * @returns the document.
     */
    async getDocumentById(id: string): Promise<ObjectData<DocumentInfo_1_1_0>> {
        this.state.assertCurrentState('Initialised');

        const documentsData = await this.channelManager.getObjects({
            id: id,
            types: ['DocumentInfo_1_1_0', 'DocumentInfo'],
            channelId: DocumentModel.channelId
        });

        /** if the list is empty, the object reference does not exist - getObjectWithTypeById behaviour **/
        if (documentsData.length === 0) {
            throw new Error('The referenced object does not exist');
        }

        /** it should always be only one object with the desired id **/
        const foundDocumentData = documentsData[0];

        /** Update older versions of type {@link DocumentInfo_1_0_0} to {@link DocumentInfo_1_1_0} **/
        if (foundDocumentData.data.$type$ === 'DocumentInfo') {
            foundDocumentData.data = {
                $type$: 'DocumentInfo_1_1_0',
                document: foundDocumentData.data.document,
                /** any {@link DocumentInfo_1_0_0} was saved as a PDF in the past **/
                mimeType: AcceptedMimeType.PDF,
                documentName: ''
            };
            return foundDocumentData as ObjectData<DocumentInfo_1_1_0>;
        }

        return foundDocumentData as ObjectData<DocumentInfo_1_1_0>;
    }

    /**
     * Convert from one representation to model representation.
     *
     * @param oneObject - the one object
     * @returns The corresponding model object
     */
    async blobHashToArrayBuffer(oneObject: DocumentInfo): Promise<ArrayBuffer> {
        this.state.assertCurrentState('Initialised');
        return await readBlobAsArrayBuffer(oneObject.document);
    }

    /**
     *  Handler function for the 'updated' event
     * @param channelInfoIdHash
     * @param channelId
     * @param channelOwner
     * @param timeOfEarliestChange
     * @param data
     */
    private async handleOnUpdated(
        _channelInfoIdHash: SHA256IdHash<ChannelInfo>,
        channelId: string,
        _channelOwner: SHA256IdHash<Person> | null,
        timeOfEarliestChange: Date,
        _data: RawChannelEntry[]
    ): Promise<void> {
        if (channelId === DocumentModel.channelId) {
            this.onUpdated.emit(timeOfEarliestChange);
        }
    }
}
