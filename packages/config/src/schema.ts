import { z } from 'zod';

/** Parse a boolean-ish env string ("true"/"1"/"yes" → true). */
const boolish = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      return ['true', '1', 'yes', 'on'].includes(v.toLowerCase());
    });

/** Parse a numeric env string with a default. */
const numish = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().finite());

const NodeEnv = z.enum(['development', 'test', 'production']).default('development');

const StorageDriver = z.enum(['minio', 's3', 'r2', 'azure-blob', 'gcs', 'local']).default('minio');
const SecretsDriver = z.enum(['env', 'vault', 'azure-kv', 'aws-sm', 'gcp-sm']).default('env');
const EmailDriver = z.enum(['smtp', 'sendgrid', 'azure-acs', 'aws-ses']).default('smtp');
const SmsDriver = z.enum(['mock', 'msg91', 'twilio', 'sns']).default('mock');
const QueueDriver = z.enum(['redis', 'azure-servicebus', 'aws-sqs', 'gcp-pubsub']).default('redis');
const ScanDriver = z.enum(['clamav', 'mock', 'cloud']).default('clamav');
const KeyDriver = z
  .enum(['local', 'vault-transit', 'azure-kv', 'aws-kms', 'gcp-kms'])
  .default('local');
const VerificationDriver = z.enum(['mock', 'aggregator']).default('mock');
const AuthDriver = z.enum(['session', 'supabase']).default('session');

/**
 * The complete environment surface. Every VOP_* variable lives here — nothing is read
 * from process.env anywhere else in the codebase. Add new settings to this schema only.
 */
