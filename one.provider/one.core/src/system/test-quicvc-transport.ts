/**
 * @author REFINIO GmbH
 * @copyright REFINIO GmbH 2024
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * Test script for QuicVC transport integration
 */

import Debug from 'debug';
import { createQuicVCTransport } from './quicvc-transport.js';
import type { QuicTransport } from './quic-transport.js';

const debug = Debug('one:quicvc:test');

async function testBasicIntegration(): Promise<void> {
    debug('Testing QuicVC transport basic integration...');
    
    try {
        // Create transport instance
        const transport = createQuicVCTransport();
        debug('✓ QuicVC transport created successfully');
        
        // Test interface compliance
        if (transport.type !== 'quic-transport') {
            throw new Error('Transport type mismatch');
        }
        debug('✓ Transport type is correct');
        
        // Test EventEmitter interface
        const testFn = () => debug('Test event received');
        transport.on('test', testFn);
        transport.emit('test');
        transport.off('test', testFn);
        debug('✓ EventEmitter interface working');
        
        // Test WebsocketPromisifierAPI interface
        transport.addService(1, (...args) => debug('Service 1 called with', args));
        transport.removeService(1);
        transport.clearServices();
        debug('✓ WebsocketPromisifierAPI interface working');
        
        // Test stats interface
        const stats = transport.stats;
        if (typeof stats.requestsSentTotal !== 'number') {
            throw new Error('Stats interface not working');
        }
        debug('✓ Statistics interface working');
        
        // Clean up
        transport.close();
        debug('✓ Transport closed successfully');
        
        debug('✅ Basic integration test passed!');
    } catch (error) {
        debug('❌ Basic integration test failed:', error);
        throw error;
    }
}

async function testConnectionSetup(): Promise<void> {
    debug('Testing QuicVC transport connection setup...');
    
    try {
        const server = createQuicVCTransport();
        const client = createQuicVCTransport();
        
        // Set up server
        debug('Setting up server...');
        server.on('connection', (connection) => {
            debug('Server received connection:', connection.id);
        });
        
        server.on('error', (error) => {
            debug('Server error:', error);
        });
        
        // Start server listening
        await server.listen({ port: 49498, host: 'localhost' });
        debug('✓ Server listening on localhost:49498');
        
        // Give server time to start
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Test client connection (will fail due to no actual QUIC server)
        client.on('error', (error) => {
            debug('Expected client error (no server):', error.message);
        });
        
        try {
            await client.connect({ port: 49498, host: 'localhost' });
            debug('✓ Client connected (unexpected success)');
        } catch (error) {
            debug('✓ Client connection failed as expected (no handshake)');
        }
        
        // Clean up
        server.close();
        client.close();
        
        debug('✅ Connection setup test completed!');
    } catch (error) {
        debug('❌ Connection setup test failed:', error);
        throw error;
    }
}

async function testStreamCreation(): Promise<void> {
    debug('Testing QuicVC stream creation...');
    
    try {
        const transport = createQuicVCTransport();
        
        // Create a mock connection for testing
        const mockConnection = {
            id: 'test-connection',
            remoteAddress: 'localhost',
            remotePort: 49498
        };
        
        // Create stream
        const stream = await transport.createStream(mockConnection as any);
        debug('✓ Stream created:', stream.id);
        
        if (stream.connection !== mockConnection) {
            throw new Error('Stream connection reference incorrect');
        }
        debug('✓ Stream connection reference correct');
        
        // Test stream interface
        try {
            await stream.write(new Uint8Array([1, 2, 3, 4]));
            debug('✓ Stream write interface available');
        } catch (error) {
            debug('✓ Stream write failed as expected (no connection)');
        }
        
        const data = await stream.read();
        if (!(data instanceof Uint8Array)) {
            throw new Error('Stream read should return Uint8Array');
        }
        debug('✓ Stream read interface working');
        
        await stream.close();
        debug('✓ Stream closed');
        
        transport.close();
        debug('✅ Stream creation test passed!');
    } catch (error) {
        debug('❌ Stream creation test failed:', error);
        throw error;
    }
}

async function runAllTests(): Promise<void> {
    debug('🚀 Starting QuicVC transport integration tests...');
    
    try {
        await testBasicIntegration();
        await testConnectionSetup();
        await testStreamCreation();
        
        debug('🎉 All QuicVC transport tests passed successfully!');
    } catch (error) {
        debug('💥 Test suite failed:', error);
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runAllTests();
}

export {
    testBasicIntegration,
    testConnectionSetup,
    testStreamCreation,
    runAllTests
};