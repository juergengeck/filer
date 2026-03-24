import {defaultDbName} from './_helpers.js';
import {mkdir} from 'fs/promises';

import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import {closeAndDeleteCurrentInstance} from '@refinio/one.core/lib/instance.js';

import SingleUserNoAuth from '../lib/models/Authenticator/SingleUserNoAuth.js';
import type {AuthState} from '../lib/models/Authenticator/Authenticator.js';

import {SYSTEM} from '@refinio/one.core/lib/system/platform.js';
await import(`@refinio/one.core//lib/system/load-${SYSTEM}.js`);

chai.use(chaiAsPromised);

const {expect} = chai;

describe('SingleUserNoAuth Test', () => {
    async function waitForState(state: AuthState, delay: number = 500): Promise<void> {
        await new Promise<void>((resolve, rejected) => {
            if (singleUserNoAuthWorkflow.authState.currentState === state) {
                resolve();
            } else {
                singleUserNoAuthWorkflow.authState.onEnterState(newState => {
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

    const singleUserNoAuthWorkflow = new SingleUserNoAuth({directory: `test/${defaultDbName}`});

    afterEach(async () => {
        if (singleUserNoAuthWorkflow.authState.currentState === 'logged_out') {
            await singleUserNoAuthWorkflow.loginOrRegister();
        }
        await singleUserNoAuthWorkflow.logoutAndErase();
    });

    beforeEach(async () => {
        await mkdir(`test/${defaultDbName}`, {recursive: true});
        await singleUserNoAuthWorkflow.register();
    });

    after(async () => closeAndDeleteCurrentInstance);

    describe('Register & Erase', () => {
        it('should test if register() & logoutAndErase() are successfully', async () => {
            await singleUserNoAuthWorkflow.logoutAndErase();
            await waitForState('logged_out');
            await singleUserNoAuthWorkflow.register();
            await waitForState('logged_in');
        });
        it('should test if logoutAndErase() throws an error when it is called twice', async () => {
            await singleUserNoAuthWorkflow.logoutAndErase();
            await waitForState('logged_out');
            await chai
                .expect(singleUserNoAuthWorkflow.erase())
                .to.eventually.be.rejectedWith(
                    'Could not erase due to lack of credentials without loging in. The credentials does not exist. Try to login and delete.'
                );
        });
        it('should test if register() throws an error when user already exist', async () => {
            await singleUserNoAuthWorkflow.logout();
            await waitForState('logged_out');

            await chai
                .expect(singleUserNoAuthWorkflow.register())
                .to.eventually.be.rejectedWith(
                    'Could not register user. The single user already exists.'
                );
        });
    });
    describe('Login & Logout', () => {
        it('should test if login() & logout() are successfully', async () => {
            await singleUserNoAuthWorkflow.logout();
            await waitForState('logged_out');

            await singleUserNoAuthWorkflow.login();
            await waitForState('logged_in');
        });
        it('should test if logout() throws an error when it is called twice', async () => {
            await singleUserNoAuthWorkflow.logout();

            await chai
                .expect(singleUserNoAuthWorkflow.logout())
                .to.eventually.be.rejectedWith(
                    'The transition does not exist from the current state with the specified event'
                );
        });
        it('should test if login() throws an error when the user was not registered', async () => {
            await singleUserNoAuthWorkflow.logoutAndErase();
            await waitForState('logged_out');

            await chai
                .expect(singleUserNoAuthWorkflow.login())
                .to.eventually.be.rejectedWith(
                    'Error while trying to login. User was not registered.'
                );
        });
        it('should test if login() throws an error when the user double logins', async () => {
            await singleUserNoAuthWorkflow.logout();
            await waitForState('logged_out');

            await singleUserNoAuthWorkflow.login();
            await waitForState('logged_in');

            await chai
                .expect(singleUserNoAuthWorkflow.login())
                .to.eventually.be.rejectedWith(
                    'The transition does not exist from the current state with the specified event'
                );
        });
    });
    describe('LoginOrRegister', () => {
        it('should test if loginOrRegister() is successfuly when no user was registered', async () => {
            await singleUserNoAuthWorkflow.logoutAndErase();
            await waitForState('logged_out');

            await singleUserNoAuthWorkflow.loginOrRegister();
            await waitForState('logged_in');
        });
        it('should test if loginOrRegister() is successfuly when user was registered', async () => {
            await singleUserNoAuthWorkflow.logout();
            await waitForState('logged_out');

            await singleUserNoAuthWorkflow.loginOrRegister();
            await waitForState('logged_in');
        });
        it('should test if loginOrRegister() throws an error when the user double loginOrRegister', async () => {
            await singleUserNoAuthWorkflow.logout();
            await waitForState('logged_out');

            await singleUserNoAuthWorkflow.loginOrRegister();
            await waitForState('logged_in');

            await chai
                .expect(singleUserNoAuthWorkflow.loginOrRegister())
                .to.eventually.be.rejectedWith(
                    'The transition does not exist from the current state with the specified event'
                );
        });
    });
    describe('isRegistered', () => {
        it('should test if isRegistered() returns true when the user is registered', async () => {
            expect(await singleUserNoAuthWorkflow.isRegistered()).to.be.equal(true);
        });
        it('should test if isRegistered() returns false when the user is not registered', async () => {
            await singleUserNoAuthWorkflow.logoutAndErase();
            await waitForState('logged_out');

            expect(await singleUserNoAuthWorkflow.isRegistered()).to.be.equal(false);
        });
    });
});
