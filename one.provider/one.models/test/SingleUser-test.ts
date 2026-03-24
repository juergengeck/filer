import {defaultDbName} from './_helpers.js';
import {mkdir} from 'fs/promises';

import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import type {AuthState} from '../lib/models/Authenticator/Authenticator.js';
import SingleUser from '../lib/models/Authenticator/SingleUser.js';

import {SYSTEM} from '@refinio/one.core/lib/system/platform.js';
await import(`@refinio/one.core//lib/system/load-${SYSTEM}.js`);

chai.use(chaiAsPromised);

// @todo The input wrong secret tests are skipped for now because initInstance is not throwing
// the right error. Currently it throws access was already registered as a recipe for some reason.
// This may be a bug in core or not, but must be investigated in the future.

const {expect} = chai;

describe('SingleUser Test', () => {
    async function waitForState(state: AuthState, delay: number = 500): Promise<void> {
        await new Promise<void>((resolve, rejected) => {
            if (singleUserWorkflow.authState.currentState === state) {
                resolve();
            } else {
                singleUserWorkflow.authState.onEnterState(newState => {
                    if (newState === state) {
                        resolve();
                    }
                });
            }
            setTimeout(() => {
                rejected(new Error('The desired state did not showed up.'));
            }, delay);
        });
    }

    const singleUserWorkflow = new SingleUser({directory: `test/${defaultDbName}`});
    const secret = 'secret';

    afterEach(async () => {
        if (singleUserWorkflow.authState.currentState === 'logged_out') {
            await singleUserWorkflow.loginOrRegister(secret);
        }
        await singleUserWorkflow.logoutAndErase();
    });

    beforeEach(async () => {
        await mkdir(`test/${defaultDbName}`, {recursive: true});
        await singleUserWorkflow.register(secret);
    });

    describe('Register & Erase', () => {
        it('should test if register(secret) & erase() are successfully', async () => {
            await singleUserWorkflow.logoutAndErase();
            await waitForState('logged_out');

            await singleUserWorkflow.register(secret);
            await waitForState('logged_in');
        });
        it('should test if erase() throws an error when it is called twice', async () => {
            await singleUserWorkflow.logoutAndErase();
            await waitForState('logged_out');

            await chai
                .expect(singleUserWorkflow.erase())
                .to.eventually.be.rejectedWith(
                    'Could not erase due to lack of credentials without loging in. The credentials does not exist. Try to login and delete.'
                );
        });
        it('should test if register(secret) throws an error when user already exist', async () => {
            await singleUserWorkflow.logout();
            await waitForState('logged_out');

            await chai
                .expect(singleUserWorkflow.register(secret))
                .to.eventually.be.rejectedWith(
                    'Could not register user. The single user already exists.'
                );
        });
    });

    describe('Login & Logout', () => {
        it('should test if login(secret) & logout() are successfully', async () => {
            await singleUserWorkflow.logout();
            await waitForState('logged_out');

            await singleUserWorkflow.login(secret);
            await waitForState('logged_in');
        });
        it('should test if logout() throws an error when it is called twice', async () => {
            await singleUserWorkflow.logout();

            await chai
                .expect(singleUserWorkflow.logout())
                .to.eventually.be.rejectedWith(
                    'The transition does not exist from the current state with the specified event'
                );
        });
        it('should test if login(secret) throws an error when the user was not registered', async () => {
            await singleUserWorkflow.logoutAndErase();
            await waitForState('logged_out');

            await chai
                .expect(singleUserWorkflow.login(secret))
                .to.eventually.be.rejectedWith(
                    'Error while trying to login. User was not registered.'
                );
        });
        it('should test if login(secret) throws an error when the user double logins', async () => {
            await singleUserWorkflow.logout();
            await waitForState('logged_out');

            await singleUserWorkflow.login(secret);
            await waitForState('logged_in');

            await chai
                .expect(singleUserWorkflow.login(secret))
                .to.eventually.be.rejectedWith(
                    'The transition does not exist from the current state with the specified event'
                );
        });
        it.skip(
            'should test if login(secret) throws an error when the user inputs the wrong' +
                ' secret',
            async () => {
                await singleUserWorkflow.logout();
                await waitForState('logged_out');

                await chai
                    .expect(singleUserWorkflow.login('wrong-secret'))
                    .to.eventually.be.rejectedWith('The provided secret is wrong');
            }
        );
    });

    describe('LoginOrRegister', () => {
        it('should test if loginOrregister(secret) is successfuly when no user was registered', async () => {
            await singleUserWorkflow.logoutAndErase();
            await waitForState('logged_out');

            await singleUserWorkflow.loginOrRegister(secret);
            await waitForState('logged_in');
        });
        it('should test if loginOrregister(secret) is successfuly when user was registered', async () => {
            await singleUserWorkflow.logout();
            await waitForState('logged_out');

            await singleUserWorkflow.loginOrRegister(secret);
            await waitForState('logged_in');
        });
        it('should test if loginOrregister(secret) throws an error when the user double loginOrRegister', async () => {
            await singleUserWorkflow.logout();
            await waitForState('logged_out');

            await singleUserWorkflow.loginOrRegister(secret);
            await waitForState('logged_in');

            await chai
                .expect(singleUserWorkflow.loginOrRegister(secret))
                .to.eventually.be.rejectedWith(
                    'The transition does not exist from the current state with the specified event'
                );
        });
        it.skip(
            'should test if loginOrRegister(secret) throws an error when the user was' +
                ' already registered and it calls the function with the wrong secret',
            async () => {
                await singleUserWorkflow.logout();
                await waitForState('logged_out');

                await chai
                    .expect(singleUserWorkflow.loginOrRegister('wrong-secret'))
                    .to.eventually.be.rejectedWith('The provided secret is wrong');
            }
        );
    });

    describe('isRegistered', () => {
        it('should test if isRegistered() returns true when the user is registered', async () => {
            expect(await singleUserWorkflow.isRegistered()).to.be.equal(true);
        });
        it('should test if isRegistered() returns false when the user is not registered', async () => {
            await singleUserWorkflow.logoutAndErase();
            await waitForState('logged_out');

            expect(await singleUserWorkflow.isRegistered()).to.be.equal(false);
        });
    });
});
