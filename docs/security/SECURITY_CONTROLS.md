# Security Controls Matrix

Living map of every control to **where it is implemented** and to the frameworks we align with:
OWASP **ASVS L2**, OWASP **Top 10** / **API Top 10**, **ISO 27001** Annex A, **CERT-In** guidance,
**DPDP Act 2023**. Updated every phase (Definition of Done). `Status`: ✅ done · 🚧 in progress ·
⏳ planned (phase).

> Phases 0–6 are implemented. Rows carry the phase in which the control landed. Companion docs:
> [THREAT_MODEL.md](THREAT_MODEL.md) (STRIDE), and the runbooks
> [backup-restore](../runbooks/backup-restore.md), [incident-response](../runbooks/incident-response.md),
> [performance](../runbooks/performance.md).

## Authentication & sessions

| Control                                                                    | Implemented in                           | ASVS      | OWASP | ISO 27001 | Status |
| -------------------------------------------------------------------------- | ---------------------------------------- | --------- | ----- | --------- | ------ |
| SSO (OIDC Entra / SAML) for internal users                                 | `auth/oidc.service`, `auth/saml.service` | 2.1, 2.10 | A07   | A.5.16    | ✅ P1  |
| JIT provisioning → PENDING_APPROVAL on first SSO login                     | `auth/jit.service`                       | 2.1       | A07   | A.5.16    | ✅ P1  |
| MFA for vendors & local break-glass                                        | `auth/mfa`                               | 2.8       | A07   | A.5.17    | ⏳ P3  |
| Secure session cookies (httpOnly, SameSite=strict)                         | `auth/session.service`                   | 3.4       | A07   | A.8.5     | ✅ P1  |
| Idle (15m) + absolute timeout; revocation on logout/role change/deactivate | `auth/session.service`, `users.service`  | 3.3       | A07   | A.8.5     | ✅ P1  |
| Brute-force protection (rate limit + account lockout)                      | `ThrottlerModule`, `auth.service`        | 2.2       | A07   | A.8.5     | ✅ P1  |
| OTP: 6-digit, single-use, 5-min expiry, hashed, attempt-limited            | `auth/otp`                               | 2.8       | A07   | A.8.5     | ⏳ P3  |

## Authorization

| Control                                                                                                          | Implemented in                                                                                      | ASVS     | OWASP    | ISO 27001     | Status |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------- | -------- | ------------- | ------ |
| Deny-by-default central policy guard on every endpoint                                                           | `auth/session.guard`, `authz/permissions.guard`                                                     | 4.1      | A01      | A.5.15        | ✅ P1  |
| Object-level authorization (anti-IDOR) + negative tests                                                          | `users.controller`, `users.controller.spec`                                                         | 4.2      | API1/A01 | A.5.15        | ✅ P1  |
| Non-sequential ids (ULID) in URLs                                                                                | `packages/shared/ids`                                                                               | 4.2      | API1     | —             | ✅ P0  |
| Segregation of Duties (self-approval / reporting-chain)                                                          | `authz/sod`, `registration.service`                                                                 | 4.1      | A01      | A.5.3         | ✅ P1  |
| Company (entity) isolation: per-request company, central query scoping, cross-company negative checks (ADR-0008) | `auth/session.guard`, `auth/entity-access`, `prisma/entity-scope`, `scripts/check-entity-isolation` | 4.1, 4.2 | A01      | A.5.15, A.8.3 | ✅ ME  |
| Field-level visibility & masked-by-default                                                                       | `common/masking`                                                                                    | 4.3      | A01      | A.8.3         | 🚧 P0  |

## Input / output

| Control                                                                              | Implemented in                          | ASVS | OWASP | ISO 27001 | Status |
| ------------------------------------------------------------------------------------ | --------------------------------------- | ---- | ----- | --------- | ------ |
| Schema validation on body/query/param, reject unknown fields                         | Zod + `ZodValidationPipe` (`.strict()`) | 5.1  | A03   | A.8.26    | ✅ P1  |
| Parameterised queries only (Prisma)                                                  | `apps/api` (Prisma)                     | 5.3  | A03   | A.8.28    | 🚧 P0  |
| Output encoding; CSP, HSTS, X-CTO, frame-ancestors none, Referrer/Permissions-Policy | `apps/api` (helmet)                     | 14.4 | A05   | A.8.9     | ✅ P0  |
| CSRF defense for cookie auth (SameSite=Strict)                                       | `auth/session.service`                  | 4.2  | A01   | A.8.26    | ✅ P1  |
| CORS allow-list from config (never `*`)                                              | `packages/config`, `main.ts`            | 14.5 | A05   | A.8.20    | ✅ P0  |

