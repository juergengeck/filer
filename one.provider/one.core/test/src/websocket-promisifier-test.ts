
/*******************************************************************
 *
 *  THESE TESTS ALSO TEST READ- AND WRITE-STREAMS
 *
 *******************************************************************/

import {expect} from 'chai';

import {closeAndDeleteCurrentInstance} from '../../lib/instance.js';
import {convertMicrodataToObject} from '../../lib/microdata-to-object.js';
import type {SimpleReadStream} from '../../lib/storage-base-common.js';
import {storeArrayBufferAsBlob, storeUTF8Clob} from '../../lib/storage-blob.js';
import type {UnversionedObjectResult} from '../../lib/storage-unversioned-objects.js';
import {storeUnversionedObject} from '../../lib/storage-unversioned-objects.js';
import {isBrowser} from '../../lib/system/platform.js';
import {readUTF8TextFile} from '../../lib/system/storage-base.js';
import {createFileReadStream, createFileWriteStream} from '../../lib/system/storage-streams.js';
import * as PromiseUtils from '../../lib/util/promise.js';
import {isObject} from '../../lib/util/type-checks-basic.js';
import type {SHA256Hash} from '../../lib/util/type-checks.js';
import type {WebsocketPromisifierAPI} from '../../lib/websocket-promisifier.js';
import {createWebsocketPromisifier} from '../../lib/websocket-promisifier.js';
import type {ErrorWithCode} from '../../lib/errors.js';

import * as StorageTestInit from './_helpers.js';
import type {OneTest$ReferenceTest} from './_register-types.js';
import {createTestConnection} from './_websocket-connection.js';

type CommServerExports = typeof import('./_communication-server.js');

// The SHA-256 of a zero-length file is this constant
const ZERO_LENGTH_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

let CommunicationServer: undefined | CommServerExports;

// Unique ID for the comm.server group in case the comm.server is used by more than one instance
const UUID = Math.random().toString(36).substring(2) + new Date().getTime().toString(36);

const MESSAGE_TYPES = {
    GET_OBJECT: 2,
    DO_MATH: 3,
    DO_NOTHING: 4,
    WAIT: 5,
    ERROR1: 6,
    ERROR2: 7,
    ERROR3: 8,
    ERROR4: 9,
    ERROR5: 10
} as const;

async function createObjects() {
    const clobResult /** FileCreation*/ = await storeUTF8Clob(
        `
5.3 Somatosensory Neurons have Receptive Fields

Each subcortical somatosensory neuron responds to modality-specific stimuli applied to a specific
region of the body or face.

For example, an axon in the medial lemniscus (i.e., the fiber tract) that responds to tactile
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
receptive fields are required.

`.repeat(100)
    );

    const blobStream = createFileWriteStream();

    blobStream.promise.catch(err => console.log(err));

    for (let i = 0; i < 16; i++) {
        const uint8Array = new Uint8Array(64 * 1002); // ca. 1 MB - but not exactly

        for (let j = 0; j < uint8Array.byteLength; j++) {
            uint8Array[j] = Math.floor(Math.random() * 255) + 1;
        }

        blobStream.write(uint8Array.buffer);
    }

    const blobResult = await blobStream.end();

    const zeroBlob = await storeArrayBufferAsBlob(new ArrayBuffer(0));

    return storeUnversionedObject({
        $type$: 'OneTest$ReferenceTest',
        clob: [clobResult.hash],
        blob: [blobResult.hash, zeroBlob.hash]
    });
}

/**
 * The purpose of this function is to silence TypeScript without using "@ts-ignore"
 * @param {*} obj
 * @param {number} [idx=0]
 * @returns {SHA256Hash}
 */
function getHashFromResult(obj: any[] | undefined, idx: number = 0): SHA256Hash {
    if (!Array.isArray(obj)) {
        throw new Error('Not an array');
    }

    if (idx > obj.length) {
        throw new Error(`Index too big: idx: ${idx}, array length: ${obj.length}`);
    }

    if (obj[idx] === undefined) {
        throw new Error('No such index #0');
    }

    return obj[idx];
}

