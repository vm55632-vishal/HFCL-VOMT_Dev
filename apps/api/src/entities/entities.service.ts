import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ENTITY_CODE_PATTERN, newId } from '@vop/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TtlCache } from '../common/ttl-cache';
import { principalCache } from '../auth/principal-cache';
import type { EntityRecord } from '../auth/entity-access';

export interface EntityAdminRow extends EntityRecord {
  active: boolean;
  sortOrder: number;
}

export interface EntityChanges {
  name?: string;
  emailDomains?: string[];
  active?: boolean;
  sortOrder?: number;
}

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * The companies in the group (ADR-0008). Read on every authenticated request, so the active list
 * is cached briefly and refreshed as soon as an administrator changes it.
 */
@Injectable()
export class EntitiesService {
  private readonly cache = new TtlCache<EntityAdminRow[]>(60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every company, active or not, in display order. */
  all(): Promise<EntityAdminRow[]> {
    return this.cache.get('all', () =>
      this.prisma.entity.findMany({
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          emailDomains: true,
          active: true,
          sortOrder: true,
        },
      }),
    );
  }

  async active(): Promise<EntityRecord[]> {
    return (await this.all()).filter((e) => e.active);
  }

  async byCode(code: string): Promise<EntityAdminRow> {
    const e = (await this.all()).find((x) => x.code === code.trim().toUpperCase());
    if (!e) throw new NotFoundException(`No company with code "${code}".`);
    return e;
  }

  private cleanDomains(domains: string[]): string[] {
    const out = [...new Set(domains.map((d) => d.trim().toLowerCase().replace(/^@/, '')))].filter(
      Boolean,
    );
    const bad = out.find((d) => !DOMAIN.test(d));
    if (bad) throw new BadRequestException(`"${bad}" is not a valid email domain.`);
    return out;
  }

  /** A domain may point to one company only, or a new user's home company would be ambiguous. */
  private async assertDomainsFree(domains: string[], exceptId?: string) {
    const clash = (await this.all()).find(
      (e) => e.id !== exceptId && e.emailDomains.some((d) => domains.includes(d.toLowerCase())),
    );
    if (clash) {
      throw new BadRequestException(
        `A domain is already used by ${clash.name} (${clash.code}). Each domain can belong to one company.`,
      );
    }
  }

  async create(
    input: { code: string; name: string; emailDomains?: string[] },
    actorId: string,
  ): Promise<EntityAdminRow> {
    const code = input.code.trim().toUpperCase();
    if (!ENTITY_CODE_PATTERN.test(code)) {
      throw new BadRequestException('Use 2–12 capital letters or digits for the company code.');
    }
    if ((await this.all()).some((e) => e.code === code)) {
      throw new BadRequestException(`A company with code ${code} already exists.`);
    }
    const emailDomains = this.cleanDomains(input.emailDomains ?? []);
    await this.assertDomainsFree(emailDomains);
    const sortOrder = (await this.all()).reduce((m, e) => Math.max(m, e.sortOrder), 0) + 1;
    const row = await this.prisma.entity.create({
      data: { id: newId(), code, name: input.name.trim(), emailDomains, sortOrder },
    });
    this.cache.clear();
    await this.audit.append({
      action: 'entity.create',
      entityType: 'Entity',
      entityId: row.id,
      actorId,
      detail: { code, name: row.name, emailDomains },
    });
    return this.byCode(code);
  }

  async update(code: string, changes: EntityChanges, actorId: string): Promise<EntityAdminRow> {
    const before = await this.byCode(code);
    const data: EntityChanges = {};
    if (changes.name !== undefined) data.name = changes.name.trim();
    if (changes.sortOrder !== undefined) data.sortOrder = changes.sortOrder;
    if (changes.active !== undefined) data.active = changes.active;
    if (changes.emailDomains !== undefined) {
      data.emailDomains = this.cleanDomains(changes.emailDomains);
      await this.assertDomainsFree(data.emailDomains, before.id);
    }
    await this.prisma.entity.update({ where: { id: before.id }, data });
    this.cache.clear();
    // Deactivating a company changes who may work where: drop cached logins immediately.
    if (changes.active !== undefined && changes.active !== before.active) principalCache.clear();
    await this.audit.append({
      action: 'entity.update',
      entityType: 'Entity',
      entityId: before.id,
      actorId,
      detail: {
        code: before.code,
        before: { name: before.name, emailDomains: before.emailDomains, active: before.active },
        after: data,
      },
    });
    return this.byCode(code);
  }
}
