import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';

import type {ModelsHelperType, OneApi, TrustApiType} from '../utils/types.js';

export default class TrustApi implements TrustApiType {
    private oneApi: OneApi;
    private models: ModelsHelperType;

    constructor(oneApi: OneApi, models: ModelsHelperType) {
        this.oneApi = oneApi;
        this.models = models;
    }

    /**
     * Give an affirmation certificate.
     * @param data - The data to give the affirmation certificate for.
     */
    async giveAffirmationCertificate(data: SHA256Hash): Promise<void> {
        await this.models.getLeuteModel().trust.affirm(data);
    }
}
