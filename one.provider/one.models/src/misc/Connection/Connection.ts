import type {MessageBusObj} from '@refinio/one.core/lib/message-bus.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import type {EncryptedConnectionInterface} from '@refinio/one.core/lib/websocket-promisifier.js';
import {OEvent} from '../OEvent.js';
import MultiPromise from '../MultiPromise.js';
import type {IConnection} from './IConnection.js';
import type ConnectionPlugin from './ConnectionPlugin.js';
import type {ConnectionIncomingEvent, ConnectionOutgoingEvent} from './ConnectionPlugin.js';
import type PromisePlugin from './plugins/PromisePlugin.js';
import type {ConnectionStatistics} from './plugins/StatisticsPlugin.js';
import StatisticsPlugin from './plugins/StatisticsPlugin.js';
import WebSocketPlugin from './plugins/WebSocketPlugin.js';
import type EncryptionPlugin from './plugins/EncryptionPlugin.js';
import type {PingPlugin, PongPlugin} from './plugins/PingPongPlugin.js';
import {StateMachine} from '../StateMachine.js';
import NetworkPlugin from './plugins/NetworkPlugin.js';

const MessageBus = createMessageBus('Connection');
const MessageBus_connectionLifecycle = createMessageBus('Connection Lifecycle');

/**
 * This class is a wrapper for web sockets, that allows to receive messages with async / await
 * instead of using callbacks (onmessage onopen ...)
 *
 * It also has a on('message') event, because sometimes you just need it. When you solely use the
 * event based interface, and don't use the waitForMessage functions, then you need to set
 * disableWaitForMessage to true, because otherwise you will get an error that you didn't collect
 * incoming messages with waitFor... functions.
 */
export default class Connection implements IConnection, EncryptedConnectionInterface {
    /**
     *
     */
    public state: StateMachine<'connecting' | 'open' | 'closed', 'open' | 'close'>;

    /**
     * Event is emitted when a new message is received.
     */
    public onMessage = new OEvent<(message: Uint8Array | string) => void>();
    private plugins: ConnectionPlugin[] = [];
    private openPromises: MultiPromise<void>;

    // Members for unique id management for logging
    private static idCounter: number = 0;
    public readonly id: number = ++Connection.idCounter;
    public token?: string;

    /**
     * Chum streams use the websocket bufferedAmount number to control how fast the streams
     * provide data to the websocket stream.
     */
    get bufferedAmount() {
        const ws = this.websocketPlugin().webSocket;

        if (ws === null) {
            throw new Error('No websocket available yet');
        }

        return ws.bufferedAmount;
    }

    /**
     * Retrieve statistics.
     *
     * The StatisticsPlugin has to be registered in order for this to work.
     */
    get statistics(): ConnectionStatistics {
        if (!this.hasPlugin('statistics')) {
            return {
                bytesReceived: 0,
                bytesSent: 0
            };
        }

        return this.statisticsPlugin().statistics;
    }

    /**
     * Construct a new connection - at the moment based on WebSockets
     */
    constructor(webSocket: WebSocket, defaultOpenTimeout = Number.POSITIVE_INFINITY) {
        this.openPromises = new MultiPromise<void>(1, defaultOpenTimeout);

        this.state = new StateMachine<'connecting' | 'open' | 'closed', 'open' | 'close'>();

        this.state.addState('connecting');
        this.state.addState('open');
        this.state.addState('closed');
        this.state.setInitialState('connecting');

        this.state.addEvent('open');
        this.state.addEvent('close');

        this.state.addTransition('open', 'connecting', 'open');
        this.state.addTransition('close', 'connecting', 'closed');
        this.state.addTransition('close', 'open', 'closed');

        this.addPlugin(new WebSocketPlugin(webSocket));
        this.addPlugin(new StatisticsPlugin());
        this.addPlugin(new NetworkPlugin());
    }

    // ######## Socket Management & Settings ########

    /**
     * Closes the connection.
     *
     * This function waits for the other side to acknowledge.
     *
     * @param reason - Reason for timeout
     */
    public close(reason?: string): void {
        this.createOutogingEvent({type: 'close', reason, terminate: false});
    }

    /**
     * Terminates the connection immediately without waiting for the other side.
     *
     * @param reason - Reason for timeout
     */
    public terminate(reason?: string): void {
        this.createOutogingEvent({type: 'close', reason, terminate: false});
    }

