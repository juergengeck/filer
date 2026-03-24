/**
 * @author REFINIO GmbH
 * @copyright REFINIO GmbH 2024
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * Test file for QuicVC transport implementation
 */

import {expect} from 'chai';
import {createQuicVCTransport} from '../../lib/system/quicvc-transport.js';
import type {QuicTransport} from '../../lib/system/quic-transport.js';

describe('QuicVC Transport tests', () => {
    it('should create a QuicVC transport instance', () => {
        const transport = createQuicVCTransport();
        expect(transport).to.not.be.undefined;
        expect(transport.type).to.equal('quic-transport');
        transport.close();
    });

    it('should have correct interface methods', () => {
        const transport = createQuicVCTransport();

        // Check required methods exist
        expect(transport.listen).to.be.a('function');
        expect(transport.connect).to.be.a('function');
        expect(transport.close).to.be.a('function');
        expect(transport.createStream).to.be.a('function');
        expect(transport.on).to.be.a('function');
        expect(transport.off).to.be.a('function');
        expect(transport.emit).to.be.a('function');

        // Check WebsocketPromisifierAPI methods
        expect(transport.addService).to.be.a('function');
        expect(transport.removeService).to.be.a('function');
        expect(transport.clearServices).to.be.a('function');
        expect(transport.send).to.be.a('function');

        transport.close();
    });

    it('should have statistics interface', () => {
        const transport = createQuicVCTransport();
        const stats = transport.stats;

        expect(stats).to.not.be.undefined;
        expect(stats.requestsSentTotal).to.be.a('number');
        expect(stats.requestsReceivedTotal).to.be.a('number');
        expect(stats.requestsReceivedInvalid).to.be.a('number');

        transport.close();
    });

    it('should handle service registration', () => {
        const transport = createQuicVCTransport();
        let serviceCalled = false;

        const testService = () => {
            serviceCalled = true;
        };

        transport.addService(1, testService);
        // Note: We'd need a proper connection to test service calls
        // For now just verify registration doesn't throw

        transport.removeService(1);
        transport.clearServices();

        transport.close();
    });

    it('should handle event emitter interface', (done) => {
        const transport = createQuicVCTransport();

        const listener = (data: any) => {
            expect(data).to.equal('test-data');
            transport.off('test-event', listener);
            transport.close();
            done();
        };

        transport.on('test-event', listener);
        transport.emit('test-event', 'test-data');
    });

    // Skipped for now as it requires actual QUIC server/client setup
    it.skip('should establish connection between server and client', async () => {
        const server = createQuicVCTransport();
        const client = createQuicVCTransport();

        server.on('connection', (connection) => {
            console.log('Server received connection:', connection.id);
        });

        await server.listen({ port: 49499, host: 'localhost' });

        const connection = await client.connect({ port: 49499, host: 'localhost' });
        expect(connection).to.not.be.undefined;

        server.close();
        client.close();
    });
});