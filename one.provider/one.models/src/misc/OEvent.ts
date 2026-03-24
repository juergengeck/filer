import {Functor} from './Functor.js';

/**
 * Represents the behaviour when there are no listeners.
 * <br>
 *      -> Default - does nothing if no listener is registered.<br>
 *      -> Error - throws if no one is listening.<br>
 *      -> ExactlyOneListener - throws if connect is called more than one time. <br>
 */
export enum EventTypes {
    Default,
    Error,
    ExactlyOneListener
}

/**
 * Event handling class.
 *
 * This class manages event listeners and their invocation. Listeners are registered with the listen method - or better
 * by using the () operator of this class - and can be invoked with one of the emit* methods:
 *
 * - emit(args): Use when the emitter doesn't care about the result of the execution of the listeners.
 * - emitAll(args): Use when the emitter is interested in the results of the listeners execution or if the
 * emitter wants to wait until all listeners have completed their execution.
 * - emitRace(args): Use when the emitter is interested only in the first settled promise from the listeners.
 *
 * Executing handlers sequentially vs parallel:
 * -----------------------------------------------
 * emit & emitAll offer the possibility to execute the listeners handlers in parallel or sequentially.This is
 * configurable through the 'executeSequentially' optional parameter in the constructor. 'executeSequentially'
 * defaults to true.
 * - executeSequentially === true: If an event handler is disconnected from another event handler then the other handler
 * will not be called if it didn't run, yet. If a new one is connected it will be executed as last event handler.<br>
 * - executeSequentially === false: If an event handler is disconnected from another event handler then the other
 * handler will still be called (it already started because of being executed in parallel) - If one is connected in another event
 * handler it will not be called.
 *
 * Usage:
 * ------
 *
 * ``` typescript
 *  class CoffeeMachine {

 *      // Event that signals when the coffee machine is powered on / off.
 *      // state: true when powered on, false when powered off.
 *      public onPowerChange = new OEvent<(state: boolean) => void>();
 *
 *      // Turns the coffee machine on
 *      public turnOn() {
 *          //..
 *          this.onPowerChange.emit(true);
 *      }
 *
 *      // Turns the coffee machine off
 *      public turnOff() {
 *          //..
 *          this.onPowerChange.emit(false);
 *      }
 *  }
 *
 *  const coffeeMachine = new CoffeeMachine();
 *
 *  // Register onListenListener
 *  const disconnectOnListen = coffeeMachine.onPowerChange.onListen( () => {
 *      console.log('Somebody started listening for the powerChange events.')
 *  })
 *
 *  // Register onStopListenListener
 *  const disconnectOnStopListen = coffeeMachine.onPowerChange.onStopListen( () => {
 *      console.log('Somebody stopped listening for the powerChange events.')
 *  })
 *
 *  // Use the events provided by the class:
 *  const disconnect = coffeeMachine.onPowerChange(state => {
 *      if (state) {
 *          console.log('Coffee machine was turned on')
 *      } else {
 *          console.log('Coffee machine was turned off')
 *      }
 *  }); // This will print 'Somebody started listening for the powerChange events.'
 *
 *  coffeeMachine.turnOn(); // This will print 'Coffee machine was turned on'
 *  coffeeMachine.turnOff(); // This will print 'Coffee machine was turned off'
 *  disconnect(); // This will disconnect the connection and will print 'Somebody stopped
 *  listening for the powerChange events.'
 *  coffeeMachine.turnOn(); // This will print nothing
 *  coffeeMachine.turnOff(); // This will print nothing
 * ```
 *
 * OEvent is chosen as class name over Event, because the second option is reserved.
 *
 * @param T - The expected type (function signature) of the event listeners.
 */
export class OEvent<T extends (...arg: any) => any> extends Functor<
    (listener: (...args: Parameters<T>) => Promise<ReturnType<T>> | ReturnType<T>) => () => void
