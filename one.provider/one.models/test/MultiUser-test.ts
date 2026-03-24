import {mkdir} from 'fs/promises';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import type {AuthState} from '../lib/models/Authenticator/Authenticator.js';
import MultiUser from '../lib/models/Authenticator/MultiUser.js';

import {defaultDbName, initOneCorePlatform} from './_helpers.js';

chai.use(chaiAsPromised);

// @todo The input wrong secret tests are skipped for now because initInstance is not throwing
// the right error. Currently it throws access was already registered as a recipe for some reason.
// This may be a bug in core or not, but must be investigated in the future.

const {expect} = chai;
describe('MultiUser Test', () => {
    async function waitForState(state: AuthState, delay: number = 500): Promise<void> {
        await new Promise<void>((resolve, rejected) => {
            if (multiUserWorkflow.authState.currentState === state) {
                resolve();
            } else {
                multiUserWorkflow.authState.onEnterState(newState => {
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

    const [user1, user2] = [
        {email: 'test$email_1', secret: 'test$secret_1', instance: 'test$instanceName_1'},
        {email: 'test$email_2', secret: 'test$secret_2', instance: 'test$instanceName_2'}
    ];

    const STORAGE_TEST_DIR = 'test/testStorage';
    const multiUserWorkflow = new MultiUser({directory: `test/${defaultDbName}`});

    /**
     * Before each test case register & logout the user2, followed by register the user1 & logout
     */
    beforeEach(async () => {
        await initOneCorePlatform();
        await mkdir(`test/${defaultDbName}`, {recursive: true});
        await multiUserWorkflow.register(user2.email, user2.secret, user2.instance);
        await multiUserWorkflow.logout();
        await multiUserWorkflow.register(user1.email, user1.secret, user1.instance);
        await multiUserWorkflow.logout();
    });

    /**
     * After each test case login & erase user1, followed by login & erase user2
     */
    afterEach(async () => {
        await multiUserWorkflow.login(user1.email, user1.secret, user1.instance);
        await multiUserWorkflow.logoutAndErase();
        await multiUserWorkflow.login(user2.email, user2.secret, user2.instance);
        await multiUserWorkflow.logoutAndErase();
    });

    describe('Register & Erase', () => {
        it('should test if register(email, secret, instanceName) & logoutAndErase() are successfully', async () => {
            await multiUserWorkflow.register('test$email', 'test$secret', 'test$instanceName');
            await waitForState('logged_in');

            await multiUserWorkflow.logoutAndErase();
            await waitForState('logged_out');
        });
        it('should test if logoutAndErase() throws an error when it is called twice', async () => {
            await multiUserWorkflow.login(user1.email, user1.secret, user1.instance);
            await waitForState('logged_in');

            await multiUserWorkflow.logout();
            await waitForState('logged_out');

            await chai
                .expect(multiUserWorkflow.logoutAndErase())
                .to.eventually.be.rejectedWith(
                    'The transition does not exist from the current state with the specified event'
                );
        });
        it('should test if erase is successfully', async () => {
            await multiUserWorkflow.register('test$email', 'test$secret', 'test$instanceName');
            await waitForState('logged_in');

            await multiUserWorkflow.logout();
            await waitForState('logged_out');

            await multiUserWorkflow.erase('test$instanceName', 'test$email');
        });
        it(
            'should test if register(email, secret, instanceName) throws an error when user' +
                ' already exist',
            async () => {
                await chai
                    .expect(multiUserWorkflow.register(user1.email, user1.secret, user1.instance))
                    .to.eventually.be.rejectedWith('Could not register user. User already exists.');
            }
        );
        it(
            'should test if register can create multiple users and erase each one of them' +
                ' successfully',
            async () => {
                await multiUserWorkflow.register(
                    'test$email_3',
                    'test$secret_3',
                    'test$instanceName_3'
                );
                await waitForState('logged_in');

                await multiUserWorkflow.logoutAndErase();
                await waitForState('logged_out');

                await multiUserWorkflow.register(
                    'test$email_4',
                    'test$secret_4',
                    'test$instanceName_4'
                );
                await waitForState('logged_in');

                await multiUserWorkflow.logoutAndErase();
                await waitForState('logged_out');
            }
        );
    });
    describe('Login & Logout', () => {
        it('should test if login(email, secret, instanceName) & logout() are successfully', async () => {
            await multiUserWorkflow.login(user1.email, user1.secret, user1.instance);
            await waitForState('logged_in');

            await multiUserWorkflow.logout();
            await waitForState('logged_out');

            await multiUserWorkflow.login(user2.email, user2.secret, user2.instance);
            await waitForState('logged_in');

            await multiUserWorkflow.logout();
            await waitForState('logged_out');
        });
        it('should test if logout() throws an error when it is called twice', async () => {
            await multiUserWorkflow.login(user1.email, user1.secret, user1.instance);
            await waitForState('logged_in');

            await multiUserWorkflow.logout();
            await waitForState('logged_out');

            await chai
                .expect(multiUserWorkflow.logout())
                .to.eventually.be.rejectedWith(
                    'The transition does not exist from the current state with the specified event'
                );
        });
        it('should test if login(email, secret, instanceName) throws an error when the user was not registered', async () => {
            await chai
                .expect(
                    multiUserWorkflow.login('test$email_5', 'test$secret_5', 'test$instanceName_5')
                )
                .to.eventually.be.rejectedWith('Error while trying to login. User does not exist.');
        });
        it('should test if login(email, secret, instanceName) throws an error when the user double logins', async () => {
            await multiUserWorkflow.login(user1.email, user1.secret, user1.instance);
            await waitForState('logged_in');

            await chai
                .expect(multiUserWorkflow.login(user1.email, user1.secret, user1.instance))
                .to.eventually.be.rejectedWith(
                    'The transition does not exist from the current state with the specified event'
                );

            await multiUserWorkflow.logout();
        });
        it.skip(
            'should test if login(email, secret, instanceName) throws an error when the user' +
                ' inputs the wrong secret',
            async () => {
                await chai
                    .expect(multiUserWorkflow.login(user1.email, 'wrong-secret', user1.instance))
                    .to.eventually.be.rejectedWith('The provided secret is wrong');
            }
        );
        it('should test if it can login & logout into new created users', async () => {
            await multiUserWorkflow.login(user1.email, user1.secret, user1.instance);
            await waitForState('logged_in');

            await multiUserWorkflow.logout();
            await waitForState('logged_out');

            await multiUserWorkflow.login(user2.email, user2.secret, user2.instance);
            await waitForState('logged_in');

            await multiUserWorkflow.logout();
            await waitForState('logged_out');
        });
    });
    describe('LoginOrRegister', () => {
        it('should test if loginOrregister(email, secret, instanceName) is successfuly when no user was registered', async () => {
            await multiUserWorkflow.loginOrRegister(
                'test$email_6',
                'test$secret_6',
                'test$instanceName_6'
            );
            await waitForState('logged_in');

            await multiUserWorkflow.logoutAndErase();
            await waitForState('logged_out');
        });
        it('should test if loginOrregister(email, secret, instanceName) is successfuly when user was registered', async () => {
            await multiUserWorkflow.loginOrRegister(user1.email, user1.secret, user1.instance);
            await waitForState('logged_in');

            await multiUserWorkflow.logout();
            await waitForState('logged_out');

            await multiUserWorkflow.loginOrRegister(user2.email, user2.secret, user2.instance);
            await waitForState('logged_in');

            await multiUserWorkflow.logout();
            await waitForState('logged_out');
        });
        it('should test if loginOrregister(email, secret, instanceName) throws an error when the user double loginOrRegister', async () => {
            await multiUserWorkflow.loginOrRegister(user1.email, user1.secret, user1.instance);
            await waitForState('logged_in');

            await chai
                .expect(
                    multiUserWorkflow.loginOrRegister(user1.email, user1.secret, user1.instance)
                )
                .to.eventually.be.rejectedWith(
                    'The transition does not exist from the current state with the specified event'
                );

            await multiUserWorkflow.logout();
            await waitForState('logged_out');
        });
        it.skip(
            'should test if loginOrregister(email, secret, instanceName) throws an error when the user was' +
                ' already registered and it calls the function with the wrong secret',
            async () => {
                await chai
                    .expect(
                        multiUserWorkflow.loginOrRegister(
                            user1.email,
                            'wrong-secret',
                            user1.instance
                        )
                    )
                    .to.eventually.be.rejectedWith('The provided secret is wrong');
            }
        );
    });
    describe('isRegistered', () => {
        it('should test if isRegistered() returns true when the user is registered', async () => {
            expect(await multiUserWorkflow.isRegistered(user1.email, user1.instance)).to.be.equal(
                true
            );
        });
        it('should test if isRegistered() returns false when the user is not registered', async () => {
            expect(
                await multiUserWorkflow.isRegistered('test$email_5', 'test$instanceName_5')
            ).to.be.equal(false);
        });
    });
});
