# CLAUDE.md — VOP working notes

Running context for future sessions. Keep this current: stack, commands, conventions, decisions.

## What this is

Enterprise **Vendor Onboarding Platform (VOP)** — security-first, cloud-agnostic (on-prem first),
multi-entity (one platform for every company in the group, e.g. Hero FinCorp and Hero Housing Finance; ADR-0008). Built to pass InfoSec review / VAPT / audit. Full spec in `docs/BUILD_PROMPT.md`.
A lean reference prototype lives outside this repo at `../VOMT` — its `src/shared/*` domain logic
(risk, workflow, schema, PAN/GST/IFSC validation) is being ported into `packages/shared`.

## Stack

- **Backend:** TypeScript + NestJS 10 (`apps/api`), REST under `/api/v1`, OpenAPI 3 from decorators.
- **Frontend:** Next.js 14 + TypeScript (`apps/web`).
- **Shared:** `packages/shared` (types, Zod schemas, domain model), `packages/config` (typed env).
- **DB:** PostgreSQL 15 via Prisma. Migrations version-controlled. ULID ids in URLs (no sequential ids).
- **Cache/queue:** Redis + BullMQ.
- **Auth:** OIDC (Entra ID; Keycloak broker in dev) + SAML 2.0. Sessions = httpOnly cookies.
- **Providers (adapter pattern, chosen by env):** storage, secrets, email, sms, queue, scan, key, verification.
- **Observability:** pino JSON logs + correlation ids; OpenTelemetry.

## Monorepo layout

```
apps/api            NestJS API
apps/web            Next.js web
packages/shared     types, zod schemas, domain model (roles, permissions, validation)
packages/config     typed, validated env loading (zod)
infra/docker        Dockerfiles + docker-compose (postgres, redis, minio, clamav, mailpit, keycloak, vault)
infra/helm          (Phase 6)
infra/terraform     azure/ aws/ gcp/ (Phase 6)
docs/adr            architecture decision records
docs/security       SECURITY_CONTROLS.md, threat model (Phase 6)
docs/runbooks       operational runbooks
```

## Commands

Tooling: Node 20–22, pnpm via Corepack. Docker for the local stack.

```bash
corepack enable pnpm        # one-time: makes pnpm available (ships with Node)
pnpm install                # install all workspaces
pnpm compose:up             # start postgres/redis/minio/clamav/mailpit/keycloak/vault
pnpm --filter @vop/api prisma:migrate   # apply migrations
pnpm --filter @vop/api prisma:seed      # seed roles/permissions + demo users (fake data)
pnpm dev                    # run api + web in watch mode
pnpm build                  # build all
pnpm lint                   # eslint (flat config at repo root)
pnpm typecheck              # tsc --noEmit per package
pnpm test                   # unit tests (jest)
pnpm test:cov               # with coverage (DoD: >=80% domain/services; 100% negative authz tests)
pnpm format                 # prettier write
```

Copy `.env.example` to `.env` before running. Never commit `.env`.

## Conventions

