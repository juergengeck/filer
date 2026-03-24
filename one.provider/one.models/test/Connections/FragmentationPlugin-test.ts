import {expect} from 'chai';
import FragmentationPlugin from '../../lib/misc/Connection/plugins/FragmentationPlugin.js';
import type {
    ConnectionIncomingEvent,
    ConnectionOutgoingEvent
} from '../../lib/misc/Connection/ConnectionPlugin.js';
import type {ConnectionMessageEvent} from '../../lib/misc/Connection/ConnectionPlugin.js';

const CHUNK_START_BINARY_MESSAGE = 'fragmentation_start_binary';
const CHUNK_START_STRING_MESSAGE = 'fragmentation_start_string';
const CHUNK_END_MESSAGE = 'fragmentation_end';

function range(start: number, end: number) {
    return new Uint8Array(end - start + 1).map((elem, idx) => start + idx);
}

describe('Fragmentation plugin test', () => {
    let outgoingEvents: ConnectionOutgoingEvent[] = [];
    let incomingEvents: ConnectionIncomingEvent[] = [];
    let plugin: FragmentationPlugin;

    beforeEach('Setup connections', async function () {
        outgoingEvents = [];
        incomingEvents = [];
        plugin = new FragmentationPlugin(40);
        plugin.attachedToConnection(
            {
                createOutogingEvent(event: ConnectionOutgoingEvent): void {
                    outgoingEvents.push(event);
                },
                createIncomingEvent(event: ConnectionIncomingEvent): void {
                    incomingEvents.push(event);
                }
            },
            0
        );
    });

    afterEach('Shutdown Connections', async function () {
        outgoingEvents = [];
        incomingEvents = [];
    });

    it('encode short string message', async function () {
        const origMessage: ConnectionMessageEvent = {
            type: 'message',
            data: 'Hello!'
        };

        const val = plugin.transformOutgoingEvent(origMessage);
        expect(val).to.be.eql(origMessage);
        expect(outgoingEvents.length).to.be.equal(0);
        expect(incomingEvents.length).to.be.equal(0);
    });

    it('encode short binary message', async function () {
        const origMessage: ConnectionMessageEvent = {
            type: 'message',
            data: new Uint8Array(3)
        };

        const val1 = plugin.transformOutgoingEvent(origMessage);
        expect(val1).to.be.eql(origMessage);
        expect(outgoingEvents.length).to.be.equal(0);
        expect(incomingEvents.length).to.be.equal(0);
    });

    it('encode binary message with chunk length size', async function () {
        const origMessage: ConnectionMessageEvent = {
            type: 'message',
            data: new Uint8Array(40)
        };

        const val1 = plugin.transformOutgoingEvent(origMessage);
        expect(val1).to.be.eql(origMessage);
        expect(outgoingEvents.length).to.be.equal(0);
        expect(incomingEvents.length).to.be.equal(0);
    });

    it('encode binary message with chunk length size + 1', async function () {
        const origMessage: ConnectionMessageEvent = {
            type: 'message',
            data: new Uint8Array(41)
        };

        const val = plugin.transformOutgoingEvent(origMessage);
        expect(val).to.be.null;
        expect(outgoingEvents.length).to.be.equal(4);
        if (outgoingEvents[1].type !== 'message') {
            throw new Error('event should be of type message');
        }
        if (outgoingEvents[2].type !== 'message') {
            throw new Error('event should be of type message');
        }
        expect(outgoingEvents[0]).to.be.eql({type: 'message', data: CHUNK_START_BINARY_MESSAGE});
        expect(outgoingEvents[1].data.length).to.be.equal(40);
        expect(outgoingEvents[2].data.length).to.be.equal(1);
        expect(outgoingEvents[3]).to.be.eql({type: 'message', data: CHUNK_END_MESSAGE});

        expect(incomingEvents.length).to.be.equal(0);
    });

    it('encode binary message with multiple chunks', async function () {
        const origMessage: ConnectionMessageEvent = {
            type: 'message',
            data: range(0, 250)
        };

        const val = plugin.transformOutgoingEvent(origMessage);
        expect(val).to.be.null;
        expect(outgoingEvents.length).to.be.equal(9);
        if (outgoingEvents[1].type !== 'message') {
            throw new Error('event should be of type message');
        }
        if (outgoingEvents[2].type !== 'message') {
            throw new Error('event should be of type message');
        }
        if (outgoingEvents[3].type !== 'message') {
            throw new Error('event should be of type message');
        }
        if (outgoingEvents[4].type !== 'message') {
            throw new Error('event should be of type message');
        }
        if (outgoingEvents[5].type !== 'message') {
            throw new Error('event should be of type message');
        }
        if (outgoingEvents[6].type !== 'message') {
            throw new Error('event should be of type message');
        }
        if (outgoingEvents[7].type !== 'message') {
            throw new Error('event should be of type message');
        }
        expect(outgoingEvents[0]).to.be.eql({type: 'message', data: CHUNK_START_BINARY_MESSAGE});
        expect(outgoingEvents[1].data).to.be.eql(range(0, 39));
        expect(outgoingEvents[2].data).to.be.eql(range(40, 79));
        expect(outgoingEvents[3].data).to.be.eql(range(80, 119));
        expect(outgoingEvents[4].data).to.be.eql(range(120, 159));
        expect(outgoingEvents[5].data).to.be.eql(range(160, 199));
        expect(outgoingEvents[6].data).to.be.eql(range(200, 239));
        expect(outgoingEvents[7].data).to.be.eql(range(240, 250));
        expect(outgoingEvents[8]).to.be.eql({type: 'message', data: CHUNK_END_MESSAGE});

        expect(incomingEvents.length).to.be.equal(0);
    });

    it('decode short string message', async function () {
        const origMessage: ConnectionMessageEvent = {
            type: 'message',
            data: 'Hello!'
        };

        const val = plugin.transformIncomingEvent(origMessage);
        expect(val).to.be.eql(origMessage);
        expect(outgoingEvents.length).to.be.equal(0);
        expect(incomingEvents.length).to.be.equal(0);
    });

    it('decode short binary message', async function () {
        const origMessage: ConnectionMessageEvent = {
            type: 'message',
            data: new Uint8Array(3)
        };

        const val1 = plugin.transformIncomingEvent(origMessage);
        expect(val1).to.be.eql(origMessage);
        expect(outgoingEvents.length).to.be.equal(0);
        expect(incomingEvents.length).to.be.equal(0);
    });

    it('decode binary message with chunk length size', async function () {
        const origMessage: ConnectionMessageEvent = {
            type: 'message',
            data: new Uint8Array(40)
        };

        const val1 = plugin.transformIncomingEvent(origMessage);
        expect(val1).to.be.eql(origMessage);
        expect(outgoingEvents.length).to.be.equal(0);
        expect(incomingEvents.length).to.be.equal(0);
    });

    it('decode binary message with > chunk length size', async function () {
        const origMessage: ConnectionMessageEvent = {
            type: 'message',
            data: new Uint8Array(50)
        };

        const val1 = plugin.transformIncomingEvent(origMessage);
        expect(val1).to.be.eql(origMessage);
        expect(outgoingEvents.length).to.be.equal(0);
        expect(incomingEvents.length).to.be.equal(0);
    });

    it('decode chunked binary message', async function () {
        const origMessage: ConnectionMessageEvent = {
            type: 'message',
            data: new Uint8Array(40)
        };

        expect(
            plugin.transformIncomingEvent({
                type: 'message',
                data: CHUNK_START_BINARY_MESSAGE
            })
        ).to.be.null;
        expect(
            plugin.transformIncomingEvent({
                type: 'message',
                data: range(0, 39)
            })
        ).to.be.null;
        expect(
            plugin.transformIncomingEvent({
                type: 'message',
                data: range(40, 40)
            })
        ).to.be.null;
        expect(plugin.transformIncomingEvent({type: 'message', data: CHUNK_END_MESSAGE})).to.be
            .null;

        expect(outgoingEvents.length).to.be.equal(0);
        expect(incomingEvents.length).to.be.equal(1);
        if (incomingEvents[0].type !== 'message') {
            throw new Error('event should be of type message');
        }
        expect(incomingEvents[0].data).to.be.eql(range(0, 40));
    });

    it('decode chunked binary message with different sized chunks', async function () {
        const origMessage: ConnectionMessageEvent = {
            type: 'message',
            data: new Uint8Array(40)
        };

        expect(
            plugin.transformIncomingEvent({
                type: 'message',
                data: CHUNK_START_BINARY_MESSAGE
            })
        ).to.be.null;
        expect(
            plugin.transformIncomingEvent({
                type: 'message',
                data: range(0, 39)
            })
        ).to.be.null;
        expect(
            plugin.transformIncomingEvent({
                type: 'message',
                data: range(40, 79)
            })
        ).to.be.null;
        expect(
            plugin.transformIncomingEvent({
                type: 'message',
                data: range(80, 85)
            })
        ).to.be.null;
        expect(
            plugin.transformIncomingEvent({
                type: 'message',
                data: range(86, 120)
            })
        ).to.be.null;
        expect(plugin.transformIncomingEvent({type: 'message', data: CHUNK_END_MESSAGE})).to.be
            .null;

        expect(outgoingEvents.length).to.be.equal(0);
        expect(incomingEvents.length).to.be.equal(1);
        if (incomingEvents[0].type !== 'message') {
            throw new Error('event should be of type message');
        }
        expect(incomingEvents[0].data).to.be.eql(range(0, 120));
    });

    it('encode decode large string message', async function () {
        const origMessage: ConnectionMessageEvent = {
            type: 'message',
            data: '5'.repeat(3000)
        };

        expect(plugin.transformOutgoingEvent(origMessage)).to.be.null;
        expect(outgoingEvents.length).to.be.equal(3000 / 40 + 2);
        expect(incomingEvents.length).to.be.equal(0);

        for (const ev of outgoingEvents) {
            if (ev.type !== 'message') {
                throw new Error('event should be of type message');
            }
            expect(plugin.transformIncomingEvent(ev)).to.be.null;
        }

        expect(outgoingEvents.length).to.be.equal(3000 / 40 + 2);
        expect(incomingEvents.length).to.be.equal(1);

        if (incomingEvents[0].type !== 'message') {
            throw new Error('event should be of type message');
        }
        expect(incomingEvents[0].data).to.be.eql(origMessage.data);
    });

    it('encode decode keywords and special values', async function () {
        // We need to set the size to 200, instead of 40, because the keywords are longer than
        // 40 / 4 (upper bounds check of utf-8 byte length)
        plugin = new FragmentationPlugin(200);
        plugin.attachedToConnection(
            {
                createOutogingEvent(event: ConnectionOutgoingEvent): void {
                    outgoingEvents.push(event);
                },
                createIncomingEvent(event: ConnectionIncomingEvent): void {
                    incomingEvents.push(event);
                }
            },
            0
        );

        const listOfMessages = [
            '',
            new Uint8Array(0),
            CHUNK_START_STRING_MESSAGE,
            CHUNK_START_BINARY_MESSAGE,
            CHUNK_END_MESSAGE,
            `${CHUNK_START_STRING_MESSAGE}x`,
            `${CHUNK_START_BINARY_MESSAGE}x`,
            `${CHUNK_END_MESSAGE}x`,
            `${CHUNK_START_STRING_MESSAGE}xx`,
            `${CHUNK_START_BINARY_MESSAGE}xx`,
            `${CHUNK_END_MESSAGE}xx`
        ];

        const listOfEscapedMessages = [];

        for (const message of listOfMessages) {
            const escapedMessageEvent = plugin.transformOutgoingEvent({
                type: 'message',
                data: message
            });

            if (escapedMessageEvent && escapedMessageEvent.type === 'message') {
                listOfEscapedMessages.push(escapedMessageEvent.data);
            }
        }

        expect(listOfEscapedMessages).to.be.eql([
            '',
            new Uint8Array(0),
            `${CHUNK_START_STRING_MESSAGE}x`,
            `${CHUNK_START_BINARY_MESSAGE}x`,
            `${CHUNK_END_MESSAGE}x`,
            `${CHUNK_START_STRING_MESSAGE}xx`,
            `${CHUNK_START_BINARY_MESSAGE}xx`,
            `${CHUNK_END_MESSAGE}xx`,
            `${CHUNK_START_STRING_MESSAGE}xxx`,
            `${CHUNK_START_BINARY_MESSAGE}xxx`,
            `${CHUNK_END_MESSAGE}xxx`
        ]);

        const listOfDecodedMessages = [];

        for (const escapedMessage of listOfEscapedMessages) {
            const escapedMessageEvent = plugin.transformIncomingEvent({
                type: 'message',
                data: escapedMessage
            });

            if (escapedMessageEvent && escapedMessageEvent.type === 'message') {
                listOfDecodedMessages.push(escapedMessageEvent.data);
            }
        }

        expect(listOfDecodedMessages).to.be.eql(listOfMessages);
    });
});
