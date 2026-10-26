# Architecture Decision Records

Each ADR captures one significant decision: its context, the choice made, and the
consequences. ADRs are immutable once **Accepted** — to change a decision, add a new ADR
that supersedes the old one (note it in both).

Format: [MADR](https://adr.github.io/madr/)-lite — Status · Context · Decision · Consequences.

| ADR                                     | Title                                    | Status   |
| --------------------------------------- | ---------------------------------------- | -------- |
| [0001](0001-stack-and-monorepo.md)      | Stack & monorepo                         | Accepted |
| [0002](0002-cloud-agnostic-adapters.md) | Cloud-agnostic provider/adapter pattern  | Accepted |
| [0003](0003-database-orm-and-ids.md)    | Database, ORM & identifier strategy      | Accepted |
| [0004](0004-config-and-secrets.md)      | Configuration & secrets management       | Accepted |
| [0005](0005-audit-log.md)               | Audit log: append-only + hash chain      | Accepted |
| [0006](0006-field-encryption.md)        | Application-level field encryption       | Accepted |
| [0007](0007-security-standards.md)      | Security-standard mapping                | Accepted |
| [0008](0008-multi-entity.md)            | Multi-entity: one platform for the group | Accepted |

> Decisions deferred to later phases (verification aggregator, ERP target, spend-band
> ladder, break-glass policy) are tracked as assumptions in the relevant ADR and in
> `CLAUDE.md`, and will each get their own ADR when resolved.
