import readline from 'readline';
import {StateMachine} from '../misc/StateMachine.js';

type SMStates = 'initialized' | 'not initialized' | 'A' | 'B' | 'listening' | 'not listening';
type SMEvents = 'init' | 'shutdown' | 'AtoB' | 'BtoA' | 'startListen' | 'stopListen';

/**
 * Main function. This exists to be able to use await here.
 */
async function main(): Promise<void> {
    // Describe state machine
    const subSMLvl2 = new StateMachine<SMStates, SMEvents>();
    subSMLvl2.addState('A');
    subSMLvl2.addState('B');
    subSMLvl2.setInitialState('A', false);
    subSMLvl2.addEvent('AtoB');
    subSMLvl2.addEvent('BtoA');
    subSMLvl2.addTransition('AtoB', 'A', 'B');
    subSMLvl2.addTransition('BtoA', 'B', 'A');

    const subSMLvl1 = new StateMachine<SMStates, SMEvents>();
    subSMLvl1.addState('listening', subSMLvl2);
    subSMLvl1.addState('not listening');
    subSMLvl1.setInitialState('not listening', false);
    subSMLvl1.addEvent('startListen');
    subSMLvl1.addEvent('stopListen');
    subSMLvl1.addTransition('startListen', 'not listening', 'listening');
    subSMLvl1.addTransition('stopListen', 'listening', 'not listening');

    const sm = new StateMachine<SMStates, SMEvents>();
    sm.addState('initialized', subSMLvl1);
    sm.addState('not initialized');
    sm.setInitialState('not initialized', false);
    sm.addEvent('shutdown');
    sm.addEvent('init');
    sm.addTransition('init', 'not initialized', 'initialized');
    sm.addTransition('shutdown', 'B', 'not initialized');
    sm.addTransition('shutdown', 'not initialized', 'not initialized');

    console.log('Localize B', sm.locateState('B'));

    // ######## CONSOLE I/O ########

    // Setup console for triggering events
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    // Stop everything at sigint
    function sigintHandler() {
        rl.close();
    }

    rl.on('SIGINT', sigintHandler);
    process.on('SIGINT', sigintHandler);

    sm.onEnterState(state => {
        console.log('SM onEnterState: ' + state);
    });
    sm.onLeaveState(state => {
        console.log('SM onLeaveState: ' + state);
    });

    sm.onStateChange((oldState, newState, event) => {
        console.log(
            'SM onStateChange: [oldState] = ' +
                oldState +
                ' [newState] = ' +
                newState +
                ' [event] = ' +
                event
        );
    });

    sm.onStatesChange((oldStates, newStates, event) => {
        console.log(
            'SM onStatesChange: [oldState] = ' +
                String(oldStates) +
                ' [newState] = ' +
                String(newStates) +
                ' [event] = ' +
                event
        );
    });

    // subSMLvl1.onEnterState(state => {
    //     console.log('subSMLvl1 onEnterState: ' + state);
    // });
    // subSMLvl1.onLeaveState(state => {
    //     console.log('subSMLvl1 onLeaveState: ' + state);
    // });
    //
    // subSMLvl1.onStateChange((oldState, newState, event) => {
    //     console.log(
    //         'subSMLvl1 onStateChange: [oldState] = ' +
    //             oldState +
    //             ' [newState] = ' +
    //             newState +
    //             ' [event] = ' +
    //             event
    //     );
    // });
    //
    // subSMLvl1.onStatesChange((oldStates, newStates, event) => {
    //     console.log(
    //         'subSMLvl1 onStatesChange: [oldState] = ' +
    //             oldStates +
    //             ' [newState] = ' +
    //             newStates +
    //             ' [event] = ' +
    //             event
    //     );
    // });
    //
    // subSMLvl2.onEnterState(state => {
    //     console.log('subSMLvl2 onEnterState: ' + state);
    // });
    // subSMLvl2.onLeaveState(state => {
    //     console.log('subSMLvl2 onLeaveState: ' + state);
    // });
    //
    // subSMLvl2.onStateChange((oldState, newState, event) => {
    //     console.log(
    //         'subSMLvl2 onStateChange: [oldState] = ' +
    //             oldState +
    //             ' [newState] = ' +
    //             newState +
    //             ' [event] = ' +
    //             event
    //     );
    // });
    //
    // subSMLvl2.onStatesChange((oldStates, newStates, event) => {
    //     console.log(
    //         'subSMLvl2 onStatesChange: [oldState] = ' +
    //             oldStates +
    //             ' [newState] = ' +
    //             newStates +
    //             ' [event] = ' +
    //             event
    //     );
    // });

    // Read from stdin
    for await (const line of rl) {
        console.log('====================================================');
        console.log('Triggered event: ' + line);

        sm.triggerEvent(<SMEvents>line);

        console.log('1. sm Current STATE:', sm.currentState);
        console.log('1. sm Current States: ', sm.currentStates);

        // console.log('2. subSMLvl1 Current STATE:', subSMLvl1.currentState);
        // console.log('2. subSMLvl1 Current States: ', subSMLvl1.currentStates);
        //
        // console.log('3. subSMLvl2 Current STATE:', subSMLvl2.currentState);
        // console.log('3. subSMLvl2 Current States: ', subSMLvl2.currentStates);
    }
}

// Execute main function
main().catch(e => {
    console.log('Error happened: ' + e.toString());
});