export const envSchema = z
  .object({
    NODE_ENV: NodeEnv,

    // runtime
    VOP_API_PORT: numish(3000),
    VOP_WEB_PORT: numish(3001),
    VOP_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
    VOP_API_URL: z.string().url().default('http://localhost:3000'),

    // residency / retention
    VOP_DATA_REGION: z.string().default('in'),
    VOP_AUDIT_RETENTION_DAYS: numish(2920),

    // database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // redis
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

    // background jobs (SLA sweeps, escalation). Disable when no Redis is available (dev).
    VOP_JOBS_ENABLED: boolish(true),
    VOP_SLA_SWEEP_CRON: z.string().default('*/15 * * * *'),

    // provider selection
    VOP_STORAGE_DRIVER: StorageDriver,
    VOP_SECRETS_DRIVER: SecretsDriver,
    VOP_EMAIL_DRIVER: EmailDriver,
    VOP_SMS_DRIVER: SmsDriver,
    VOP_QUEUE_DRIVER: QueueDriver,
    VOP_SCAN_DRIVER: ScanDriver,
    VOP_KEY_DRIVER: KeyDriver,
    VOP_VERIFICATION_DRIVER: VerificationDriver,

    // object storage
    VOP_STORAGE_ENDPOINT: z.string().default('http://localhost:9000'),
    VOP_STORAGE_BUCKET: z.string().default('vop-documents'),
    VOP_STORAGE_ACCESS_KEY: z.string().optional(),
    VOP_STORAGE_SECRET_KEY: z.string().optional(),
    VOP_STORAGE_REGION: z.string().default('us-east-1'),

    // secrets: vault
    VOP_VAULT_ADDR: z.string().optional(),
    VOP_VAULT_TOKEN: z.string().optional(),

    // field encryption
    VOP_MASTER_KEY: z.string().optional(),
    VOP_BLIND_INDEX_KEY: z.string().optional(),

    // email
    VOP_SMTP_HOST: z.string().default('localhost'),
    VOP_SMTP_PORT: numish(1025),
    VOP_SMTP_SECURE: boolish(false),
    VOP_SMTP_USER: z.string().optional(),
    VOP_SMTP_PASSWORD: z.string().optional(),
    VOP_EMAIL_FROM: z.string().default('no-reply@vop.local'),

    // scanning & uploads
    VOP_CLAMAV_HOST: z.string().default('localhost'),
    VOP_CLAMAV_PORT: numish(3310),
    VOP_MAX_UPLOAD_MB: numish(10),

    // sessions
    VOP_SESSION_COOKIE_NAME: z.string().default('vop_sid'),
    VOP_SESSION_IDLE_MINUTES: numish(15),
    VOP_SESSION_ABSOLUTE_HOURS: numish(8),
    VOP_COOKIE_SECURE: boolish(false),
    // Cookie SameSite. Use `none` when the web app is on a different site than the API
    // (e.g. a Vercel domain calling the API host); `none` requires VOP_COOKIE_SECURE=true.
    VOP_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    // identity
    VOP_OIDC_ISSUER: z.string().optional(),
    VOP_OIDC_CLIENT_ID: z.string().optional(),
    VOP_OIDC_CLIENT_SECRET: z.string().optional(),
    VOP_OIDC_REDIRECT_URI: z.string().optional(),
    VOP_SAML_ENABLED: boolish(false),
    VOP_SAML_ENTRY_POINT: z.string().optional(),
    VOP_SAML_ISSUER: z.string().optional(),
    VOP_SAML_CERT: z.string().optional(),
    VOP_LOCAL_LOGIN_ENABLED: boolish(false),

    // authentication driver: `session` = built-in cookie sessions (local/OIDC/SAML);
    // `supabase` = verify Supabase-issued JWTs and map to the app user (RBAC stays app-side).
    VOP_AUTH_DRIVER: AuthDriver,
    VOP_SUPABASE_URL: z.string().url().optional(),
    VOP_SUPABASE_ANON_KEY: z.string().optional(),
    VOP_SUPABASE_JWT_SECRET: z.string().optional(),
    VOP_SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

    // observability
    VOP_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    VOP_OTEL_ENABLED: boolish(false),
    VOP_OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),

    // cors (comma-separated allow-list, never *)
    VOP_CORS_ORIGINS: z.string().default('http://localhost:3001'),
    // Also allow any https://*.vercel.app origin (for Vercel preview deployments, whose URLs are
    // generated per deploy). Keep off in production unless you intend to accept all previews.
    VOP_CORS_ALLOW_VERCEL_PREVIEWS: boolish(false),

    // PAN verification via EY Nexus CVR-API (real adapter). Credentials are secrets.
    VOP_PAN_VERIFY_ENABLED: boolish(false),
    VOP_EY_NEXUS_BASE_URL: z.string().url().default('https://nexus-in.ey.com'),
    VOP_EY_NEXUS_USERNAME: z.string().optional(),
    VOP_EY_NEXUS_PASSWORD: z.string().optional(),
    VOP_EY_NEXUS_TOKEN: z.string().optional(),
    VOP_EY_PAN_SERVICE_TYPE_ID: z.string().default('66'),
    VOP_EY_GST_BY_PAN_SERVICE_TYPE_ID: z.string().default('12'),
    VOP_EY_GST_VERIFY_SERVICE_TYPE_ID: z.string().default('30'),
    VOP_EY_BANK_VERIFY_SERVICE_TYPE_ID: z.string().default('27'),
    VOP_EY_MSME_SERVICE_TYPE_ID: z.string().default('92'),
  })
  .superRefine((env, ctx) => {
    const prod = env.NODE_ENV === 'production';

    // In production, dev-only shortcuts are forbidden.
    if (prod && env.VOP_SECRETS_DRIVER === 'env') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VOP_SECRETS_DRIVER'],
        message: 'The `env` secrets driver is dev-only; use vault/kms in production.',
      });
    }
    if (prod && env.VOP_KEY_DRIVER === 'local') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VOP_KEY_DRIVER'],
        message: 'The `local` key driver is dev-only; use vault-transit/kms in production.',
      });
    }
    if (prod && !env.VOP_COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VOP_COOKIE_SECURE'],
        message: 'Cookies must be Secure in production (serve behind TLS).',
      });
    }
    // Browsers reject SameSite=None cookies that aren't also Secure.
    if (env.VOP_COOKIE_SAMESITE === 'none' && !env.VOP_COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VOP_COOKIE_SAMESITE'],
        message:
          'SameSite=None requires VOP_COOKIE_SECURE=true (cross-site cookies must be Secure).',
      });
    }
    // CORS must never be a wildcard.
    if (env.VOP_CORS_ORIGINS.split(',').some((o) => o.trim() === '*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VOP_CORS_ORIGINS'],
        message: 'CORS wildcard (*) is not allowed; list explicit origins.',
      });
    }
    // Field encryption keys are required unless the KeyProvider supplies them.
    if (env.VOP_KEY_DRIVER === 'local' && !env.VOP_MASTER_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VOP_MASTER_KEY'],
        message: 'VOP_MASTER_KEY is required when VOP_KEY_DRIVER=local.',
      });
    }
    // Supabase auth needs the project URL and a way to verify tokens.
    if (env.VOP_AUTH_DRIVER === 'supabase') {
      if (!env.VOP_SUPABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['VOP_SUPABASE_URL'],
          message: 'VOP_SUPABASE_URL is required when VOP_AUTH_DRIVER=supabase.',
        });
      }
      // Token verification needs either the JWT secret (fast, local HS256) or the anon key
      // (remote verification via /auth/v1/user). At least one must be present.
      if (!env.VOP_SUPABASE_JWT_SECRET && !env.VOP_SUPABASE_ANON_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['VOP_SUPABASE_JWT_SECRET'],
          message:
            'Provide VOP_SUPABASE_JWT_SECRET or VOP_SUPABASE_ANON_KEY to verify Supabase tokens.',
        });
      }
    }
  });

/** Raw, validated environment as parsed from process.env. */
export type Env = z.infer<typeof envSchema>;
