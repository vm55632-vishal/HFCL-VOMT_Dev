/**
 * ADR-0008 isolation check against a real database: one company must never see or change another
 * company's cases through the case service or the scoped database client.
 *
 * Creates two temporary cases (refs starting ZZISO-) and always deletes them again.
 * Run: corepack pnpm --filter @vop/api check:isolation
 */
import { newId } from '@vop/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { CasesService } from '../src/cases/cases.service';
import { requestContext, NO_ENTITY } from '../src/common/context';

const prisma = new PrismaService();
const audit = { append: async () => undefined };
const crypto = { decryptFromString: async (s: string) => s };
type Ctor = new (...a: never[]) => unknown;
const svc = new (CasesService as unknown as Ctor)(
  ...([prisma, audit, crypto, null, null, null, null, null, null, null, null] as never[]),
) as unknown as {
  get: (a: never, id: string) => Promise<{ ref: string }>;
  list: (a: never, f: Record<string, string>) => Promise<{ id: string }[]>;
  bulk: (
    a: never,
    act: string,
    ids: string[],
    note?: string,
  ) => Promise<{ results: { ok: boolean; message?: string }[] }>;
};

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
};
const as = <T>(entityId: string, fn: () => Promise<T>) =>
  requestContext.run({ correlationId: 'iso', entityScope: entityId }, async () => await fn());
const err = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 'no error';
  } catch (e) {
    return (e as Error).message;
  }
};

