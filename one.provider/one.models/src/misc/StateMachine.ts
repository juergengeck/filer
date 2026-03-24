import {OEvent} from './OEvent.js';

/**
 *
 * State machine class.
 *
 * This class manages state machines and their events emits.
 *
 * Emitted events
 * --------------
 *
 * The state machines emit 4 event types:
 * - onEnterState(enteredState: StateT) - Emitted when the state machine enters a new state. If the entered state
 *  has subStates, the event will be emitted for each subStateMachine, from top to the bottom.
 * - onLeaveState(leftState: StateT) - Emitted when the state machine leaves a state. If the left state has
 * subStates, the event will be emitted for each subStateMachine, from the bottom to the top.
 * - onStateChange(srcState: StateT, dstState: StateT, event: EventT) - Emitted when a transition happens. The
 * source state and the destination state represent the deepest states of the transition.
 * - srcStates: StateT[], dstStates: StateT[], event: EventT) - Emitted when a transition happens. The source states
 * and the destination states contain all the subStates of the source and destination states, from top to the
 * bottom.
 *
 *
 * History
 * -------
 * The history configuration gives the possibility to specify if leaving a state will reset the sub state machine to the initial
 * state or not. If the history flag is set to true, the sub state machine is not reset and when the parent
 * state machine enters the state back, the old state of the sub state machine is restored. The history configuration
 * can be optionally set through the setInitialState call. Default value is 'false'.
 *
 *
 * Transition between current SM state and subSM states
 * ---------------------------------------------------
 * Transitions between current state machine and states of the subStateMachines can be defined, only if the source
 * state or the destination state represent states of the state machine for which the transition is defined.
 *
 * ```typescript
 * // Example (see StateMachine uml from Usage):
 * stateMachine.addTransition('eventName', 'NotInitialized', 'Initialized') //  -> OK, both states are state of stateMachine
 * stateMachine.addTransition('eventName', 'NotListening', 'Listening') // -> throws, none of the states is a state of stateMachine
 * stateMachine.addTransition('eventName', 'NotInitialized', 'Listening') // -> OK, 'NotInitialized' is a state of stateMachine and 'Listening' is a sub state
 * stateMachine.addTransition('eventName', 'NotListening', 'NotInitialized') // -> OK, 'NotInitialized' is a state of stateMachine and 'NotListening' is a sub state
 * ```
 *
 *
 * Usage:
 * ------
 * The following state machine will be created in typescript:
 * <uml>
 * hide empty description
 * [*] -> NotInitialized
 * Initialized -left-> NotInitialized : shutdown
 * NotInitialized -right-> Initialized[H] : init
 * state Initialized {
 *     [*] --> NotListening
 *     NotListening -right-> Listening : startListen
 *     Listening -left-> NotListening : stopListen
 * }
 * </uml>
 *
 *
 * ```typescript
 * // The state machine must be created from bottom to the top. Therefore the sub state machine is created first.
 * const subStateMachine = new StateMachine<SMStates, SMEvents>();
 * subStateMachine.addState('Listening');
 * subStateMachine.addState('NotListening');
 * // history configuration is set through 'setInitialState'
 * subStateMachine.setInitialState('NotListening',true);
 * subStateMachine.addTransition('startListen','NotListening','Listening');
 * subStateMachine.addTransition('stopListen', 'Listening', 'NotListening');
 *
 * // Create top state machine and set the subState machine with addState.
 * const stateMachine = new StateMachine<SMStates, SMEvents>();
 * stateMachine.addState('NotInitialized');
 * // set the subStateMachine for the 'Initialized' state
 * stateMachine.addState('Initialized', subStateMachine);
 * stateMachine.setInitialState('shutdown');
 * stateMachine.addTransition('init','NotInitialized','Initialized');
 * stateMachine.addTransition('shutdown', 'Initialized', 'NotInitialized');
 *
 * // listen for events
 * stateMachine.onEnterState( enteredState => {
 *     //...
 * }
 *
 * // trigger events
 * stateMachine.triggerEvent('init');
 * stateMachine.triggerEvent('startListen');
 * ```
 */

export class StateMachine<StateT extends string, EventT> {
    /**
     * Emitted when the state machine enters a state.
     */
    public onEnterState = new OEvent<(enteredState: StateT) => void>();

    /**
     * Emitted when the state machine leaves a state.
     */
    public onLeaveState = new OEvent<(leftState: StateT) => void>();

