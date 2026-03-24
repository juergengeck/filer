import {wait} from '@refinio/one.core/lib/util/promise.js';

import {type Invitation} from '../../misc/ConnectionEstablishment/PairingManager.js';
import {createInvitationToken, getPairingInformation} from '../utils/paring.js';
import type {InternetOfPeopleApiType, ModelsHelperType, OneApi} from '../utils/types.js';
import type {ConnectionInfo} from '../../misc/ConnectionEstablishment/LeuteConnectionsModule.js';

export default class InternetOfPeopleApi implements InternetOfPeopleApiType {
    private oneApi: OneApi;
    private models: ModelsHelperType;

    constructor(oneApi: OneApi, models: ModelsHelperType) {
        this.oneApi = oneApi;
        this.models = models;
    }

    /**
     * @param invitationLink string format
     * @returns the invitation information
     */
    public getPairingInformation(invitationLink: string): Invitation | undefined {
        return getPairingInformation(invitationLink);
    }

    /**
     * Tries to pair with the given invitation link.
     * @param invitationToken - The token to pair with.
     * @param maxTries - The maximum number of tries to pair with the given invitation link.
     * @param setError - The function to set the error.
     * @returns True if the pairing was successful, false otherwise.
     */
    public async tryPairing(
        invitationToken: string,
        maxTries: number = 4,
        setError: (error: Error) => void = console.error
    ): Promise<boolean> {
        let error: Error | undefined = undefined;
        const invitation = getPairingInformation(invitationToken);
        if (!invitation) {
            setError(new Error('Invalid invitation token'));
            return false;
        }

        for (let i = 0; i <= maxTries && error === undefined; ++i) {
            try {
                await this.models.getConnectionsModel().pairing.connectUsingInvitation(invitation);
                return true;
            } catch (e) {
                if (i === maxTries) {
                    error = e as Error;
                }
                await wait(2000);
            }
        }
        if (error) {
            setError(error);
            return false;
        }
        return true;
    }

    /**
     * Creates a token from an invitation
     * @returns the token
     */
    async createInvitationToken(): Promise<string> {
        return createInvitationToken(
            await this.models.getConnectionsModel().pairing.createInvitation()
        );
    }

    /**
     * @returns all connections of internet of people instances
     */
    async getConnections(): Promise<ConnectionInfo[]> {
        return this.models
            .getConnectionsModel()
            .connectionsInfo()
            .filter(connection => !connection.isInternetOfMe);
    }
}
