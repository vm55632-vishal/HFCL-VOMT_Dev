import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  applicablePath,
  newId,
  TIER_KEYS,
  type TierKey,
  type WorkflowDefinition,
  type WorkflowStageDef,
} from '@vop/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TtlCache } from '../common/ttl-cache';

export interface StagePermInput {
  roleKey: string;
  canView?: boolean;
  canEditFields?: boolean;
  canApprove?: boolean;
  canReject?: boolean;
  canSendBack?: boolean;
  canReassign?: boolean;
}
export interface StageInput {
  key: string;
  name: string;
  shortName: string;
  order: number;
  ownerRole?: string | null;
  slaBusinessDays?: number;
  terminal?: boolean;
  applicableTiers?: string[];
  evidenceGate?: boolean;
  permissions?: StagePermInput[];
}
export interface WorkflowInput {
  key: string;
  name: string;
  rejectStageKey?: string;
  stages: StageInput[];
}

type StageRow = {
  key: string;
  name: string;
  shortName: string;
  order: number;
  ownerRole: string | null;
  slaBusinessDays: number;
  terminal: boolean;
  applicableTiers: string[];
  evidenceGate: boolean;
};

/** Pure mapper: DB rows → the engine's WorkflowDefinition shape. */
export function buildDefinition(wf: {
  key: string;
  name: string;
  version: number;
  status: string;
  rejectStageKey: string;
  stages: StageRow[];
}): WorkflowDefinition {
  const stages: WorkflowStageDef[] = wf.stages
    .map((s) => ({
      key: s.key,
      name: s.name,
      shortName: s.shortName,
      order: s.order,
      ownerRole: s.ownerRole,
      slaBusinessDays: s.slaBusinessDays,
      terminal: s.terminal,
      applicableTiers: s.applicableTiers as TierKey[],
      evidenceGate: s.evidenceGate,
    }))
    .sort((a, b) => a.order - b.order);
  return {
    key: wf.key,
    name: wf.name,
    version: wf.version,
    status: wf.status as WorkflowDefinition['status'],
    rejectStageKey: wf.rejectStageKey,
    stages,
  };
}

const stageInclude = {
  stages: { include: { permissions: true }, orderBy: { order: 'asc' as const } },
};
type WorkflowWithStages = Prisma.WorkflowDefinitionGetPayload<{ include: typeof stageInclude }>;

