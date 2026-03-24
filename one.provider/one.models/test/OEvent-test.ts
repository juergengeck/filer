import {expect} from 'chai';

import {closeAndDeleteCurrentInstance} from '@refinio/one.core/lib/instance.js';
import {wait} from '@refinio/one.core/lib/util/promise.js';

import {EventTypes, OEvent} from '../lib/misc/OEvent.js';
import TestModel from './utils/TestModel.js';
import * as StorageTestInit from './_helpers.js';

let testModel: TestModel;

describe('OEvent test', () => {
    before(async () => {
        await StorageTestInit.init();
        const model = new TestModel('ws://localhost:8000');
        await model.init(undefined);
        testModel = model;
    });

    after(async () => {
        await testModel.shutdown();
        await closeAndDeleteCurrentInstance();
    });

    it('emit sync - check listener handle is called sequentially ', async () => {
        const onEvent = new OEvent<(stringVal: string, numberVal: number) => void>(
            EventTypes.Default,
            true
        );

        let handlerCalled1 = false;
        let handlerCalled2 = false;
        let stringVal = null;
        let numberVal = null;

        const disconnect1 = onEvent((emittedStringVal: string, emittedNumberVal: number) => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    handlerCalled1 = true;
                    stringVal = emittedStringVal;
                    numberVal = emittedNumberVal;
                    resolve();
                }, 100);
            });
        });
        const disconnect2 = onEvent((emittedStringVal: string, emittedNumberVal: number) => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    handlerCalled2 = true;
                    stringVal = emittedStringVal;
                    numberVal = emittedNumberVal;
                    resolve();
                }, 2 * 100);
            });
        });
        expect(handlerCalled1).to.be.equal(false);
        expect(handlerCalled2).to.be.equal(false);
        expect(stringVal).to.be.equal(null);
        expect(numberVal).to.be.equal(null);

        onEvent.emit('EMIT AND FORGET STRING', 123);

        expect(handlerCalled1).to.be.equal(false);
        expect(handlerCalled2).to.be.equal(false);
        expect(stringVal).to.be.equal(null);
        expect(numberVal).to.be.equal(null);
        await wait(200);

        expect(handlerCalled1).to.be.equal(true);
        expect(handlerCalled2).to.be.equal(false);

        await wait(200);
        expect(handlerCalled1).to.be.equal(true);
        expect(handlerCalled2).to.be.equal(true);

        expect(stringVal).to.be.equal('EMIT AND FORGET STRING');
        expect(numberVal).to.be.equal(123);

        disconnect1();
        disconnect2();
    }).timeout(1000);

    it('emit async - check listener handle is called in parallel ', async () => {
        const onEvent = new OEvent<(arg1: string, arg2: number) => void>(EventTypes.Default, false);

        let handlerCalled1 = false;
        let handlerCalled2 = false;
        let stringVal = null;
        let numberVal = null;

        const disconnect1 = onEvent((emitStringValue: string, emitNumberValue: number) => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    handlerCalled1 = true;
                    stringVal = emitStringValue;
                    numberVal = emitNumberValue;
                    resolve();
                }, 100);
            });
        });
        const disconnect2 = onEvent((emitStringValue: string, emitNumberValue: number) => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    handlerCalled2 = true;
                    stringVal = emitStringValue;
                    numberVal = emitNumberValue;
                    resolve();
                }, 100);
            });
        });
        expect(handlerCalled1).to.be.equal(false);
        expect(handlerCalled2).to.be.equal(false);
        expect(stringVal).to.be.equal(null);
        expect(numberVal).to.be.equal(null);

        onEvent.emit('EMIT AND FORGET STRING', 123);

        expect(handlerCalled1).to.be.equal(false);
        expect(handlerCalled2).to.be.equal(false);
        expect(stringVal).to.be.equal(null);
        expect(numberVal).to.be.equal(null);

        await wait(150);

        expect(handlerCalled1).to.be.equal(true);
        expect(handlerCalled2).to.be.equal(true);
        expect(stringVal).to.be.equal('EMIT AND FORGET STRING');
        expect(numberVal).to.be.equal(123);

        disconnect1();
        disconnect2();
    }).timeout(1000);

    it('emitAll sync - promise settles when all handlers executed sequentially ', async () => {
        const onEvent = new OEvent<() => void>(EventTypes.Default, true);

        let handlerCalled1 = false;
        let handlerCalled2 = false;
        let handlerCalled3 = false;

        let promiseSettled = false;

        const disconnect1 = onEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    handlerCalled1 = true;
                    resolve();
                }, 2 * 100);
            });
        });
        const disconnect2 = onEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    handlerCalled2 = true;
                    resolve();
                }, 2 * 100);
            });
        });
        const disconnect3 = onEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    handlerCalled3 = true;
                    resolve();
                }, 3 * 100);
            });
        });
        onEvent
            .emitAll()
            .then(() => {
                promiseSettled = true;
            })
            .catch(err => console.error(err));
        expect(handlerCalled1).to.be.equal(false);
        expect(handlerCalled2).to.be.equal(false);
        expect(handlerCalled3).to.be.equal(false);
        expect(promiseSettled).to.be.equal(false);

        await wait(300);
        expect(handlerCalled1).to.be.equal(true);
        expect(handlerCalled2).to.be.equal(false);
        expect(handlerCalled3).to.be.equal(false);
        expect(promiseSettled).to.be.equal(false);

        await wait(200);
        expect(handlerCalled1).to.be.equal(true);
        expect(handlerCalled2).to.be.equal(true);
        expect(handlerCalled3).to.be.equal(false);
        expect(promiseSettled).to.be.equal(false);

        await wait(300);
        expect(handlerCalled1).to.be.equal(true);
        expect(handlerCalled2).to.be.equal(true);
        expect(handlerCalled3).to.be.equal(true);
        expect(promiseSettled).to.be.equal(true);

        disconnect1();
        disconnect2();
        disconnect3();
    }).timeout(1000);

    it('emitAll async - promise settles when all handlers executed in parallel ', async () => {
        const onStringEvent = new OEvent<() => void>(EventTypes.Default, false);

        let handlerCalled1 = false;
        let handlerCalled2 = false;
        let handlerCalled3 = false;

        let promiseSettled = false;

        const disconnect1 = onStringEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    handlerCalled1 = true;
                    resolve();
                }, 4 * 100);
            });
        });
        const disconnect2 = onStringEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    handlerCalled2 = true;
                    resolve();
                }, 3 * 100);
            });
        });
        const disconnect3 = onStringEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    handlerCalled3 = true;
                    resolve();
                }, 5 * 100);
            });
        });
        onStringEvent
            .emitAll()
            .then(() => {
                promiseSettled = true;
            })
            .catch(err => console.error(err));
        await wait(200);
        expect(handlerCalled1).to.be.equal(false);
        expect(handlerCalled2).to.be.equal(false);
        expect(handlerCalled3).to.be.equal(false);
        expect(promiseSettled).to.be.equal(false);

        await wait(600);
        expect(handlerCalled1).to.be.equal(true);
        expect(handlerCalled2).to.be.equal(true);
        expect(handlerCalled3).to.be.equal(true);
        expect(promiseSettled).to.be.equal(true);

        disconnect1();
        disconnect2();
        disconnect3();
    }).timeout(1000);

    it('emitRace - promise settles when first handler finishes execution ', async () => {
        const onStringEvent = new OEvent<() => void>(EventTypes.Default);

        let emitPromiseSettled = false;
        const disconnect1 = onStringEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    resolve();
                }, 100);
            });
        });
        const disconnect2 = onStringEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    resolve();
                }, 2 * 100);
            });
        });
        const disconnect3 = onStringEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    resolve();
                }, 2 * 100);
            });
        });

        onStringEvent
            .emitRace()
            .then(() => {
                emitPromiseSettled = true;
            })
            .catch(err => console.error(err));
        expect(emitPromiseSettled).to.be.equal(false);

        // one of the handlers finished execution
        await wait(300);

        expect(emitPromiseSettled).to.be.equal(true);

        disconnect1();
        disconnect2();
        disconnect3();
    }).timeout(1000);

    it('emitRace reject - first handler rejects', async () => {
        const onStringEvent = new OEvent<() => void>(EventTypes.Default);

        let emitPromiseRejected = false;
        let secondHandlerExecuted = false;
        const disconnect1 = onStringEvent(() => {
            return new Promise<void>((_resolve, reject) => {
                setTimeout(() => {
                    reject(new Error('This is the reject reason'));
                }, 2 * 100);
            });
        });
        const disconnect2 = onStringEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    secondHandlerExecuted = true;
                    resolve();
                }, 5 * 100);
            });
        });

        onStringEvent
            .emitRace()
            .then(() => {})
            .catch(() => {
                emitPromiseRejected = true;
            });

        expect(emitPromiseRejected).to.be.equal(false);

        // one of the handlers finished execution
        await wait(300);
        expect(emitPromiseRejected).to.be.equal(true);
        expect(secondHandlerExecuted).to.be.equal(false);

        await wait(500);

        disconnect1();
        disconnect2();
    }).timeout(1000);

    it('emitAll reject - one handler rejects', async () => {
        const onStringEvent = new OEvent<() => void>(EventTypes.Default, false);

        let handlerCalled1 = false;
        let handlerCalled2 = false;
        let handlerCalled3 = false;
        let promiseRejected = false;

        const disconnect1 = onStringEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    handlerCalled1 = true;
                    resolve();
                }, 3 * 100);
            });
        });
        const disconnect2 = onStringEvent(() => {
            return new Promise<void>((_resolve, reject) => {
                setTimeout(() => {
                    handlerCalled2 = true;
                    reject(new Error('Second handler rejected'));
                }, 2 * 100);
            });
        });
        const disconnect3 = onStringEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    handlerCalled3 = true;
                    resolve();
                }, 4 * 100);
            });
        });

        onStringEvent
            .emitAll()
            .then(() => {})
            .catch(() => {
                promiseRejected = true;
            });

        await wait(100);
        expect(handlerCalled1).to.be.equal(false);
        expect(handlerCalled2).to.be.equal(false);
        expect(handlerCalled3).to.be.equal(false);
        expect(promiseRejected).to.be.equal(false);

        await wait(300);
        expect(handlerCalled1).to.be.equal(true);
        expect(handlerCalled2).to.be.equal(true);
        expect(handlerCalled3).to.be.equal(true);
        expect(promiseRejected).to.be.equal(true);

        disconnect1();
        disconnect2();
        disconnect3();
    }).timeout(1000);

    it('check onListen and onStopListen listeners are triggered', async () => {
        const onEvent = new OEvent<() => void>(EventTypes.Default, true);

        let onListenListenerCalled1 = 0;
        let onListenListenerCalled2 = 0;
        let onStopListenListenerCalled = 0;

        const disconnectOnListenListener1 = onEvent.onListen(() => {
            return new Promise<void>(_resolve => {
                onListenListenerCalled1++;
            });
        });

        const disconnectOnListenListener2 = onEvent.onListen(() => {
            return new Promise<void>(_resolve => {
                onListenListenerCalled2++;
            });
        });

        const disconnectOnStopListenListener = onEvent.onStopListen(() => {
            return new Promise<void>(_resolve => {
                onStopListenListenerCalled++;
            });
        });

        expect(onListenListenerCalled1).to.be.equal(0);
        expect(onListenListenerCalled2).to.be.equal(0);
        expect(onStopListenListenerCalled).to.be.equal(0);

        const disconnect1 = onEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    resolve();
                }, 2 * 100);
            });
        });
        expect(onListenListenerCalled1).to.be.equal(1);
        expect(onListenListenerCalled2).to.be.equal(1);
        expect(onStopListenListenerCalled).to.be.equal(0);

        const disconnect2 = onEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    resolve();
                }, 2 * 100);
            });
        });
        expect(onListenListenerCalled1).to.be.equal(2);
        expect(onListenListenerCalled2).to.be.equal(2);
        expect(onStopListenListenerCalled).to.be.equal(0);

        const disconnect3 = onEvent(() => {
            return new Promise<void>(resolve => {
                setTimeout(() => {
                    resolve();
                }, 3 * 100);
            });
        });
        expect(onListenListenerCalled1).to.be.equal(3);
        expect(onListenListenerCalled2).to.be.equal(3);
        expect(onStopListenListenerCalled).to.be.equal(0);

        disconnect1();
        expect(onListenListenerCalled1).to.be.equal(3);
        expect(onListenListenerCalled2).to.be.equal(3);
        expect(onStopListenListenerCalled).to.be.equal(1);

        disconnect2();
        expect(onListenListenerCalled1).to.be.equal(3);
        expect(onListenListenerCalled2).to.be.equal(3);
        expect(onStopListenListenerCalled).to.be.equal(2);

        disconnect3();
        expect(onListenListenerCalled1).to.be.equal(3);
        expect(onListenListenerCalled2).to.be.equal(3);
        expect(onStopListenListenerCalled).to.be.equal(3);

        disconnectOnListenListener1();
        disconnectOnListenListener2();
        disconnectOnStopListenListener();
    }).timeout(1000);
});
