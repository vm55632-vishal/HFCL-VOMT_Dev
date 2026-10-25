import type { KycCheckKey } from '@vop/shared';
/**
 * Provider contracts. Every external concern is reached only through one of these interfaces;
 * the concrete adapter is chosen at boot from config (ADR-0002). Application code depends on the
 * interface + token, never on an SDK type — so changing cloud/on-prem is a config change.
 */

// --- DI tokens ---
export const STORAGE_PROVIDER = Symbol('StorageProvider');
export const SECRETS_PROVIDER = Symbol('SecretsProvider');
export const EMAIL_PROVIDER = Symbol('EmailProvider');
export const SMS_PROVIDER = Symbol('SmsProvider');
export const QUEUE_PROVIDER = Symbol('QueueProvider');
export const SCAN_PROVIDER = Symbol('ScanProvider');
export const KEY_PROVIDER = Symbol('KeyProvider');
export const VERIFICATION_PROVIDER = Symbol('VerificationProvider');
export const KYC_PROVIDER = Symbol('KycProvider');

// --- Object storage ---
export interface StorageProvider {
  /** Store bytes under an opaque key. Never derive the key from a user-supplied filename. */
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  /** Short-lived URL for a controlled download, when the backend supports it. */
  presignGet(key: string, ttlSeconds: number): Promise<string>;
  exists(key: string): Promise<boolean>;
}

// --- Secrets ---
export interface SecretsProvider {
  /** Resolve a secret by logical name/path. Returns undefined when absent. */
  get(name: string): Promise<string | undefined>;
}

// --- Email ---
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

// --- SMS / OTP delivery ---
export interface SmsProvider {
  send(to: string, message: string): Promise<void>;
}

// --- Queue / background jobs ---
export interface QueueProvider {
  enqueue(queue: string, name: string, data: Record<string, unknown>): Promise<void>;
}

// --- Malware scanning ---
export interface ScanResult {
  clean: boolean;
  signature?: string;
}
export interface ScanProvider {
  scan(data: Buffer): Promise<ScanResult>;
}

// --- Encryption keys (envelope) ---
export interface ActiveKey {
  keyId: string;
  key: Buffer; // 32 bytes (AES-256)
}
export interface KeyProvider {
  getActiveKey(): Promise<ActiveKey>;
  getKey(keyId: string): Promise<Buffer>;
}

// --- Statutory verification (mock in Phase 0; real adapter stubbed) ---
export type VerificationStatus = 'verified' | 'not_found' | 'mismatch' | 'pending' | 'error';
export interface VerificationResult<T = Record<string, unknown>> {
  status: VerificationStatus;
  normalisedData?: T;
  rawResponseRef?: string;
  verifiedAt: string; // ISO-8601 UTC
  providerName: string;
}
export interface VerificationProvider {
  pan(input: { pan: string; name?: string }): Promise<VerificationResult>;
  gstin(input: { gstin: string }): Promise<VerificationResult>;
  mca(input: { registration: string }): Promise<VerificationResult>;
  bank(input: { account: string; ifsc: string; name?: string }): Promise<VerificationResult>;
  udyam(input: { udyam: string }): Promise<VerificationResult>;
}

// --- KYC & risk checks on the authorised signatory (Digi KYC, Hunter, IXSite, CRIF / CIBIL) ---
// The live provider's API is not confirmed, so only this interface and a mock exist today; a real
// adapter is added behind it without touching the service or the UI.
export interface KycSubject {
  name: string;
  pan: string;
  mobile?: string;
  email?: string;
}
export type KycRunStatus = 'in_progress' | 'passed' | 'failed';
export interface KycCheckResult {
  status: KycRunStatus;
  summary?: string;
}
export interface KycProvider {
  readonly name: string;
  /** Start one check for the subject; returns the provider's reference for polling. */
  start(check: KycCheckKey, subject: KycSubject): Promise<{ ref: string }>;
  /** Current state of a started check. */
  poll(check: KycCheckKey, ref: string): Promise<KycCheckResult>;
}
