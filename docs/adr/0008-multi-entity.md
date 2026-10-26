# ADR-0008 — Multi-entity: one platform for every company in the group

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Architecture, Security, Product owner
- **Supersedes:** the "single organisation" tenancy assumption in the original brief and
  `CLAUDE.md` (ADR-0003 and ADR-0005 are otherwise unchanged)

## Context

The platform is no longer for one company. Several legal entities in the same group (first Hero
FinCorp and Hero Housing Finance) onboard vendors through it. Each entity's users may only see and
act on that entity's cases, while a few group functions (platform administration, group audit)
work across all of them. Entities differ in their people (team structure, approvers) but share the
same onboarding process for now.

Options considered:

| Option                                                                                     | Isolation         | Cost   | Group view |
| ------------------------------------------------------------------------------------------ | ----------------- | ------ | ---------- |
| A. Separate deployment + database per entity                                               | Physical          | High   | None       |
| B. One deployment, separate database per entity                                            | Physical          | Medium | Hard       |
| **C. One deployment, one database, rows tagged with an entity, access enforced centrally** | Logical, enforced | Low    | Easy       |

## Decision

**Option C.** One application and one PostgreSQL database. Every case is owned by exactly one
entity, and access is enforced on the server for every request.

### Data model

- `entity` — code (`HFCL`, `HHFL`), name, email domains, active flag.
- `user_entity_role` — (user, entity, role). A person can hold different roles in different
  entities (e.g. Proposer in HFCL and FCU reviewer in HHFL).
- `users.roles` (the existing many-to-many) now holds **group-wide roles only**: Super Admin,
  Platform Admin, Auditor. A group-wide user may work in any active entity.
- `case.entity_id` — required. Everything that hangs off a case (general details, partners,
  references, RC limits, reviews, documents, KYC, history) inherits it through the case.
- `team_structure_master` and `team_directory` carry `entity_id`: each entity has its own people.
- `registration_request.entity_id` — the entity an access request is for.

### Request scoping

1. The browser sends the chosen entity as the `X-VOP-Entity` header (an entity code).
2. The session guard resolves the principal **for that entity**: its roles and permissions are the
   group-wide roles plus the roles held in that entity. A requested entity the user has no access
   to is refused (403). With no header, the user's home entity (matched by email domain) is used,
   then their first entity.
3. The active entity is put on the request context. A Prisma middleware adds
   `entity_id = <active entity>` to every query on `case`, and a `case: { entity_id }` filter to
   list/count queries on case-owned tables. Creating a case sets the entity from the context; a
   mismatch is an error. This is the central control; services do not need to remember it.
4. Code with no request context (background jobs, seeds, maintenance scripts) is not scoped.
5. Every audit entry made during a request records the entity in its detail.

### Decisions on the open questions (defaults, revisit with the client)

| Question                               | Decision now                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| Physical database separation required? | No — logical separation with central enforcement (Option C)                                  |
| Same vendor in two entities            | Two separate cases; duplicate detection is per entity                                        |
| One user in several entities           | Yes, with per-entity roles and a company switcher                                            |
| Group-wide roles                       | Super Admin, Platform Admin, Auditor                                                         |
| Email domains                          | Stored on the entity, configured by an administrator                                         |
| Categories / workflows                 | Shared group templates for now; per-entity overrides later                                   |
| Case ID format                         | One group-wide `VOMT-NNNNNN` series (unique across the group); the entity is shown beside it |

## Consequences

- **Positive:** one codebase, one deployment and one upgrade path; group reporting is a query;
  adding an entity is data, not a release.
- **Negative / risks:** isolation depends on the central scoping being applied. Mitigations:
  the scoping lives in one middleware with unit tests, services keep their own object-level
  checks, and cross-entity negative tests are part of the definition of done.
- **Not yet:** a combined "all entities" view for group roles (they switch entity instead);
  per-entity categories and workflows; PostgreSQL row-level security as a second database-level
  barrier (planned once the database moves to a nearby region, as each policy check adds latency);
  per-entity encryption keys.
- If a regulator later requires physical separation for an entity, that entity can be moved to
  its own deployment (Option A) without changing the data model.
