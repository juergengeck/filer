import WebSocket from 'isomorphic-ws';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import PromisePlugin from '../../Connection/plugins/PromisePlugin.js';
import {OEvent} from '../../OEvent.js';
import Connection from '../../Connection/Connection.js';

const MessageBus = createMessageBus('WebSocketServer');

export enum WebSocketServerState {
    NotListening,
    Starting,
    Listening,
    ShuttingDown
}

/**
 * This is a server for web socket connections.
 *
 * It wraps the WebSocket.Server in a more convenient interface.
 */
class WebSocketServer {
    /**
     * Event is emitted on incoming connections.
     */
    public onConnection = new OEvent<(connection: Connection) => void>();

    /**
     * Event is emitted when the state of the server changes. The listener callback
     * will be called in order to have access from outside to the errors that occur on
     * the web socket level.
     */
    public onStateChange = new OEvent<
        (
            newState: WebSocketServerState,
            oldState: WebSocketServerState,
            reason?: string
        ) => void
    >();

    public state: WebSocketServerState; // Current server state.
    private webSocketServer: WebSocket.Server | null = null; // The web socket server for listening for connections

    /**
     * Creates the server.
     */
    constructor() {
        this.state = WebSocketServerState.NotListening;
    }

    /**
     * Start the web socket server.
     *
     * @param host - The host to listen on
     * @param port - The port to listen on
     */
    public async start(host: string, port: number): Promise<void> {
        if (this.webSocketServer) {
            throw Error('WebSocket server is already running.');
        }
        MessageBus.send('log', `Starting WebSocket server at ${host}:${port}`);
        this.changeCurrentState(WebSocketServerState.Starting);

        try {
            this.webSocketServer = new WebSocket.Server({host, port});

            // Wait until the websocket server is either ready or stopped with an error (e.g. address in use)
            await new Promise<void>((resolve, reject) => {
                if (!this.webSocketServer) {
                    reject(
                        new Error(
                            'Web server instance not existing! This cannot happen, but TS demands this check'
                        )
                    );
                    return;
                }
                this.webSocketServer.on('listening', () => {
                    if (this.webSocketServer) {
                        this.webSocketServer.removeAllListeners();
                    }
                    resolve();
                });
                this.webSocketServer.on('error', (err: Error) => {
                    if (this.webSocketServer) {
                        this.webSocketServer.removeAllListeners();
                        this.webSocketServer = null;
                    }
                    reject(err);
                });
            });

            // After successful connection listen for new connections and errors
            this.webSocketServer.on('connection', this.acceptConnection.bind(this));
            this.webSocketServer.on('error', this.stop.bind(this));
            this.changeCurrentState(WebSocketServerState.Listening);
            MessageBus.send('log', 'Successfully started WebSocket server');
        } catch (e) {
            this.changeCurrentState(WebSocketServerState.NotListening, e.toString());
            throw e;
        }
    }

    /**
     * Stops the server
     */
    public async stop(): Promise<void> {
        MessageBus.send('log', 'Stopping WebSocket server');
        this.changeCurrentState(WebSocketServerState.ShuttingDown);

        // Shutdown Websocket server
        await new Promise<void>(resolve => {
            if (!this.webSocketServer) {
                return;
            }

            this.webSocketServer.close(() => {
                this.webSocketServer = null;
                resolve(); // ignore errors. Stop should not throw.
            });
        });

        this.changeCurrentState(WebSocketServerState.NotListening);
        MessageBus.send('log', 'Stopped WebSocket server');
    }

    /**
     * Notifies the user of a new connection.
     *
     * @param ws
     */
    private async acceptConnection(ws: any): Promise<void> {
        const connection = new Connection(ws as any);
        connection.addPlugin(new PromisePlugin());
        MessageBus.send('log', `${connection.id}: Accepted WebSocket`);
        try {
            this.onConnection.emit(connection);
        } catch (e) {
            MessageBus.send('log', `${connection.id}: ${e}`);
            ws.close();
        }
    }

    /**
     * When the state of the server changes, call the onStateChange callback,
     * in order for the server caller to be aware of the changes that happen
     * in the registration process.
     *
     * @param newState - The new state to set.
     * @param reason - The reason for the state change (Usually an error)
     */
    private changeCurrentState(newState: WebSocketServerState, reason?: string): void {
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

export default WebSocketServer;