async function main() {
  const [hfcl, hhfl] = await Promise.all([
    prisma.entity.findUniqueOrThrow({ where: { code: 'HFCL' } }),
    prisma.entity.findUniqueOrThrow({ where: { code: 'HHFL' } }),
  ]);
  const base = await prisma.case.findFirstOrThrow({
    select: { categoryKey: true, workflowKey: true, workflowVersion: true, createdById: true },
  });
  // A Hero Housing case with a review row and a document row (created outside any request).
  const other = await prisma.case.create({
    data: {
      id: newId(),
      ref: 'ZZISO-HHFL',
      entityId: hhfl.id,
      categoryKey: base.categoryKey,
      workflowKey: base.workflowKey,
      workflowVersion: base.workflowVersion,
      stage: 'review',
      tier: 'low',
      riskScore: 0,
      createdById: base.createdById,
      lastUpdatedById: base.createdById,
      infosecRequired: false,
    },
  });
  await prisma.caseFcu.create({ data: { id: newId(), caseId: other.id, status: 'pending' } });
  await prisma.document.create({
    data: {
      id: newId(),
      caseId: other.id,
      docType: 'other',
      filename: 'x.pdf',
      storageKey: `zziso/${other.id}`,
      contentType: 'application/pdf',
      fileType: 'pdf',
      sizeBytes: 1,
      sha256: 'x'.repeat(64),
      status: 'CLEAN',
      uploadedById: base.createdById,
    },
  });

  // Hero FinCorp admin-level actor (sees all within their company) — the strongest non-group user.
  const perms = new Set(['vendor:read_all', 'vendor:view_sensitive', 'workflow:manage']);
  const hfclActor = {
    id: base.createdById,
    permissions: perms,
    roles: ['proposer'],
    entityId: hfcl.id,
  } as never;
  const hhflActor = {
    id: base.createdById,
    permissions: perms,
    roles: ['proposer'],
    entityId: hhfl.id,
  } as never;

  try {
    check(
      'HFCL cannot open an HHFL case',
      /not found/i.test(await as(hfcl.id, () => err(() => svc.get(hfclActor, other.id)))),
    );
    check(
      'HHFL can open its own case',
      (await as(hhfl.id, () => svc.get(hhflActor, other.id))).ref === 'ZZISO-HHFL',
    );
    const hfclList = await as(hfcl.id, () => svc.list(hfclActor, {}));
    check(
      'HFCL case list excludes HHFL cases',
      !hfclList.some((c) => c.id === other.id),
      `${hfclList.length} HFCL cases`,
    );
    const hhflList = await as(hhfl.id, () => svc.list(hhflActor, {}));
    check(
      'HHFL case list shows only HHFL cases',
      hhflList.some((c) => c.id === other.id) &&
        (await prisma.case.count({
          where: { id: { in: hhflList.map((c) => c.id) }, entityId: { not: hhfl.id } },
        })) === 0,
    );
    const bulk = await as(hfcl.id, () =>
      svc.bulk(hfclActor, 'hold', [other.id], 'cross-entity attempt'),
    );
    check(
      'HFCL bulk hold on an HHFL case is refused',
      !bulk.results[0]?.ok,
      bulk.results[0]?.message,
    );
    const del = await as(hfcl.id, () => svc.bulk(hfclActor, 'delete', [other.id]));
    check(
      'HFCL bulk delete on an HHFL case is refused',
      !del.results[0]?.ok && !!(await prisma.case.findUnique({ where: { id: other.id } })),
    );
    check(
      'HFCL count of cases excludes HHFL',
      (await as(hfcl.id, () => prisma.case.count({ where: { id: other.id } }))) === 0,
    );
    check(
      'HFCL sees no HHFL documents',
      (await as(hfcl.id, () => prisma.document.findMany({ where: { caseId: other.id } })))
        .length === 0,
    );
    check(
      'HFCL findUnique on an HHFL review row returns nothing',
      (await as(hfcl.id, () => prisma.caseFcu.findUnique({ where: { caseId: other.id } }))) ===
        null,
    );
    check(
      'HHFL findUnique on its own review row works',
      (await as(hhfl.id, () => prisma.caseFcu.findUnique({ where: { caseId: other.id } })))
        ?.status === 'pending',
    );
    check(
      'HFCL cannot update an HHFL case directly',
      /record|found|required/i.test(
        await as(hfcl.id, () =>
          err(() => prisma.case.update({ where: { id: other.id }, data: { onHold: true } })),
        ),
      ),
    );
    check(
      'HFCL cannot create a case for HHFL',
      /different company/i.test(
        await as(hfcl.id, () =>
          err(() =>
            prisma.case.create({
              data: {
                id: newId(),
                ref: 'ZZISO-X',
                entityId: hhfl.id,
                categoryKey: base.categoryKey,
                workflowKey: base.workflowKey,
                workflowVersion: base.workflowVersion,
                stage: 'draft',
                tier: 'low',
                riskScore: 0,
                createdById: base.createdById,
                lastUpdatedById: base.createdById,
                infosecRequired: false,
              },
            }),
          ),
        ),
      ),
    );
    const created = await as(hfcl.id, () =>
      prisma.case.create({
        data: {
          id: newId(),
          ref: 'ZZISO-HFCL',
          categoryKey: base.categoryKey,
          workflowKey: base.workflowKey,
          workflowVersion: base.workflowVersion,
          stage: 'draft',
          tier: 'low',
          riskScore: 0,
          createdById: base.createdById,
          lastUpdatedById: base.createdById,
          infosecRequired: false,
        } as never,
      }),
    );
    check('a case created in an HFCL request is stamped HFCL', created.entityId === hfcl.id);
    check(
      'a user with no company sees no cases',
      (await as(NO_ENTITY, () => prisma.case.count())) === 0,
    );
    check(
      'outside a request (jobs) nothing is scoped',
      (await prisma.case.count({ where: { ref: { startsWith: 'ZZISO-' } } })) === 2,
    );
  } finally {
    await prisma.case.deleteMany({ where: { ref: { startsWith: 'ZZISO-' } } });
    console.log(
      `\n${pass} passed, ${fail} failed; test cases left: ${await prisma.case.count({ where: { ref: { startsWith: 'ZZISO-' } } })}`,
    );
    await prisma.$disconnect();
  }
}
main().catch((e: unknown) => {
  console.error(String(e).split('\n').slice(0, 12).join('\n'));
  process.exit(1);
});