    /**
     * Emitted when the state machine executes a transition. The srcState
     * and the dstState values represent the deepest source state and
     * destination state respectively.
     */
    public onStateChange = new OEvent<
        (srcState: StateT, dstState: StateT, event: EventT) => void
    >();

    /**
     * Emitted when the state machine executes a transition. The srcStates
     * and the dstStates arrays contain the full state hierarchy, from top
     * to the bottom.
     */
    public onStatesChange = new OEvent<
        (srcStates: StateT[], dstStates: StateT[], event: EventT) => void
    >();

    /**
     * The current state.
     * @private
     */
    private crtState: StateT | undefined = undefined;

    /**
     * True if the state machine should not be reset when the parent state
     * machine leaves the associated state.
     * @private
     */
    private hasHistory = false;

    /**
     * The initial state to which the state machine resets to.
     * @private
     */
    private initialState: StateT | undefined = undefined;

    /**
     * The transitions map.
     * @private
     */
    private transitions: Map<EventT, Map<StateT, StateT>> = new Map<EventT, Map<StateT, StateT>>();

    /**
     * The events array.
     * @private
     */
    private events: EventT[] = [];

    /**
     * The states array.
     * @private
     */
    private states: StateT[] = [];

    /**
     * The map of the subStateMachines. A subStateMachine is associated to a state of
     * the state machine.
     * @private
     */
    private subStateMachines = new Map<StateT, StateMachine<StateT, EventT>>();

    /**
     * Current (deepest) state of the state machine.
     */
    public get currentState(): StateT {
        return this.currentStates[this.currentStates.length - 1];
    }

    /**
     * Current state of the state machine as an array, including all subStateMachines
     * current states, from top to the bottom.
     */
    public get currentStates(): StateT[] {
        return this.getCurrentStates();
    }

    /**
     * Add a new state to the state machine. If the subStateMachine parameter is present, it
     * means the given state has subStates, represented by the given subStateMachine.
     * @param state - The state to be added.
     * @param subStateMachine - The subStateMachine associated with the given state.
     */
    addState(state: StateT, subStateMachine?: StateMachine<StateT, EventT>) {
        this.states.push(state);

        if (subStateMachine) {
            this.subStateMachines.set(state, subStateMachine);
        }
    }

    /**
     * Set the initial state and the history of the state machine.
     * @param state - the initial state.
     * @param hasHistory - rather the state machine has history or not. Defaults to false.
     */
    setInitialState(state: StateT, hasHistory = false) {
        if (!this.states.includes(state)) {
            throw new Error('Unknown initial state: ' + state);
        }
        this.initialState = state;
        this.crtState = state;
        this.hasHistory = hasHistory;
    }

    /**
     * Add an event to state machine.
     * @param event - the event to be added.
     */
    addEvent(event: EventT) {
        this.events.push(event);
    }

    /**
     * Add a transition to the state machine.
     * @param event - The event which triggers the transition.
     * @param srcState - The source state of the transition. It must be either a state of the current state machine
     * or a sub state, only if dstState is a state of the current state machine.
     * @param dstState - The destination state of the transition. It must be either a state of the current state
     * machine or a sub state, only if srcState is a state of the current machine.
     */
    addTransition(event: EventT, srcState: StateT, dstState: StateT) {
        if (!this.events.includes(event)) {
            throw new Error('Unknown event for transition: ' + event);
        }

        if (!this.hasState(srcState)) {
            throw new Error(`Unknown state for transition: ${srcState}`);
        }

        if (!this.hasState(dstState)) {
            throw new Error(`Unknown state for transition: ${dstState}`);
        }

        if (!this.states.includes(srcState) && !this.states.includes(dstState)) {
            throw new Error(
                `Transition doesn't influence the top level: ${srcState} ${dstState}. Perhaps the transition should be added at a lower level.`
            );
        }

        const transitionsForEvent = this.transitions.get(event);
        if (transitionsForEvent) {
            transitionsForEvent.set(srcState, dstState);
        } else {
            this.transitions.set(event, new Map([[srcState, dstState]]));
        }
    }

