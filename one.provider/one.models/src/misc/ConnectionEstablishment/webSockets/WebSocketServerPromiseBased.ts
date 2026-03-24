import type {Server as WebSocketServer} from 'isomorphic-ws';
import {createWebSocket} from '@refinio/one.core/lib/system/websocket.js';

/**
 * This is a wrapper for the web socket server to use it with async / await instead of having to
 * register callbacks.
 *
 * Note: At the moment this class is just used in test cases, so itself doesn't have tests and is
 * not production ready! When multiple connections arrive simultaneously, this class might loose one
 * of those.
 */
export default class WebSocketServerPromiseBased {
    public webSocketServer: WebSocketServer | null; // The web socket server instance
    private acceptConnectionFn: (() => void) | null; // The function that is used to resolve the promise in waitForConnection call.
    private lastConnection: WebSocket | null; // The last accepted connection that is pending collection (by a waitForConnection call).
    private readonly deregisterHandlers: () => void; // function that deregisters all event handler registered on the websocket server.

    /**
     * Constructs the convenience wrapper around the passed websoket server instance.
     * @param webSocketServer - The instance to wrap.
     */
    public constructor(webSocketServer: WebSocketServer) {
        this.acceptConnectionFn = null;
        this.lastConnection = null;
        this.webSocketServer = webSocketServer;

        const boundConnectionHandler = this.handleConnection.bind(this);
        this.webSocketServer.on('connection', boundConnectionHandler);
        this.deregisterHandlers = () => {
            if (this.webSocketServer) {
                this.webSocketServer.removeListener('connection', boundConnectionHandler);
            }
        };
    }

    /**
     * Releases the websocket server instance by deregistering all events and removing
     * any reference to it from this wrapper.
     *
     * @returns
     */
    public releaseWebSocketServer(): WebSocketServer {
        if (!this.webSocketServer) {
            throw Error('No websocket is bound to this instance.');
        }

        this.deregisterHandlers();
        const webSocket = this.webSocketServer;
        this.webSocketServer = null;
        return webSocket;
    }

    /**
     * Wait for a new connection.
     *
     * @returns
     */
    public async waitForConnection(): Promise<WebSocket> {
        if (this.acceptConnectionFn) {
            throw new Error('Somebody else is already waiting for a connection.');
        }

        // Return connection if any is available.
        if (this.lastConnection) {
            const lastConnection = this.lastConnection;
            this.lastConnection = null;
            return lastConnection;
        }

        // TODO Text copied from Skype chat with Erik:
        //   Es kann sein, dass der nie auflöst wenn man den websocket listener zumacht. Machen
        //   wir nur im shutdown auf node (wo anders gehts eh nicht) um das richtig zu machen
        //   muss man ein shutdown in die klasse reinmachen und das dann rejecten und das
        //   shutdown überall richtig verwendetn usw. Hab da jetzt keine Zeit dafür, aber du
        //   hast recht
        //   Und das machen wir aktuell nirgends in der app
        //   Ist nur für direkte Verbindungen die das promise interface verwenden, ich glaub das
        //   ist das debug script die app benutzt glaub das event interface (aber nicht sicher)
        // Otherwise wait for a connection to be established
        return new Promise((resolve, _reject) => {
            this.acceptConnectionFn = () => {
                this.acceptConnectionFn = null;
                if (this.lastConnection) {
                    const lastConnection = this.lastConnection;
                    this.lastConnection = null;
                    resolve(lastConnection);
                }
            };
        });
    }

    /**
     * Handler for new connections.
     *
     * It resolves the promise of somebody waiting in the waitForConnection function.
     *
     * @param ws - The websocket that was accepted.
     */
    private handleConnection(ws: WebSocket) {
        // Add connection to member, so that it can be obtained by waitForConnection
        if (this.lastConnection) {
            console.log('Warning: An incoming connection was ignored!');
            ws.close(
                1011,
                'Sombody already is already in the waiting room ... and there is no more room for you. Try again later.'
            );
            return;
        }
        this.lastConnection = ws;

        // Notify waitForConnection that a new connection was received
        if (this.acceptConnectionFn) {
            this.acceptConnectionFn();
        }
    }
}
