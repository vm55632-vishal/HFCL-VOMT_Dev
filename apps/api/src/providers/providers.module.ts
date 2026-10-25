import { Global, Module, type Provider } from '@nestjs/common';
import type { AppConfig } from '@vop/config';
import { APP_CONFIG } from '../config/config.module';
import {
  STORAGE_PROVIDER,
  SECRETS_PROVIDER,
  EMAIL_PROVIDER,
  SMS_PROVIDER,
  QUEUE_PROVIDER,
  SCAN_PROVIDER,
  KEY_PROVIDER,
  VERIFICATION_PROVIDER,
  KYC_PROVIDER,
} from './contracts';
import { MockKycProvider, NotImplementedKyc } from './kyc.adapters';
import { LocalFsStorage, MinioStorage, R2Storage, NotImplementedStorage } from './storage.adapters';
import {
  EnvSecretsProvider,
  VaultSecretsProvider,
  NotImplementedSecrets,
} from './secrets.adapters';
import { SmtpEmailProvider, NotImplementedEmail } from './email.adapters';
import { MockSmsProvider, NotImplementedSms } from './sms.adapters';
import { RedisQueueProvider, NotImplementedQueue } from './queue.adapters';
import { ClamAvScanProvider, MockScanProvider, NotImplementedScan } from './scan.adapters';
import { LocalKeyProvider, NotImplementedKeyProvider } from './key.adapters';
import { MockVerificationProvider, NotImplementedVerification } from './verification.adapters';

/**
 * Binds each provider token to the adapter selected by config (ADR-0002). On-prem/dev adapters
 * are wired first; cloud adapters are marked stubs. Adapters that open no connection in their
 * constructor let the app boot even when their backend is not running yet.
 */
const providers: Provider[] = [
  {
    provide: STORAGE_PROVIDER,
    inject: [APP_CONFIG],
    useFactory: (c: AppConfig) => {
      switch (c.drivers.storage) {
        case 'local':
          return new LocalFsStorage();
        case 'minio':
        case 's3':
          return new MinioStorage(c);
        case 'r2':
          return new R2Storage(c);
        case 'azure-blob':
          return new NotImplementedStorage('Azure Blob');
        case 'gcs':
          return new NotImplementedStorage('GCS');
      }
    },
  },
  {
    provide: SECRETS_PROVIDER,
    inject: [APP_CONFIG],
    useFactory: (c: AppConfig) => {
      switch (c.drivers.secrets) {
        case 'env':
          return new EnvSecretsProvider();
        case 'vault':
          return new VaultSecretsProvider(c);
        case 'azure-kv':
          return new NotImplementedSecrets('Azure Key Vault');
        case 'aws-sm':
          return new NotImplementedSecrets('AWS Secrets Manager');
        case 'gcp-sm':
          return new NotImplementedSecrets('GCP Secret Manager');
      }
    },
  },
  {
    provide: EMAIL_PROVIDER,
    inject: [APP_CONFIG],
    useFactory: (c: AppConfig) => {
      switch (c.drivers.email) {
        case 'smtp':
          return new SmtpEmailProvider(c);
        case 'sendgrid':
          return new NotImplementedEmail('SendGrid');
        case 'azure-acs':
          return new NotImplementedEmail('Azure Communication Services');
        case 'aws-ses':
          return new NotImplementedEmail('AWS SES');
      }
    },
  },
  {
    provide: SMS_PROVIDER,
    inject: [APP_CONFIG],
    useFactory: (c: AppConfig) =>
      c.drivers.sms === 'mock' ? new MockSmsProvider() : new NotImplementedSms(c.drivers.sms),
  },
  {
    provide: QUEUE_PROVIDER,
    inject: [APP_CONFIG],
    useFactory: (c: AppConfig) => {
      switch (c.drivers.queue) {
        case 'redis':
          return new RedisQueueProvider(c);
        case 'azure-servicebus':
          return new NotImplementedQueue('Azure Service Bus');
        case 'aws-sqs':
          return new NotImplementedQueue('AWS SQS');
        case 'gcp-pubsub':
          return new NotImplementedQueue('GCP Pub/Sub');
      }
    },
  },
  {
    provide: SCAN_PROVIDER,
    inject: [APP_CONFIG],
    useFactory: (c: AppConfig) => {
      switch (c.drivers.scan) {
        case 'clamav':
          return new ClamAvScanProvider(c);
        case 'mock':
          return new MockScanProvider();
        default:
          return new NotImplementedScan('Cloud');
      }
    },
  },
  {
    provide: KEY_PROVIDER,
    inject: [APP_CONFIG],
    useFactory: (c: AppConfig) => {
      switch (c.drivers.key) {
        case 'local':
          return new LocalKeyProvider(c);
        case 'vault-transit':
          return new NotImplementedKeyProvider('Vault Transit');
        case 'azure-kv':
          return new NotImplementedKeyProvider('Azure Key Vault');
        case 'aws-kms':
          return new NotImplementedKeyProvider('AWS KMS');
        case 'gcp-kms':
          return new NotImplementedKeyProvider('GCP KMS');
      }
    },
  },
  {
    provide: VERIFICATION_PROVIDER,
    inject: [APP_CONFIG],
    useFactory: (c: AppConfig) =>
      c.drivers.verification === 'mock'
        ? new MockVerificationProvider()
        : new NotImplementedVerification('Aggregator'),
  },
  {
    // Same switch as the registry verification: mock for dev, the live provider once it is configured.
    provide: KYC_PROVIDER,
    inject: [APP_CONFIG],
    useFactory: (c: AppConfig) =>
      c.drivers.verification === 'mock' ? new MockKycProvider() : new NotImplementedKyc(),
  },
];

@Global()
@Module({
  providers,
  exports: [
    STORAGE_PROVIDER,
    SECRETS_PROVIDER,
    EMAIL_PROVIDER,
    SMS_PROVIDER,
    QUEUE_PROVIDER,
    SCAN_PROVIDER,
    KEY_PROVIDER,
    VERIFICATION_PROVIDER,
    KYC_PROVIDER,
  ],
})
export class ProvidersModule {}