    /**
     * Wait for the socket to be open.
     *
     * @param timeout
     */
    public async waitForOpen(timeout?: number): Promise<void> {
        if (this.state.currentState === 'open') {
            return;
        }

        if (this.state.currentState === 'closed') {
            throw new Error('This connection is closed. It will never be opened again.');
        }

        await this.openPromises.addNewPromise(timeout);
    }

    /**
     * Add a plugin to the connection.
     *
     * @param plugin
     * @param [options]
     * @param [options.after]
     * @param [options.before]
     */
    public addPlugin(
        plugin: ConnectionPlugin,
        options?: {
            after?: string;
            before?: string;
        }
    ): void {
        if (options && options.after !== undefined) {
            const idx = this.plugins.findIndex(p => p.name === options.after);
            this.plugins.splice(idx + 1, 0, plugin);
        } else if (options && options.before) {
            const idx = this.plugins.findIndex(p => p.name === options.before);
            this.plugins.splice(idx, 0, plugin);
        } else {
            this.plugins.push(plugin);
        }

        plugin.attachedToConnection(
            {
                createOutogingEvent: (event: ConnectionOutgoingEvent) =>
                    this.createOutogingEvent(event, plugin),
                createIncomingEvent: (event: ConnectionIncomingEvent) =>
                    this.createIncomingEvent(event, plugin)
            },
            this.id
        );

        if (this.state.currentState === 'open') {
            plugin.transformIncomingEvent({type: 'opened'});
        }
        if (this.state.currentState === 'closed') {
            plugin.transformIncomingEvent({
                type: 'closed',
                reason: 'Websocket already closed when plugin was attached.',
                origin: 'local'
            });
        }
    }

    public removePlugin(name: string) {
        const i = this.plugins.findIndex(plugin => plugin.name === name);
        if (i < 0) {
            throw new Error(`Plugin '${name}' not found`);
        }
        this.plugins.splice(i, 1);
    }

    public plugin(name: string): ConnectionPlugin {
        const plugin = this.plugins.find(p => p.name === name);
        if (plugin === undefined) {
            throw new Error(`Requested plugin '${name}' was not added.`);
        }
        return plugin;
    }

    public hasPlugin(name: string): boolean {
        return this.plugins.find(plugin => plugin.name === name) !== undefined;
    }

    public promisePlugin(): PromisePlugin {
        return this.plugin('promise') as PromisePlugin;
    }

    public websocketPlugin(): WebSocketPlugin {
        return this.plugin('websocket') as WebSocketPlugin;
    }

    public encryptionPlugin(): EncryptionPlugin {
        return this.plugin('encryption') as EncryptionPlugin;
    }

    public pingPlugin(): PingPlugin {
        return this.plugin('ping') as PingPlugin;
    }

    public pongPlugin(): PongPlugin {
        return this.plugin('pong') as PongPlugin;
    }

    public statisticsPlugin(): StatisticsPlugin {
        return this.plugin('statistics') as StatisticsPlugin;
    }

    // ######## Sending messages ########

    /**
     * Send data to the websocket.
     * @param message
     */
    public send(message: Uint8Array | string): void {
        // Transformed message
        this.createOutogingEvent({type: 'message', data: message});
    }

    // Logging

    public log(bus: MessageBusObj, message: string) {
        bus.send('log', this.formatForConnection(message));
    }

    public debug(bus: MessageBusObj, message: string) {
        bus.send('debug', this.formatForConnection(message));
    }

    // ######## Private API ########

    /**
     * Create an outgoing event that will be piped through all plugins.
     *
     * @param event
     * @param beforePlugin
     * @private
     */
    private createOutogingEvent(
        event: ConnectionOutgoingEvent,
        beforePlugin?: ConnectionPlugin
    ): void {
        this.debugForPlugin(
            beforePlugin ? beforePlugin.name : 'Connection',
            'createOutogingEvent',
            event
        );

        const transformedEvent = this.pluginsTransformOutgoingEvent(event, beforePlugin);
        if (transformedEvent !== null) {
            console.error('Outgoing event was not processed', event, transformedEvent);
        }
    }

