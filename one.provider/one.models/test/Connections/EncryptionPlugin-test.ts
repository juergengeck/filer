import {expect} from 'chai';
import tweetnacl from 'tweetnacl';
import EncryptionPlugin from '../../lib/misc/Connection/plugins/EncryptionPlugin.js';

describe('Encryption plugin test', () => {
    it('encrypt decrypt', async function () {
        const sharedKey = tweetnacl.randomBytes(tweetnacl.secretbox.keyLength);

        const clientPlugin = new EncryptionPlugin(sharedKey, true);
        const serverPlugin = new EncryptionPlugin(sharedKey, false);

        // Encrypt message
        const encMsg1 = clientPlugin.transformOutgoingEvent({
            type: 'message',
            data: 'Hello Server!'
        });
        if (encMsg1 === null || encMsg1.type !== 'message') {
            throw new Error('Event is not a message (1)');
        }

        // Decrypt message
        const decMsg1 = serverPlugin.transformIncomingEvent(encMsg1);
        if (decMsg1 === null || decMsg1.type !== 'message') {
            throw new Error('Event is not a message (2)');
        }
        expect(decMsg1.data).to.be.equal('Hello Server!');

        const encMsg2 = serverPlugin.transformOutgoingEvent({
            type: 'message',
            data: 'Hello Client!'
        });
        if (encMsg2 === null || encMsg2.type !== 'message') {
            throw new Error('Event is not a message (3)');
        }
        const decMsg2 = clientPlugin.transformIncomingEvent(encMsg2);
        if (decMsg2 === null || decMsg2.type !== 'message') {
            throw new Error('Event is not a message (4)');
        }
        expect(decMsg2.data).to.be.equal('Hello Client!');
    });

    it('test the nonce counter conversion function', async function () {
        const one = EncryptionPlugin.nonceCounterToArray(1);
        expect(one).to.be.eql(
            new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
        );
        const tho = EncryptionPlugin.nonceCounterToArray(1000);
        expect(tho).to.be.eql(
            new Uint8Array([
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x03, 0xe8
            ])
        );
        const mil = EncryptionPlugin.nonceCounterToArray(1000000);
        expect(mil).to.be.eql(
            new Uint8Array([
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x0f, 0x42, 0x40
            ])
        );
    });
});