    /**
     * Triggers the given event.
     * - If the event maps to a transition in the state machine, it will execute
     *  the transition, otherwise the event is propagated to the subStateMachines.
     * - If the given event doesn't map to a transition in the state machine
     * or its subStateMachines, it will be ignored.
     * @param event - The triggered event.
     */
    triggerEvent(event: EventT) {
        if (this.crtState === undefined) {
            throw new Error('Current state is undefined');
        }

        const transitionsForEvent = this.transitions.get(event);

        if (!transitionsForEvent) {
            // propagate event to sub state machines
            const subStateMachine = this.subStateMachines.get(this.crtState);

            if (!subStateMachine) {
                throw new Error('Event is not valid in the current state.');
            }

            const srcStates = this.currentStates;

            subStateMachine.triggerEvent(event);

            this.notifyListeners(srcStates, this.currentStates, event);

            return;
        }

        const sourceStatesForEvent = Array.from(transitionsForEvent.keys());

        // make sure the transition exists from the current state
        if (
            !sourceStatesForEvent.includes(this.crtState) &&
            !sourceStatesForEvent.includes(this.currentState)
        ) {
            // from now, search for a sub state machine that may have the transition
            if (
                !this.doesTransitionExistInSubStateMachine(
                    this.subStateMachines.get(this.crtState),
                    event
                )
            ) {
                throw new Error(
                    'The transition does not exist from the current state with the' +
                        ' specified event'
                );
            }
        }

        this.currentStates.forEach(state => {
            const dstState = transitionsForEvent.get(state);
            if (dstState) {
                const srcStates = this.currentStates;

                if (this.crtState === undefined) {
                    throw new Error('Current state is undefined.');
                }

                this.executeTransition(event, this.crtState, dstState);

                this.notifyListeners(srcStates, this.currentStates, event);
            }
        });
    }

    /**
     * Reset to the initial state the stateMachine and its subStateMachines, if
     * they don't have history.
     * @param event - The event which triggered the reset.
     */
    reset(event: EventT) {
        if (this.crtState === undefined) {
            throw new Error('Current state is undefined.');
        }
        if (this.initialState === undefined) {
            throw new Error('Initial state is undefined');
        }

        const subStateMachine = this.subStateMachines.get(this.crtState);
        const srcStates = this.currentStates;

        if (subStateMachine) {
            subStateMachine.reset(event);
        }

        if (!this.hasHistory && this.crtState !== this.initialState) {
            this.crtState = this.initialState;
            this.notifyListeners(srcStates, this.currentStates, event);
        }
    }

    /**
     * Search for the state in the subStateMachines.
     *
     * Returns an array of states, from top to the bottom, the last state
     * in the array being the state given as parameter.
     * @param state - The state to be located. Will be the last in the array.
     */
    locateState(state: StateT): StateT[] {
        const localState = this.locateStateRecursively(state, this, []);

        if (!localState) {
            throw new Error('Could not localize state: ' + state);
        }

        return localState.reverse();
    }

    /**
     * Checks if the current state is the one passed, if not, throws an error.
     *
     * @param state - The state to check the current state.
     */
    assertCurrentState(state: StateT): void {
        const currentStates = this.getCurrentStates();
        if (!currentStates.includes(state)) {
            throw new Error(`The current state of the state machine is not ${state}`);
        }
    }

    /*waitForState(state: StateT, timeout?: number): Promise<void> {

    }*/

    // ------------------------------- PRIVATE API -------------------------------