    /**
     * Create an incoming event that will be piped through all plugins.
     *
     * @param event
     * @param afterPlugin - If specified, then only pipe through plugins that were registered after
     * the plugin.
     * @private
     */
    private createIncomingEvent(
        event: ConnectionIncomingEvent,
        afterPlugin?: ConnectionPlugin
    ): void {
        try {
            this.debugForPlugin(
                afterPlugin ? afterPlugin.name : 'Connection',
                'createIncomingEvent',
                event
            );

            const transformedEvent = this.pluginsTransformIncomingEvent(event, afterPlugin);
            if (transformedEvent === null) {
                return;
            }
            try {
                if (transformedEvent.type === 'message') {
                    this.onMessage.emit(transformedEvent.data);
                }
                if (transformedEvent.type === 'opened') {
                    MessageBus_connectionLifecycle.send('log', `${this.id}: Opened connection.`);
                    this.state.triggerEvent('open');
                    this.openPromises.resolveAll();
                }
                if (transformedEvent.type === 'closed') {
                    MessageBus_connectionLifecycle.send(
                        'log',
                        `${this.id}: Closed connection ${transformedEvent.origin}ly. ${transformedEvent.reason}`
                    );
                    this.state.triggerEvent('close');
                    this.openPromises.rejectAll(
                        new Error(`Failed to open connection. ${transformedEvent.reason}`)
                    );
                }
            } catch (e) {
                this.close(e.message);
                console.error(e);
            }
        } catch (e) {
            this.close(e.message);
        }
    }

    /**
     * Calla the
     *
     * @param event
     * @param beforePlugin
     */
    private pluginsTransformOutgoingEvent(
        event: ConnectionOutgoingEvent,
        beforePlugin?: ConnectionPlugin
    ): ConnectionOutgoingEvent | null {
        const plugins = [...this.plugins].reverse();

        if (beforePlugin) {
            const index = plugins.findIndex(plugin => plugin === beforePlugin);
            plugins.splice(0, index + 1);
        }

        let intermediateEvent = event;

        for (const plugin of plugins) {
            this.debugForPlugin(plugin.name, 'transformOutgoingEvent', intermediateEvent);

            const transformedMessage = plugin.transformOutgoingEvent(intermediateEvent);
            if (transformedMessage === null) {
                this.debugForPlugin('FIN', 'transformOutgoingEvent', transformedMessage);
                return null;
            }
            intermediateEvent = transformedMessage;
        }

        this.debugForPlugin('FIN', 'transformOutgoingEvent', intermediateEvent);
        return intermediateEvent;
    }

    /**
     * Transform incoming events through all plugins.
     *
     * @param event
     * @param afterPlugin
     */
    private pluginsTransformIncomingEvent(
        event: ConnectionIncomingEvent,
        afterPlugin?: ConnectionPlugin
    ): ConnectionIncomingEvent | null {
        let transformedEvent: ConnectionIncomingEvent | null = event;

        const startIdx =
            afterPlugin === undefined
                ? -1
                : this.plugins.findIndex(plugin => plugin === afterPlugin);

        for (let i = startIdx + 1; i < this.plugins.length; i++) {
            const plugin = this.plugins[i];
            
            transformedEvent = plugin.transformIncomingEvent(transformedEvent);

            if (transformedEvent === null) {
                this.debugForPlugin(plugin.name, 'transformIncomingEvent', transformedEvent);
                return null;
            }
        }

        this.debugForPlugin('FIN', 'transformIncomingEvent', transformedEvent);
        return transformedEvent;
    }

    private logForPlugin(
        pluginName: string,
        functionName: string,
        event: ConnectionIncomingEvent | ConnectionOutgoingEvent | null
    ) {
        MessageBus.send('log', this.formatForPlugin(pluginName, functionName, event));
    }

    private debugForPlugin(
        _pluginName: string,
        _functionName: string,
        _event: ConnectionIncomingEvent | ConnectionOutgoingEvent | null
    ) {
        //MessageBus.send('debug', this.formatForPlugin(pluginName, functionName, event));
    }

    private formatForPlugin(
        pluginName: string,
        functionName: string,
        event: ConnectionIncomingEvent | ConnectionOutgoingEvent | null
    ) {
        const evtext =
            event === null
                ? 'null'
                : `${event.type} ${
                      event.type === 'message' ? `${typeof event.data} ${event.data.length}` : ''
                  }`;

        return `${this.id.toString().padStart(4, ' ')} ${pluginName.padEnd(
            12,
            ' '
        )} ${functionName.padEnd(24, ' ')} ${evtext}`;
    }

    private formatForConnection(message: string) {
        return `${this.id.toString().padStart(4, ' ')} ${message}`;
    }
}
