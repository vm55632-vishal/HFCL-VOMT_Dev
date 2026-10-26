import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { newId, normaliseApprovalLevels } from '@vop/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TtlCache } from '../common/ttl-cache';

export interface CategoryInput {
  key: string;
  name: string;
  description?: string;
  sortOrder?: number;
  enhancedDueDiligence?: boolean;
  requiredDocuments?: string[];
  requiredValidations?: string[];
  workflowKey: string;
  approvalLevels?: string[];
}

@Injectable()
export class CategoriesService {
  // Hot read-path caches (intake-form category list, single category lookup). create()/update()
  // clear them so admin edits show immediately; the TTL bounds staleness.
  private readonly lists = new TtlCache<Awaited<ReturnType<CategoriesService['loadList']>>>(30_000);
  private readonly byKey = new TtlCache<Awaited<ReturnType<CategoriesService['loadOne']>>>(30_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Categories for the intake form (active only) or the full set for admins, each with its
   *  sub-categories (VOMT account groups) for the dependent dropdown. */
  list(includeInactive = false) {
    return this.lists.get(includeInactive ? 'all' : 'active', () => this.loadList(includeInactive));
  }

  private loadList(includeInactive: boolean) {
    return this.prisma.vendorCategory.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        subCategories: {
          where: includeInactive ? {} : { active: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
      },
    });
  }

  async get(key: string) {
    return this.byKey.get(key, () => this.loadOne(key));
  }

  private async loadOne(key: string) {
    const cat = await this.prisma.vendorCategory.findUnique({ where: { key } });
    if (!cat) throw new NotFoundException(`Category "${key}" not found.`);
    return cat;
  }

  private invalidate(): void {
    this.lists.clear();
    this.byKey.clear();
  }

  async create(input: CategoryInput, actorId: string) {
    const exists = await this.prisma.vendorCategory.findUnique({ where: { key: input.key } });
    if (exists) throw new BadRequestException(`Category "${input.key}" already exists.`);
    const created = await this.prisma.vendorCategory.create({
      data: {
        id: newId(),
        key: input.key,
        name: input.name,
        description: input.description ?? '',
        sortOrder: input.sortOrder ?? 100,
        enhancedDueDiligence: input.enhancedDueDiligence ?? false,
        requiredDocuments: input.requiredDocuments ?? [],
        requiredValidations: input.requiredValidations ?? [],
        workflowKey: input.workflowKey,
        approvalLevels: normaliseApprovalLevels(input.approvalLevels),
      },
    });
    this.invalidate();
    await this.audit.append({
      action: 'category.create',
      entityType: 'VendorCategory',
      entityId: created.id,
      actorId,
      detail: { key: input.key },
    });
    return created;
  }

  async update(
    key: string,
    changes: Partial<Omit<CategoryInput, 'key'>> & { active?: boolean },
    actorId: string,
  ) {
    const before = await this.prisma.vendorCategory.findUnique({ where: { key } });
    if (!before) throw new NotFoundException('Category not found.');
    const after = await this.prisma.vendorCategory.update({
      where: { key },
      data: {
        name: changes.name,
        description: changes.description,
        sortOrder: changes.sortOrder,
        enhancedDueDiligence: changes.enhancedDueDiligence,
        requiredDocuments: changes.requiredDocuments,
        requiredValidations: changes.requiredValidations,
        workflowKey: changes.workflowKey,
        approvalLevels: changes.approvalLevels
          ? normaliseApprovalLevels(changes.approvalLevels)
          : undefined,
        active: changes.active,
      },
    });
    this.invalidate();
    await this.audit.append({
      action: 'category.update',
      entityType: 'VendorCategory',
      entityId: after.id,
      actorId,
      detail: {
        key,
        ...(changes.approvalLevels
          ? { approvalLevels: { from: before.approvalLevels, to: after.approvalLevels } }
          : {}),
      },
    });
    return after;
  }
}
