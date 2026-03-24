import {StateMachine} from '../misc/StateMachine.js';
import {OEvent} from '../misc/OEvent.js';

/**
 * Model's Base Class.
 */
export abstract class Model {
    public state: StateMachine<'Uninitialised' | 'Initialised', 'shutdown' | 'init'>;

    public onUpdated: OEvent<() => void> = new OEvent<() => void>();

    constructor() {
        this.state = new StateMachine<'Uninitialised' | 'Initialised', 'shutdown' | 'init'>();
        this.state.addState('Initialised');
        this.state.addState('Uninitialised');
        this.state.addEvent('init');
        this.state.addEvent('shutdown');
        this.state.addTransition('shutdown', 'Initialised', 'Uninitialised');
        this.state.addTransition('init', 'Uninitialised', 'Initialised');
        this.state.setInitialState('Uninitialised');
    }

    abstract shutdown(): Promise<void>;
}