- **No hardcoded** secrets/URLs/tenant ids/credentials — everything via `packages/config` (env) or SecretsProvider.
- **Never invent external API contracts.** Verification providers = interface + mock; real adapters are marked stubs with TODOs.
- **Deny-by-default authorization** on every endpoint (central guard). UI hiding is never the control.
- **Multi-entity (ADR-0008).** The browser sends the company as `X-VOP-Entity`; `SessionGuard`
  resolves it (refuses one the user can't use) and computes roles for that company. A Prisma
  middleware (`prisma/entity-scope.ts`) adds the company to every query on `Case`, case-owned tables
  and team master/directory. **New case-owned model?** Add it to `CASE_OWNED_MODELS` (and a model
  with its own `entityId` to `ENTITY_MODELS`), or it is not scoped. Group-wide roles (super admin,
  platform admin, auditor) live on `users.roles`; all other roles are in `user_entity_role`.
  Prove isolation with `corepack pnpm --filter @vop/api check:isolation`.
- **Schema changes:** the dev DB has drift, so never run `prisma db push` (it wants to drop live
  columns). Write an additive, idempotent SQL file under `apps/api/prisma/sql/` and apply it with
  `prisma db execute --file <file> --schema prisma/schema.prisma`, then `prisma generate`.
- **Object-level authz** everywhere (IDOR). Every guard has negative tests.
- **Audit** every sensitive action (see `apps/api/src/audit`). Audit table is append-only + hash-chained; app DB role cannot UPDATE/DELETE it.
- **Field encryption** (envelope, via KeyProvider) for PAN, bank account, personal identifiers. Blind index/hash for searchable encrypted fields.
- **Mask** sensitive data in UI, APIs, logs, exports by default. No PII/secrets in logs (redaction layer + test).
- Package names: `@vop/api`, `@vop/web`, `@vop/shared`, `@vop/config`.
- Conventional Commits (commitlint). Pre-commit: prettier + gitleaks. Pre-push/CI: lint, typecheck, tests, SAST, SCA, image/IaC scan.

## Decisions (see docs/adr for full records)

- ADR-0001 Stack & monorepo: TypeScript/NestJS + Next.js, pnpm + Turborepo.
- ADR-0002 Cloud-agnostic adapter pattern via NestJS DI; on-prem adapters first.
- ADR-0003 DB = PostgreSQL + Prisma; ULID ids; portability caveats.
- ADR-0004 Config = zod-validated env; secrets via SecretsProvider (Vault on-prem).
- ADR-0005 Audit log = append-only + hash chain; least-privilege DB role.
- ADR-0006 Field encryption = envelope (AES-256-GCM) + blind index (HMAC).
- ADR-0007 Security-standard mapping: ISO 27001 + CERT-In + OWASP ASVS L2 + DPDP 2023.
- ADR-0008 Multi-entity: one app + one DB; every case belongs to an entity; access enforced centrally.

## Phase status

- **Multi-entity (group companies):** 🚧 on `feat/multi-entity` (ADR-0008). `entity` +
  `user_entity_role` tables, `case.entity_id` (existing data backfilled to HFCL via
  `apps/api/prisma/sql/0001-multi-entity.sql`), per-company team master/directory, company switcher
  in the web header, per-company role management, Companies admin page. Entities seeded: HFCL (Hero
  FinCorp, domain `vop.local` for dev) and HHFL (Hero Housing Finance, no domain yet). One shared
  `VOMT-NNNNNN` case series. _Not yet:_ combined all-companies view for group roles, per-company
  categories/workflows, Postgres RLS, per-company keys, a self-service access-request form (requests
  still come from JIT/admin).

- **Approval levels L1 → L2 → L3:** optional sequential approvals between the parallel reviews and
  SAP (`packages/shared/src/stages.ts` — `APPROVAL_LEVELS`, `nextAfterApproval`). Each vendor
  category picks its levels (`vendor_category.approval_levels`, switched on the categories admin;
  none by default); a case copies them on submit (`case.approval_levels`) and `case.stage` holds the
  current level. Tables `case_l1/l2/l3` (`sql/0004`), roles `l1`/`l2`/`l3` (per company), queues
  `/stages/l1..l3`, same decision endpoint as the reviews. Send-back returns to that level on
  resubmit; reopen resumes at a rejected level. Demo logins: `node apps/api/scripts/create-approvers.cjs`
  (`l1@`/`l2@`/`l3@vop.local`). Proof: `corepack pnpm --filter @vop/api check:levels`.

- **Phase 0 (Foundation):** ✅ done — committed on `master` (scaffold, providers, config, Prisma base schema, audit, health, docker-compose, CI, ADRs).
- **Phase 1 (Identity & Access):** ✅ done, merged to `master` — local + OIDC/SAML auth with JIT provisioning, self-registration + manager approval (SoD + expiry/escalation), deny-by-default RBAC guard with IDOR + negative tests, DB-backed sessions, brute-force protection, user-admin + web console.
- **Phase 2 (Master data & workflow engine):** ✅ done on `feat/phase-2-workflow`. Data-driven, versioned **workflow engine** (`packages/shared/workflow.ts` — tier routing, SLA business-day math, transition validation, evidence gate); vendor **categories** master data + admin API; **versioned workflow** admin API (draft → publish → archive, immutable published versions, stage-level permissions) with live route-preview; **BullMQ SLA/escalation jobs** (`apps/api/src/jobs`, gated by `VOP_JOBS_ENABLED`, repeatable sweep + manual `/maintenance/sweep`); **web designer UI** (categories admin, workflows list, per-workflow stage editor + route preview). Seed: 10 categories + published `standard-vendor` v1. Repo lives at `C:\dev\vop` (off OneDrive). **83 unit tests pass**; live-demoed. _Deferred (minor): per-entity-type field config — entity types remain the shared enum for now._
- **Phase 3 (Vendor onboarding):** ✅ done on `feat/phase-3-onboarding` (ready to merge). Risk model + Case data model (encrypted PAN/bank + blind indexes); **case lifecycle** — proposer raises a case, server-side risk tiering, duplicate detection, due-diligence checklist, workflow execution via the engine with stage-ownership + evidence gate + audit; **proposer intake form + case queue/detail web UI**; **document upload** — magic-byte validation + malware scan (ScanProvider; infected files never stored) + SHA-256 + opaque-key storage + audited streaming download. **95 unit tests**; live-demoed (case → approved; upload clean/spoofed/EICAR). **Scope decision (user):** external **vendor invite + OTP portal deferred** — the proposer fills all vendor details in-app. Added a `mock` scan driver for offline dev.
- **Phase 4 (Validations & risk):** ✅ done on `feat/phase-4-validations` (ready to merge). Shared `name-match` (normalize + Jaccard/Levenshtein + verdict) and `red-flags` (cross-checks + configurable rules engine). `VerificationService` + `CaseVerification` model: runs the (mock) PAN/GST/bank providers with retry/backoff (outage → pending, never blocks), computes name-match + cross-checks, assembles the red-flag context (employee email/bank matches, shared bank account across cases), evaluates red flags, feeds registry signals back into the risk model to **re-tier server-side**, and sets `reviewRequired`. Endpoints: `POST /cases/:id/verify`, `GET /cases/:id/verification`, `GET /review-queue`. Web: verification panel on the case + a manual review queue. **108 tests**; live-demoed (re-tier, name match, GSTIN check-digit → review, shared-bank red flag, review queue). Real aggregator adapter still a marked stub (needs vendor API docs — deferred).
- **Phase 5 (Audit, reporting & lifecycle):** ✅ done on `feat/phase-5-audit-lifecycle`. Auditor UI over the hash-chained log (`GET /audit` search, `/audit/verify` tamper check, `/audit/export.csv` — the export is audited); dashboards (`/stats/dashboard` pipeline/tier/overdue/review, scoped) + web dashboard with KPIs and a bar chart; **vendor lifecycle** — idempotent **ERP activation stub** fired on approval, in-app + email **notifications**, and **block/reactivate** with reason+audit+notify; `Notification` model + `/notifications`. 108 tests; web preview runs via `.claude/launch.json` (corepack). _Deferred (lighter): change-request re-approval for material fields + periodic re-validation._
- **Phase 6 (Hardening & deployment):** ✅ done, merged to `master`. **Chunk A** — hardened **Helm chart** (`infra/helm/vop`): non-root + read-only rootfs + dropped caps + seccomp RuntimeDefault, HPA, PDB, default-deny NetworkPolicy with explicit allows, secrets via pre-created `vop-secrets` (`existingSecret`, never in chart), pre-upgrade `prisma migrate deploy` Job. **Chunk B** — **Terraform**: on-prem module (`infra/terraform/onprem` — namespace with PSA `restricted` + `helm_release` on the local chart; `vop-secrets`/`vop-tls` created out-of-band via external-secrets/cert-manager, never in state) + azure/aws/gcp/modules README scaffolds (India residency). **STRIDE threat model** (`docs/security/THREAT_MODEL.md`); **runbooks** `backup-restore.md` (RPO 15m/RTO 2h, PITR, KEK DR, quarterly drill) + `incident-response.md` (CERT-In 6h, DPDP, evidence handling); **k6 perf test** (`perf/k6/onboarding.js`, 500 VUs / p95<500ms thresholds) + `performance.md`; **admin & user guides** (`docs/guides`); `SECURITY_CONTROLS.md` Phase-6 rows flipped to ✅. Prettier ignores Helm templates (Go-templated YAML). _Deferred (ADR assumptions): real verification aggregator adapter (needs sandbox creds); signed images/SLSA; HSM-backed KEK._

## Phase 1 notes

- **Verification on Windows/OneDrive:** OneDrive syncs `node_modules` and corrupts it (conflict-copy files, missing `@jest/core/build/cli`), so `jest` fails in-place though `tsc` works. Run tests from a copy outside OneDrive (e.g. `%TEMP%\vop-verify`) — or, better, move the repo out of OneDrive. This is an environment issue, not a code issue.
- Local break-glass login is gated by `VOP_LOCAL_LOGIN_ENABLED`; seed a password via `VOP_SEED_ADMIN_PASSWORD` (never hardcoded). SSO is the norm.
- SCIM 2.0 provisioning and access-recertification campaigns are designed but implemented later.

## Known local caveats

- **Windows + `next build`:** the `output: 'standalone'` step creates symlinks and fails with
  `EPERM` on Windows without Developer Mode (worse under OneDrive). Compilation/type-checking
  succeed; only the standalone copy fails. It works on Linux (the Docker image build and CI on
  ubuntu). To build the web app locally on Windows, enable Developer Mode or build in WSL/Docker.
- **pnpm via Corepack shim:** `corepack enable pnpm` needs admin to write the Node shim. Without
  it, run pnpm as `corepack pnpm <cmd>`. `turbo` shells out to `pnpm`, so the turbo-based root
  scripts (`pnpm build`, `pnpm test`) need `pnpm` on PATH — otherwise run per package with
  `corepack pnpm --filter <pkg> <script>`.

## Deferred / open (confirm before the relevant phase)

- Real verification aggregator + sandbox creds → before Phase 4.
- ERP target + payload → before Phase 5.
- Exact spend-band thresholds/approvers → before Phase 2 seed.
- Break-glass local-login policy specifics.