function getObjectThroughStream(
    hash: SHA256Hash,
    encoding: undefined | 'base64' | 'utf8'
): SimpleReadStream<typeof encoding> {
    return createFileReadStream(hash, encoding);
}

function doMath(n: number) {
    return n * n;
}

async function doNothing() {
    await PromiseUtils.wait(10);
}

async function wait(t: number) {
    await PromiseUtils.wait(t);
}

function error1(): never {
    throw new Error('Something is very wrong');
}

async function error2(): Promise<void> {
    // Non-existing file read attempt
    await readUTF8TextFile('ö'.repeat(24));
}

function error3(): void {
    convertMicrodataToObject('NOT AN OBJECT');
}

async function error4(): Promise<void> {
    const err = new Error('Custom error creation') as ErrorWithCode;
    err.name = 'CustomError';
    err.code = 'CE-CODE-TEST';
    throw err;
}

async function error5(id: number): Promise<void> {
    throw new TypeError(`Unrecognized id: ${id}`);
}

describe('WebSocket promisifier and Streams tests', () => {
    let WS1: WebsocketPromisifierAPI;
    let WS2: WebsocketPromisifierAPI;

    let fileCreationResult: UnversionedObjectResult<OneTest$ReferenceTest>;

    const commServerUrl = 'ws://localhost:8000/';
    const connectionPartner = 'tests-' + UUID;

    before(async () => {
        // startLogger({types: ['error']});

        // THIS IS WRITTEN IN THIS CONVOLUTED WAY to prevent SystemJS (browser) from trying to load
        // those modules when it looks for imported modules with static parsing. The comm.server has to
        // be started manually on localhost:8000 when running this test on the browser.
        const commServerModule = './_communication-server.js';
        CommunicationServer = isBrowser ? undefined : await import(commServerModule);

        if (CommunicationServer !== undefined) {
            CommunicationServer.stopCommServer();
            CommunicationServer.startCommServer({silent: true});
        }

        await StorageTestInit.init();

        fileCreationResult = await createObjects();
    });

    beforeEach(async () => {
        const [encryptedConnection1, encryptedConnection2] = await Promise.all([
            createTestConnection(commServerUrl, connectionPartner, 3000),
            createTestConnection(commServerUrl, connectionPartner, 3000)
        ]).catch(err => {
            console.log(err);
            throw err;
        });

        WS1 = createWebsocketPromisifier(encryptedConnection1);
        WS2 = createWebsocketPromisifier(encryptedConnection2);

        WS2.addService(MESSAGE_TYPES.GET_OBJECT, getObjectThroughStream);
        WS2.addService(MESSAGE_TYPES.DO_MATH, doMath);
        WS2.addService(MESSAGE_TYPES.DO_NOTHING, doNothing);
        WS2.addService(MESSAGE_TYPES.WAIT, wait);
        WS2.addService(MESSAGE_TYPES.ERROR1, error1);
        WS2.addService(MESSAGE_TYPES.ERROR2, error2);
        WS2.addService(MESSAGE_TYPES.ERROR3, error3);
        WS2.addService(MESSAGE_TYPES.ERROR4, error4);
        WS2.addService(MESSAGE_TYPES.ERROR5, error5);

        WS1.promise.catch(err => {
            console.log('Client #1 close event:', err.code, '"' + err.message + '"');
        });

        WS2.promise.catch(err => {
            console.log('Client #2 close event:', err.code, '"' + err.message + '"');
        });
    });

    afterEach(async () => {
        WS1.close();
        WS2.close();
    });

    after(async () => {
        if (CommunicationServer !== undefined) {
            CommunicationServer.stopCommServer();
        }

        await closeAndDeleteCurrentInstance();
        // stopLogger();
    });

    it('should have created a WS object for clients 1 and 2', () => {
        expect(typeof WS1).to.equal('object');
        expect(typeof WS1.send).to.equal('function');
        expect(typeof WS1.close).to.equal('function');
        expect(typeof WS1.stats).to.equal('object');
        expect(typeof WS2).to.equal('object');
        expect(typeof WS2.send).to.equal('function');
        expect(typeof WS2.close).to.equal('function');
        expect(typeof WS2.stats).to.equal('object');
    });

    it('should execute simple requests on the remote site', async () => {
        const result = await WS1.send(MESSAGE_TYPES.DO_MATH, 12);
        expect(result).to.equal(144);
    });

    it('should get utf8 text file through a stream from the remote site', async () => {
        const result = await WS1.send(
            MESSAGE_TYPES.GET_OBJECT,
            getHashFromResult(fileCreationResult.obj.clob),
            'utf8'
        );
        expect(result).to.deep.equal({
            hash: getHashFromResult(fileCreationResult.obj.clob),
            status: 'exists'
        });
    });

    it('should get binary file through a stream from the remote site', async () => {
        const result = await WS1.send(
            MESSAGE_TYPES.GET_OBJECT,
            getHashFromResult(fileCreationResult.obj.blob)
        );

        expect(result).to.deep.equal({
            hash: getHashFromResult(fileCreationResult.obj.blob),
            status: 'exists'
        });
    });

    it('should get zero-length binary file through a stream from the remote site', async () => {
        expect(getHashFromResult(fileCreationResult.obj.blob, 1)).to.equal(ZERO_LENGTH_SHA256);

        const result = await WS1.send(MESSAGE_TYPES.GET_OBJECT, ZERO_LENGTH_SHA256);

        expect(result).to.deep.equal({
            hash: ZERO_LENGTH_SHA256,
            status: 'exists'
        });
    });

    it('should get binary file through a base64 stream from the remote site', async () => {
        const result = await WS1.send(
            MESSAGE_TYPES.GET_OBJECT,
            getHashFromResult(fileCreationResult.obj.blob),
            'base64'
        );
        expect(result).to.deep.equal({
            hash: getHashFromResult(fileCreationResult.obj.blob),
            status: 'exists'
        });
    });

    it('should work with a server function that returns nothing', async () => {
        const result = await WS1.send(MESSAGE_TYPES.DO_NOTHING);
        expect(result).to.equal(undefined);
    });

    it('should return error from the remote server function (1)', async () => {
        try {
            await WS1.send(MESSAGE_TYPES.ERROR1);
            expect(true).to.be.false;
        } catch (err) {
            expect(isObject(err)).to.be.true;
            expect(err.name).to.equal('WebsocketRequestError');
            expect(err.message).to.equal(
                'WSRQ-JRMH1: Remote websocket function returned an error (see "cause" property)'
            );
            expect(err.code).to.equal('WSRQ-JRMH1');
            expect(err.cause.name).to.equal('Error');
            expect(err.cause.message).to.equal('Something is very wrong');
            expect(err.cause.code).to.be.undefined;
        }
    });

    it('should return error from the remote server function (2)', async () => {
        try {
            await WS1.send(MESSAGE_TYPES.ERROR2);
            expect(true).to.be.false;
        } catch (err) {
            expect(isObject(err)).to.be.true;
            expect(err.name).to.equal('WebsocketRequestError');
            expect(err.message).to.equal(
                'WSRQ-JRMH1: Remote websocket function returned an error (see "cause" property)'
            );
            expect(err.code).to.equal('WSRQ-JRMH1');
            expect(err.cause.name).to.equal('FileNotFoundError');
            expect(err.cause.message).to.equal(
                'SB-READ2: File not found: öööööööööööööööööööööööö [objects]'
            );
            expect(err.cause.code).to.equal('SB-READ2');
        }
    });

    it('should return error from the remote server function (3)', async () => {
        try {
            await WS1.send(MESSAGE_TYPES.ERROR3);
            expect(true).to.be.false;
        } catch (err) {
            expect(isObject(err)).to.be.true;
            expect(err.name).to.equal('WebsocketRequestError');
            expect(err.message).to.equal(
                'WSRQ-JRMH1: Remote websocket function returned an error (see "cause" property)'
            );
            expect(err.code).to.equal('WSRQ-JRMH1');
            expect(err.cause.name).to.equal('Error');
            expect(err.cause.message).to.equal(
                'M2O-PH1: This does not look like valid ONE microdata (isIdObj is false): NOT AN OBJECT'
            );
            expect(err.cause.code).to.equal('M2O-PH1');
        }
    });

    it('should return error from the remote server function (4)', async () => {
        try {
            await WS1.send(MESSAGE_TYPES.ERROR4);
            expect(true).to.be.false;
        } catch (err) {
            expect(isObject(err)).to.be.true;
            expect(err.name).to.equal('WebsocketRequestError');
            expect(err.message).to.equal(
                'WSRQ-JRMH1: Remote websocket function returned an error (see "cause" property)'
            );
            expect(err.code).to.equal('WSRQ-JRMH1');
            expect(err.cause.name).to.equal('CustomError');
            expect(err.cause.message).to.equal('Custom error creation');
            expect(err.cause.code).to.equal('CE-CODE-TEST');
        }
    });

    it('should return error from the remote server function (5)', async () => {
        try {
            await WS1.send(MESSAGE_TYPES.ERROR5, 42);
            expect(true).to.be.false;
        } catch (err) {
            expect(isObject(err)).to.be.true;
            expect(err.name).to.equal('WebsocketRequestError');
            expect(err.message).to.equal(
                'WSRQ-JRMH1: Remote websocket function returned an error (see "cause" property)'
            );
            expect(err.code).to.equal('WSRQ-JRMH1');
            expect(err.cause.name).to.equal('TypeError');
            expect(err.cause.message).to.equal('Unrecognized id: 42');
            expect(err.cause.code).to.be.undefined;
        }
    });

    it('should pass a load test with lots of parallel requests and streams', async function test1() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(42000);

        const NR_TESTS = 50;

        const fileStreams = [];
        const maths = [];

        for (let i = 0; i < NR_TESTS; i++) {
            fileStreams.push(
                WS1.send(
                    MESSAGE_TYPES.GET_OBJECT,
                    getHashFromResult(fileCreationResult.obj.blob)
                ).catch(err => err)
            );
            fileStreams.push(
                WS1.send(
                    MESSAGE_TYPES.GET_OBJECT,
                    getHashFromResult(fileCreationResult.obj.blob),
                    'base64'
                ).catch(err => err)
            );
            maths.push(WS1.send(MESSAGE_TYPES.DO_MATH, i).catch(err => err));
        }

        const fileStreamResults = await Promise.all(fileStreams);

        fileStreamResults.forEach(result => {
            expect(result).to.deep.equal({
                hash: getHashFromResult(fileCreationResult.obj.blob),
                status: 'exists'
            });
        });

        // Creates an array with n elements and ascending values ranging from 0 to n
        function range(n: number) {
            return Array.from({length: n}, (_value, key) => key);
        }

        const mathResults = await Promise.all(maths);

        expect(mathResults).to.deep.equal(range(NR_TESTS).map(n => doMath(n)));
    });

    it.skip('should pong', async function test2() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(80000);
        await WS1.send(MESSAGE_TYPES.WAIT, 60000);
        expect(true).to.be.true;
    });

    it('should close the connection', async () => {
        WS1.close();
        WS2.close();

        const result1 = await WS1.promise.catch(_ignore => ({}));
        const result2 = await WS2.promise.catch(_ignore => ({}));

        expect(result1).to.deep.equal({
            requestsSentTotal: 0,
            requestsReceivedTotal: 0,
            requestsReceivedInvalid: 0
        });
        expect(result2).to.deep.equal({
            requestsSentTotal: 0,
            requestsReceivedTotal: 0,
            requestsReceivedInvalid: 0
        });
    });
});