## Data protection

| Control                                           | Implemented in                               | ASVS | OWASP | ISO 27001 | DPDP  | Status |
| ------------------------------------------------- | -------------------------------------------- | ---- | ----- | --------- | ----- | ------ |
| TLS 1.2+ everywhere (app, DB, internal)           | ingress TLS (cert-manager), private DB/Redis | 9.1  | A02   | A.8.24    | —     | ✅ P6  |
| Field-level envelope encryption (PAN/bank/PII)    | `apps/api/src/crypto`                        | 6.2  | A02   | A.8.24    | §8    | ✅ P0  |
| Blind index/hash for searchable encrypted fields  | `crypto/blind-index`                         | 6.2  | A02   | A.8.24    | —     | ✅ P0  |
| Mask sensitive data in UI/API/logs/exports        | `common/masking`, `common/redaction`         | 8.1  | A09   | A.8.12    | §8    | 🚧 P0  |
| No Aadhaar stored; masked Aadhaar only            | validation/schema                            | —    | —     | —         | §8    | ⏳ P3  |
| Consent capture, retention config, export/erasure | `apps/api/src/privacy`                       | —    | —     | A.5.34    | §6–13 | ⏳ P5  |

## Secrets & supply chain

| Control                                                                   | Implemented in                 | ASVS | OWASP | ISO 27001 | Status |
| ------------------------------------------------------------------------- | ------------------------------ | ---- | ----- | --------- | ------ |
| No secrets in code/images/logs; gitleaks pre-commit + CI                  | `.gitleaks.toml`, `.husky`, CI | 14.2 | A05   | A.8.31    | ✅ P0  |
| Dependency pinning + lockfile; SCA scan                                   | `pnpm-lock.yaml`, CI           | 14.2 | A06   | A.8.29    | ✅ P0  |
| SBOM (CycloneDX)                                                          | CI (`pnpm sbom`)               | 14.2 | A06   | A.8.30    | ✅ P0  |
| SAST (Semgrep/CodeQL), image scan (Trivy), IaC scan (Checkov), DAST (ZAP) | CI (ZAP baseline in staging)   | 14.2 | A06   | A.8.29    | ✅ P6  |

## Error handling & infrastructure

| Control                                                                             | Implemented in                                                                           | ASVS | OWASP | ISO 27001     | Status |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---- | ----- | ------------- | ------ |
| Generic client errors + correlation id; no stack traces/banners                     | `common/errors`                                                                          | 7.4  | A05   | A.8.15        | ✅ P0  |
| Structured JSON logs, correlation ids, redaction, SIEM-ready                        | `common/logging`                                                                         | 7.1  | A09   | A.8.15        | ✅ P0  |
| Append-only, hash-chained audit trail                                               | `apps/api/src/audit`                                                                     | 7.1  | A09   | A.8.15        | ✅ P0  |
| Audit events for auth / registration / approvals / role change / session revocation | `auth`, `registration`, `users`                                                          | 7.1  | A09   | A.8.15        | ✅ P1  |
| Containers non-root, read-only fs, resource limits, network policy                  | `infra/docker`, `infra/helm/vop` (securityContext, HPA, PDB, default-deny NetworkPolicy) | 14.1 | A05   | A.8.9         | ✅ P6  |
| DB/storage private; WAF-ready; DDoS via cloud; encrypted backups + restore test     | `infra/terraform/*`, [backup-restore.md](../runbooks/backup-restore.md)                  | —    | —     | A.8.13/A.8.14 | ✅ P6  |
| Health endpoints + monitoring/alerts                                                | `apps/api/src/health`                                                                    | —    | —     | A.8.16        | ✅ P0  |

## CERT-In specifics

| Control                                          | Implemented in                                                        | Status |
| ------------------------------------------------ | --------------------------------------------------------------------- | ------ |
| Security logs retained (India) ≥ mandated period | audit retention (`VOP_AUDIT_RETENTION_DAYS`)                          | 🚧 P0  |
| Clocks synchronised to NTP, timestamps in UTC    | infra + app (UTC everywhere)                                          | 🚧 P0  |
| Incident-reporting readiness (CERT-In 6-hour)    | [incident-response.md](../runbooks/incident-response.md)              | ✅ P6  |
| STRIDE threat model maintained                   | [THREAT_MODEL.md](THREAT_MODEL.md)                                    | ✅ P6  |
| Performance validated (500 users, p95 < 500ms)   | [performance.md](../runbooks/performance.md), `perf/k6/onboarding.js` | ✅ P6  |
