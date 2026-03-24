/**
 * Credential Type Definitions
 *
 * Types for W3C Verifiable Credentials verification, validation, and revocation
 */

import type { VersionedCredential } from './platform-interfaces.js';

/**
 * Credential verification result
 */
export interface VerificationResult {
  /** Overall verification status */
  status: VerificationStatus;

  /** Credential being verified */
  credential: VersionedCredential;

  /** Individual check results */
  checks: {
    signature: boolean;
    expiration: boolean;
    trustChain: boolean;
    revocation: boolean;
  };

  /** Verification timestamp */
  verifiedAt: number;

  /** Error details if verification failed */
  error?: VerificationError;
}

export type VerificationStatus =
  | 'valid' // All checks passed
  | 'expired' // Credential expired
  | 'revoked' // Credential revoked via versioning
  | 'untrusted' // Issuer not in trusted list
  | 'invalid_signature' // Signature verification failed
  | 'malformed'; // Credential structure invalid

/**
 * Verification error details
 */
export interface VerificationError {
  code: VerificationErrorCode;
  message: string;
  details?: unknown;
}

export type VerificationErrorCode =
  | 'SIGNATURE_INVALID'
  | 'EXPIRED'
  | 'REVOKED'
  | 'UNTRUSTED_ISSUER'
  | 'MALFORMED_CREDENTIAL'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_DATE_FORMAT'
  | 'VERIFICATION_FAILED';

/**
 * Revocation check result
 */
export interface RevocationCheckResult {
  revoked: boolean;
  revokedBy?: VersionedCredential; // Newer credential that revoked this one
  checkedAt: number;
}

/**
 * Credential ID parts (base ID and version)
 */
export interface CredentialIdParts {
  baseId: string; // e.g., "did:example:123"
  version: number; // e.g., 2
}

/**
 * Trust configuration
 */
export interface TrustConfig {
  /** List of trusted issuer DIDs */
  trustedIssuers: string[];

  /** Require trust chain validation (if false, skip trust check) */
  requireTrust: boolean;

  /** Allow self-issued credentials */
  allowSelfIssued: boolean;
}

/**
 * W3C VC context
 */
export const W3C_VC_CONTEXT = 'https://www.w3.org/2018/credentials/v1';

/**
 * Required credential types
 */
export const REQUIRED_CREDENTIAL_TYPES = ['VerifiableCredential'];

/**
 * Supported signature types
 */
export const SUPPORTED_SIGNATURE_TYPES = [
  'Ed25519Signature2020',
  'Ed25519Signature2018',
  'RsaSignature2018',
  'EcdsaSecp256k1Signature2019',
];

/**
 * Default trust configuration
 */
export const DEFAULT_TRUST_CONFIG: TrustConfig = {
  trustedIssuers: [],
  requireTrust: false, // Initially permissive for development
  allowSelfIssued: true, // Allow self-signed credentials for initial pairing
};

/**
 * Credential validation rules
 */
export const CREDENTIAL_VALIDATION_RULES = {
  requiredFields: [
    '@context',
    'type',
    'id',
    'issuer',
    'issuanceDate',
    'expirationDate',
    'credentialSubject',
    'proof',
    'validFrom',
    'version',
  ],
  contextMustInclude: [W3C_VC_CONTEXT],
  typeMustInclude: REQUIRED_CREDENTIAL_TYPES,
  dateFormat: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/, // ISO 8601
  versionFormat: /^[1-9]\d*$/, // Positive integer
};