> {
    // TODO: Add proper listenOnError handler - this member based approach is bad.
    public onError: ((err: any) => void) | null = null;

    private listeners = new Set<
        (...args: Parameters<T>) => Promise<ReturnType<T>> | ReturnType<T>
    >();
    private onListenListeners = new Set<() => Promise<void> | void>();
    private onStopListenListeners = new Set<() => Promise<void> | void>();
    private readonly type: EventTypes;
    private readonly executeSequentially: boolean;

    /**
     * Create an OEvent object.
     *
     * @param type - The type of the event.
     * @param executeSequentially - Type of execution. See class descriptions for more detail.
     */
    constructor(type: EventTypes = EventTypes.Default, executeSequentially: boolean = true) {
        super((listener: (...args: Parameters<T>) => Promise<ReturnType<T>> | ReturnType<T>) =>
            this.listen(listener)
        );
        this.type = type;
        this.executeSequentially = executeSequentially;
    }

    /**
     * Registers a listener to be executed when the event is emitted.
     *
     * @param listener - The callback to be executed when the event is emitted.
     * @return a function that disconnects the listener.
     *         If executeSequentially is true: No further calls to the event
     *         listener will be made after this call.
     *         If executeSequentially is false: Further calls might happen when
     *         the disconnect happens in another event listener.
     */
    public listen(
        listener: (...args: Parameters<T>) => Promise<ReturnType<T>> | ReturnType<T>
    ): () => void {
        if (this.listeners.has(listener)) {
            console.error('callback already registered');
        }
        if (this.type === EventTypes.ExactlyOneListener && this.listeners.size > 0) {
            throw new Error('There already is a listener for this event.');
        }

        OEvent.executeAndIgnoreListeners(this.onListenListeners);

        this.listeners.add(listener);

        return () => {
            const found = this.listeners.delete(listener);

            OEvent.executeAndIgnoreListeners(this.onStopListenListeners);

            if (!found) {
                console.error('callback was not registered');
            }
        };
    }

    /**
     * Invoke all listeners and return the result of the first resolved promise.
     *
     * All event listeners will be executed in parallel - even if  executeSequentially is set to true. It just does not
     * make sense to have a race between listeners and then invoke them sequentially.
     *
     * It behaves like Promise.race() over all event listeners.
     *
     * @param listenerArguments - Arguments are passed to the invoked listeners.
     */
    public emitRace(...listenerArguments: Parameters<T>): Promise<ReturnType<T>> {
        this.checkListenerCount();
        return Promise.race(this.executeAndPromisifyListenersOnlyPromises(listenerArguments));
    }

    /**
     * Invokes all event listeners and returns the results of all listeners.
     *
     * Even if the listeners have a return value of void / Promise<void> this function is useful.
     * The returned promise of emitAll resolves after all event listeners have been executed,
     * so this method can be used to wait for the execution of all event handlers.
     *
     * It behaves like Promise.all() over all event listeners.
     *
     * @param listenerArguments - Arguments are passed to the invoked listeners.
     * @throws If only one listener throws, then the error is thrown directly, if multiple
     * errors are thrown, then a new error object is created that has an errors field with all
     * errors stored in an array.
     */
    public async emitAll(...listenerArguments: Parameters<T>): Promise<ReturnType<T>[]> {
        this.checkListenerCount();

        if (!this.executeSequentially) {
            return Promise.all(this.executeAndPromisifyEventListeners(listenerArguments));
        }

        const listenerResults: ReturnType<T>[] = [];
        const listenerErrors: any[] = [];

        for (const listener of this.listeners) {
            try {
                // need to run the listeners in sequence
                listenerResults.push(await listener(...listenerArguments));
            } catch (e) {
                listenerErrors.push(e);
            }
        }

        if (listenerErrors.length > 0) {
            if (listenerErrors.length === 1) {
                throw listenerErrors[0];
            } else {
                const errList = listenerErrors.map(e => String(e)).join(',\n');
                const thrownError: Error & {errors?: unknown[]} = new Error(
                    `Multiple listeners failed. Use "errors" property to access all errors. Errors: ${errList}`
                );
                thrownError.errors = listenerErrors;
                throw thrownError;
            }
        }

        return listenerResults;
    }

    /**
     * Invokes all event listeners.
     *
     * If a listener throws an error - or a listener returns a promise that rejects - the following will happen:
     * 1) All remaining event handlers will still be executed
     * 2) If onError callback exists: The onError callback will be called with the error
     * 3) Else: The errors will be logged with console.error()
     *
     * The listeners will be executed in parallel or sequentially based on the executeSequentially flag set in the
     * constructor.
     *
     * @param listenerArguments - Arguments are passed to the invoked listeners.
     */
    public emit(...listenerArguments: Parameters<T>): void {
        this.emitAll(...listenerArguments).catch(e => {
            if (this.onError) {
                try {
                    this.onError(e);
                } catch (ee) {
                    console.error('onError listener failed:', ee);
                }
            } else if (Array.isArray(e.errors)) {
                const errorsAndNewline = [];
                for (const eee of e.errors) {
                    errorsAndNewline.push('\n');
                    errorsAndNewline.push(eee);
                }
                console.error('Multiple event listeners failed:', errorsAndNewline);
            } else {
                console.error('Event listener failed:\n', e);
            }
        });
    }

    /**
     * Returns the number of registered event listeners.
     */
    public listenerCount(): number {
        return this.listeners.size;
    }

    /**
     * Register a listener to be triggered when a new listener is registered for this event.
     *
     * @param onListenListenerHandler
     * @returns
     */
    public onListen(onListenListenerHandler: () => Promise<void> | void): () => void {
        this.onListenListeners.add(onListenListenerHandler);
        return () => {
            const found = this.onListenListeners.delete(onListenListenerHandler);

            if (!found) {
                console.error('callback was not registered');
            }
        };
    }

    /**
     * Register a listener to be triggered when a listener is unregistered from this event.
     *
     * @param onStopListenListenerHandler
     * @returns
     */
    public onStopListen(onStopListenListenerHandler: () => Promise<void> | void): () => void {
        this.onStopListenListeners.add(onStopListenListenerHandler);
        return () => {
            const found = this.onStopListenListeners.delete(onStopListenListenerHandler);

            if (!found) {
                console.error('callback was not registered');
            }
        };
    }

    // ------------------- PRIVATE API -------------------

    /**
     * Invokes the listeners and wraps the return values in a promise.
     *
     * This is the correct format for Promise.race()
     *
     * @param listenerArguments - Arguments are passed to the invoked listeners.
     */
    private executeAndPromisifyListenersOnlyPromises(
        listenerArguments: Parameters<T>
    ): Promise<ReturnType<T>>[] {
        const promises: Promise<ReturnType<T>>[] = [];

        for (const listenerResult of this.executeAndPromisifyEventListeners(listenerArguments)) {
            promises.push(
                (async (): Promise<ReturnType<T>> => {
                    return listenerResult;
                })()
            );
        }

        return promises;
    }

    /**
     * Invokes the listeners and returns the return values (Either a promise or a value)
     *
     * This is the correct format for Promise.all()
     *
     * @param listenerArguments - Arguments are passed to the invoked listeners.
     */
    private executeAndPromisifyEventListeners(
        listenerArguments: Parameters<T>
    ): (Promise<ReturnType<T>> | ReturnType<T>)[] {
        const promises: (Promise<ReturnType<T>> | ReturnType<T>)[] = [];

        // Eliminate non deterministic behaviour when listeners disconnect other listeners while being invoked in
        // parallel.
        const listenerSet = [...this.listeners];

        for (const listener of listenerSet) {
            try {
                promises.push(listener(...listenerArguments));
            } catch (e) {
                promises.push(Promise.reject(e));
            }
        }

        return promises;
    }

    /**
     * Trigger all the listeners given as parameter.
     *
     * If a listener fails it writes the error to console.error.
     *
     * @param listeners
     * @private
     */
    private static executeAndIgnoreListeners(listeners: Set<() => Promise<void> | void>): void {
        const promises: (Promise<void> | void)[] = [];

        // Eliminate non deterministic behaviour when listeners disconnect other listeners while being invoked in
        // parallel.
        const listenerSet = [...listeners];

        for (const listener of listenerSet) {
            try {
                promises.push(listener());
            } catch (e) {
                promises.push(Promise.reject(e));
            }
        }

        Promise.all(promises).catch(err => console.error('A listener failed execution', err));
    }

    /**
     * Throws if nobody is listening and the event type is 'Error'
     */
    private checkListenerCount(): void {
        switch (this.type) {
            case EventTypes.Error:
                if (this.listeners.size === 0) {
                    throw new Error('Nobody is listening for this event.');
                }
                break;
            case EventTypes.ExactlyOneListener:
                if (this.listeners.size === 0) {
                    throw new Error('Nobody is listening for this event.');
                }
                break;
        }
    }
}
