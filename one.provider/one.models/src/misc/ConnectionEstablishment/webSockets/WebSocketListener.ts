import Connection from '../../Connection/Connection.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import {OEvent} from '../../OEvent.js';
import PromisePlugin from '../../Connection/plugins/PromisePlugin.js';
import {createWebSocket} from '@refinio/one.core/lib/system/websocket.js';
import {isExpo} from '@refinio/one.core/lib/system/platform.js';

const MessageBus = createMessageBus('WebSocketListener');

export enum WebSocketListenerState {
    NotConnected,
    Connecting,
    Connected,
    Disconnecting
}

/**
 * This is a client-side WebSocket connection manager that works in both browser and React Native/Expo environments.
 * It provides a convenient interface for establishing WebSocket connections to a server.
 */
class WebSocketListener {
    /**
     * Event is emitted when a connection is established.
     */
    public onConnection = new OEvent<(connection: Connection) => void>();

    /**
     * Event is emitted when the state of the connection changes.
     */
    public onStateChange = new OEvent<
        (
            newState: WebSocketListenerState,
            oldState: WebSocketListenerState,
            reason?: string
        ) => void
    >();

    public state: WebSocketListenerState;
    private connection: Connection | null = null;

    /**
     * Creates the listener.
     */
    constructor() {
        this.state = WebSocketListenerState.NotConnected;
    }

    /**
     * Connect to a WebSocket server.
     *
     * @param host - The host to connect to
     * @param port - The port to connect to
     */
    public async start(host: string, port: number): Promise<void> {
        if (this.connection) {
            throw Error('Already connected to a server.');
        }
        MessageBus.send('log', `Connecting to WebSocket server at ${host}:${port}`);
        this.changeCurrentState(WebSocketListenerState.Connecting);

        try {
            const url = `ws://${host}:${port}`;
            
            // Create WebSocket and Connection first (this adds WebSocketPlugin, StatisticsPlugin, NetworkPlugin)
            const webSocket = new WebSocket(url);
            this.connection = new Connection(webSocket);
            
            // CRITICAL FIX: Add PromisePlugin AFTER WebSocketPlugin so processing order is:
            // 1. WebSocketPlugin (filters ping/pong) 
            // 2. PromisePlugin (tries JSON parsing)
            // 3. StatisticsPlugin  
            // 4. NetworkPlugin
            this.connection.addPlugin(new PromisePlugin(), { after: 'websocket' });
            
            await this.connection.waitForOpen();
            
            MessageBus.send('log', `${this.connection.id}: Connected to WebSocket server`);
            
            this.changeCurrentState(WebSocketListenerState.Connected);
            this.onConnection.emit(this.connection);
            
            MessageBus.send('log', 'Successfully connected to WebSocket server');
        } catch (e) {
            this.changeCurrentState(WebSocketListenerState.NotConnected, e.toString());
            throw e;
        }
    }

    /**
     * Disconnects from the server
     */
    public async stop(): Promise<void> {
        MessageBus.send('log', 'Disconnecting from WebSocket server');
        this.changeCurrentState(WebSocketListenerState.Disconnecting);

        if (this.connection) {
            this.connection.close();
            this.connection = null;
        }

        this.changeCurrentState(WebSocketListenerState.NotConnected);
        MessageBus.send('log', 'Disconnected from WebSocket server');
    }

    /**
     * When the state changes, call the onStateChange callback.
     *
     * @param newState - The new state to set.
     * @param reason - The reason for the state change (Usually an error)
     */
    private changeCurrentState(newState: WebSocketListenerState, reason?: string): void {
        const oldState = this.state;
        this.state = newState;

        if (this.onStateChange.listenerCount() > 0 && newState !== oldState) {
            try {
                this.onStateChange.emit(newState, oldState, reason);
            } catch (e) {
                MessageBus.send('log', `Error calling onStateChange handler: ${e}`);
            }
        }
    }
}

export default WebSocketListener;
