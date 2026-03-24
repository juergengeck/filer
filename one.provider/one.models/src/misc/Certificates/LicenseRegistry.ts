import type {OneCertificateTypeNames} from '../../recipes/Certificates/CertificateRecipes.js';
import type {License} from '../../recipes/Certificates/License.js';

const licenseRegistry = new Map<OneCertificateTypeNames, License>();

export function getLicenseForCertificate(certificateType: OneCertificateTypeNames): License {
    const license = licenseRegistry.get(certificateType);
    if (license === undefined) {
        throw new Error('No license found with requested type');
    }
    return license;
}

export function registerLicense(license: License, certificateType: OneCertificateTypeNames) {
    Object.freeze(license);
    licenseRegistry.set(certificateType, license);
}