    /**
     * Check if the given state is a state of a subState of the state machine.
     * @param state - The searched state.
     * @private
     */
    private hasState(state: StateT): boolean {
        if (this.states.includes(state)) {
            return true;
        }
        if (!this.subStateMachines) {
            return false;
        }
        for (const subStateMachine of this.subStateMachines.values()) {
            if (subStateMachine.hasState(state)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Creates a states array from the state machine current state and all its subStateMachines current states.
     * @param currentStates
     */
    private getCurrentStates(currentStates?: StateT[]): StateT[] {
        if (this.crtState === undefined) {
            throw new Error('Current state is undefined.');
        }
        if (!currentStates) {
            currentStates = [];
        }
        currentStates.push(this.crtState);

        const subMachine = this.subStateMachines.get(this.crtState);

        if (subMachine) {
            if (subMachine.crtState === undefined) {
                throw new Error('Current state is undefined.');
            }

            return subMachine.getCurrentStates(currentStates);
        }

        return currentStates;
    }

    /**
     * Search the given state in the current state machine or its subStateMachines recursively.
     * - if state doesn't exist in current SM or its subStateMachines -  null it's returned.
     * - if state exists in current SM or its subStateMachines - an array containing all the states
     * its returned, states being ordered from the bottom to the top.
     * @param searchedState - the state to be located.
     * @param stateMachine - the state machine to search the state into.
     * @param states - the result states array.
     * @private
     */
    private locateStateRecursively(
        searchedState: StateT,
        stateMachine: StateMachine<StateT, EventT>,
        states: StateT[]
    ): StateT[] | null {
        if (stateMachine.states.includes(searchedState)) {
            states.push(searchedState);
            return states;
        }

        if (stateMachine.subStateMachines.size === 0) {
            return null;
        }

        for (const [state, subStateMachine] of stateMachine.subStateMachines.entries()) {
            const returnStates = this.locateStateRecursively(
                searchedState,
                subStateMachine,
                states
            );

            if (returnStates !== null) {
                states.push(state);
                return states;
            }
        }

        return null;
    }

    /**
     * Search recursively for transition for the given event in the sub state machines.
     * @param subStateMachine
     * @param event
     * @private
     */
    private doesTransitionExistInSubStateMachine(
        subStateMachine: StateMachine<StateT, EventT> | undefined,
        event: EventT
    ): boolean {
        if (this.crtState === undefined) {
            throw new Error('Current state is undefined.');
        }

        if (subStateMachine === undefined) {
            return false;
        }

        const subStateMachineTransitions = subStateMachine.transitions.get(event);

        if (subStateMachineTransitions === undefined) {
            return false;
        }

        if (subStateMachine.crtState === undefined) {
            throw new Error('Current sub state machine state is undefined.');
        }

        const subStateMachineSourceStates = Array.from(subStateMachineTransitions.keys());

        const isTransitionValid = subStateMachineSourceStates.includes(subStateMachine.crtState);

        if (!isTransitionValid) {
            const nextSubStateMachine = subStateMachine.subStateMachines.get(
                subStateMachine.crtState
            );
            if (nextSubStateMachine === undefined) {
                return false;
            }
            // search in the sub-sub state machine
            return this.doesTransitionExistInSubStateMachine(nextSubStateMachine, event);
        }

        return true;
    }

    /**
     * Executes a transition by updating the current state and resetting the subStateMachines,
     * if the subStateMachines don't have history.
     * @param event - The event which triggered the transition.
     * @param srcState - The source state.
     * @param dstState - The destination state.
     * @private
     */
    private executeTransition(event: EventT, srcState: StateT, dstState: StateT) {
        if (this.crtState === undefined) {
            throw new Error('Current state is undefined.');
        }

        if (!this.states.includes(dstState)) {
            this.executeTransitionToSubState(dstState, event);
        } else {
            this.crtState = dstState;
        }

        // reset subStateMachines
        const subStateMachine = this.subStateMachines.get(srcState);
        if (subStateMachine) {
            subStateMachine.reset(event);
        }
    }

    /**
     * Execute a transition from the current state machine to a sub state.
     * @param dstState - The destination sub state.
     * @param event - The event which triggered the transition.
     * @param notifyListeners - True if the events should be emitted.
     * @private
     */
    private executeTransitionToSubState(dstState: StateT, event: EventT, notifyListeners = false) {
        const stateLocation = this.locateState(dstState);
        const currentSMDstState = stateLocation[0];
        const srcStates = this.currentStates;
        this.crtState = currentSMDstState;
        const subSM = this.subStateMachines.get(currentSMDstState);

        if (subSM) {
            if (subSM.crtState === undefined) {
                throw new Error('Current state is undefined.');
            }
            subSM.executeTransitionToSubState(dstState, event, true);
        }

        if (notifyListeners) {
            this.notifyListeners(srcStates, this.currentStates, event);
        }
    }

    /**
     * Emit the events.
     * @param srcStates - The source states, from top to the bottom.
     * @param dstStates - The destination states, from top to the bottom.
     * @param event - The event which triggered the transition.
     * @private
     */
    private notifyListeners(srcStates: StateT[], dstStates: StateT[], event: EventT) {
        srcStates
            .slice()
            .reverse()
            .forEach(state => {
                if (!this.currentStates.includes(state)) {
                    this.onLeaveState.emit(state);
                }
            });
        this.currentStates.forEach(state => {
            if (!srcStates.includes(state)) {
                this.onEnterState.emit(state);
            }
        });
        this.onStateChange.emit(
            srcStates[srcStates.length - 1],
            dstStates[dstStates.length - 1],
            event
        );
        this.onStatesChange.emit(srcStates, dstStates, event);
    }
}