@Injectable()
export class WorkflowsService {
  // Hot read-path caches (published definition per key, and a definition per key@version). Writers
  // call invalidate() so admin edits/publishes show up immediately; the TTL bounds staleness.
  private readonly published = new TtlCache<WorkflowWithStages>(15_000);
  private readonly byVersion = new TtlCache<WorkflowWithStages>(15_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private invalidate(): void {
    this.published.clear();
    this.byVersion.clear();
  }

  list() {
    return this.prisma.workflowDefinition.findMany({
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
      include: { stages: { orderBy: { order: 'asc' } } },
    });
  }

  async getById(id: string) {
    const wf = await this.prisma.workflowDefinition.findUnique({
      where: { id },
      include: stageInclude,
    });
    if (!wf) throw new NotFoundException('Workflow not found.');
    return wf;
  }

  /** The currently published version of a workflow key (used to execute cases in Phase 3). */
  async getPublished(key: string) {
    return this.published.get(key, async () => {
      const wf = await this.prisma.workflowDefinition.findFirst({
        where: { key, status: 'PUBLISHED' },
        include: stageInclude,
      });
      if (!wf) throw new NotFoundException(`No published workflow "${key}".`);
      return wf;
    });
  }

  /** The built engine definition for the currently published version of a key. */
  async publishedDefinition(key: string): Promise<WorkflowDefinition> {
    return buildDefinition(await this.getPublished(key));
  }

  /** The built engine definition for a specific version (an in-flight case keeps its version). */
  async definitionFor(key: string, version: number): Promise<WorkflowDefinition> {
    const wf = await this.byVersion.get(`${key}@${version}`, async () => {
      const found = await this.prisma.workflowDefinition.findUnique({
        where: { key_version: { key, version } },
        include: stageInclude,
      });
      if (!found) throw new NotFoundException(`Workflow "${key}" v${version} not found.`);
      return found;
    });
    return buildDefinition(wf);
  }

  /** Create a new DRAFT — a brand-new key (v1) or the next version of an existing key. */
  async createDraft(input: WorkflowInput, actorId: string) {
    this.assertStages(input);
    const latest = await this.prisma.workflowDefinition.findFirst({
      where: { key: input.key },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;

    const wf = await this.prisma.workflowDefinition.create({
      data: {
        id: newId(),
        key: input.key,
        name: input.name,
        version,
        status: 'DRAFT',
        rejectStageKey: input.rejectStageKey ?? 'rejected',
        createdById: actorId,
        stages: {
          create: input.stages.map((s) => this.stageCreate(s)),
        },
      },
      include: stageInclude,
    });
    this.invalidate();
    await this.audit.append({
      action: 'workflow.create_draft',
      entityType: 'WorkflowDefinition',
      entityId: wf.id,
      actorId,
      detail: { key: input.key, version },
    });
    return wf;
  }

  /** Replace the stages of a DRAFT. Published/archived versions are immutable. */
  async updateDraft(id: string, input: WorkflowInput, actorId: string) {
    const wf = await this.prisma.workflowDefinition.findUnique({ where: { id } });
    if (!wf) throw new NotFoundException('Workflow not found.');
    if (wf.status !== 'DRAFT') throw new BadRequestException('Only a draft can be edited.');
    this.assertStages(input);

    await this.prisma.$transaction([
      this.prisma.workflowStage.deleteMany({ where: { workflowId: id } }),
      this.prisma.workflowDefinition.update({
        where: { id },
        data: {
          name: input.name,
          rejectStageKey: input.rejectStageKey ?? wf.rejectStageKey,
          stages: { create: input.stages.map((s) => this.stageCreate(s)) },
        },
      }),
    ]);
    this.invalidate();
    await this.audit.append({
      action: 'workflow.update_draft',
      entityType: 'WorkflowDefinition',
      entityId: id,
      actorId,
    });
    return this.getById(id);
  }

  /** Publish a DRAFT; the previously published version of the same key is archived. */
  async publish(id: string, actorId: string) {
    const wf = await this.prisma.workflowDefinition.findUnique({
      where: { id },
      include: stageInclude,
    });
    if (!wf) throw new NotFoundException('Workflow not found.');
    if (wf.status !== 'DRAFT') throw new BadRequestException('Only a draft can be published.');
    if (!wf.stages.some((s) => s.terminal && s.key === wf.rejectStageKey)) {
      throw new BadRequestException(
        `Workflow needs a terminal reject stage "${wf.rejectStageKey}".`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.workflowDefinition.updateMany({
        where: { key: wf.key, status: 'PUBLISHED' },
        data: { status: 'ARCHIVED' },
      }),
      this.prisma.workflowDefinition.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      }),
    ]);
    this.invalidate();
    await this.audit.append({
      action: 'workflow.publish',
      entityType: 'WorkflowDefinition',
      entityId: id,
      actorId,
      detail: { key: wf.key, version: wf.version },
    });
    return this.getById(id);
  }

  async archive(id: string, actorId: string) {
    const wf = await this.prisma.workflowDefinition.findUnique({ where: { id } });
    if (!wf) throw new NotFoundException('Workflow not found.');
    const updated = await this.prisma.workflowDefinition.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    this.invalidate();
    await this.audit.append({
      action: 'workflow.archive',
      entityType: 'WorkflowDefinition',
      entityId: id,
      actorId,
    });
    return updated;
  }

  /** The route a case of each tier would take through this workflow (live designer preview). */
  async preview(id: string): Promise<Record<TierKey, string[]>> {
    const wf = await this.getById(id);
    const def = buildDefinition(wf);
    const out = {} as Record<TierKey, string[]>;
    for (const tier of TIER_KEYS) out[tier] = applicablePath(def, tier).map((s) => s.shortName);
    return out;
  }

  private stageCreate(s: StageInput) {
    return {
      id: newId(),
      key: s.key,
      name: s.name,
      shortName: s.shortName,
      order: s.order,
      ownerRole: s.ownerRole ?? null,
      slaBusinessDays: s.slaBusinessDays ?? 0,
      terminal: s.terminal ?? false,
      applicableTiers: s.applicableTiers ?? [],
      evidenceGate: s.evidenceGate ?? false,
      permissions: {
        create: (s.permissions ?? []).map((p) => ({
          id: newId(),
          roleKey: p.roleKey,
          canView: p.canView ?? true,
          canEditFields: p.canEditFields ?? false,
          canApprove: p.canApprove ?? false,
          canReject: p.canReject ?? false,
          canSendBack: p.canSendBack ?? false,
          canReassign: p.canReassign ?? false,
        })),
      },
    };
  }

  private assertStages(input: WorkflowInput): void {
    if (!input.stages.length) throw new BadRequestException('A workflow needs at least one stage.');
    const keys = new Set<string>();
    for (const s of input.stages) {
      if (keys.has(s.key)) throw new BadRequestException(`Duplicate stage key "${s.key}".`);
      keys.add(s.key);
    }
    if (!keys.has(input.rejectStageKey ?? 'rejected')) {
      throw new BadRequestException('The reject stage key must match a stage.');
    }
  }
}
