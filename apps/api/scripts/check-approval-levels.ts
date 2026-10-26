/**
 * Approval levels (L1 -> L2 -> L3) against a real database: a case whose category uses L1 and L3
 * moves reviews -> L1 -> L3 -> SAP, only the current level's role can act, send-back and reject
 * behave, and the level queues list it at the right time.
 *
 * Creates one temporary case (ref ZZLVL-1) and always deletes it again.
 * Run: corepack pnpm --filter @vop/api check:levels
 */
import { newId } from '@vop/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { CasesService } from '../src/cases/cases.service';
import { requestContext } from '../src/common/context';

const prisma = new PrismaService();
const audit = { append: async () => undefined };
type Ctor = new (...a: never[]) => unknown;
const svc = new (CasesService as unknown as Ctor)(
  ...([prisma, audit, null, null, null, null, null, null, null, null, null] as never[]),
) as unknown as {
  stageDecision: (
    a: never,
    id: string,
    stage: string,
    d: 'approve' | 'reject' | 'sendback',
    note?: string,
  ) => Promise<{ phase: string }>;
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
const err = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 'no error';
  } catch (e) {
    return (e as Error).message;
  }
};

async function main() {
  const hfcl = await prisma.entity.findUniqueOrThrow({ where: { code: 'HFCL' } });
  const base = await prisma.case.findFirstOrThrow({
    where: { entityId: hfcl.id },
    select: { categoryKey: true, workflowKey: true, workflowVersion: true, createdById: true },
  });
  const as = <T>(fn: () => Promise<T>) =>
    requestContext.run({ correlationId: 'lvl', entityScope: hfcl.id }, async () => await fn());
  const actor = (role: string) =>
    ({
      id: base.createdById,
      roles: [role],
      permissions: new Set(['vendor:read_all', 'workflow_stage:approve']),
      entityId: hfcl.id,
    }) as never;
  const stageOf = async (id: string) =>
    (await prisma.case.findUniqueOrThrow({ where: { id }, select: { stage: true } })).stage;

  // Reviews: FCU / Legal approved, Operation still pending. Levels used: L1 and L3 (no L2).
  const c = await prisma.case.create({
    data: {
      id: newId(),
      ref: 'ZZLVL-1',
      entityId: hfcl.id,
      categoryKey: base.categoryKey,
      workflowKey: base.workflowKey,
      workflowVersion: base.workflowVersion,
      stage: 'review',
      tier: 'low',
      riskScore: 0,
      createdById: base.createdById,
      lastUpdatedById: base.createdById,
      infosecRequired: false,
      approvalLevels: ['l1', 'l3'],
      fcuStage: { create: { id: newId(), status: 'approved' } },
      legalStage: { create: { id: newId(), status: 'approved' } },
      operationStage: { create: { id: newId(), status: 'pending' } },
      l1Stage: { create: { id: newId(), status: 'waiting' } },
      l3Stage: { create: { id: newId(), status: 'waiting' } },
      sapStage: { create: { id: newId(), status: 'waiting' } },
    },
  });

  try {
    check(
      'L1 cannot act while the reviews are still running',
      /not awaiting/i.test(
        await as(() => err(() => svc.stageDecision(actor('l1'), c.id, 'l1', 'approve'))),
      ),
    );
    await as(() => svc.stageDecision(actor('operation'), c.id, 'operation', 'approve'));
    check('last review approved -> case moves to L1', (await stageOf(c.id)) === 'l1');
    check(
      'L1 row opened for its approver',
      (await prisma.caseL1.findUnique({ where: { caseId: c.id } }))?.status === 'pending',
    );
    check(
      'the case is in the L1 queue',
      (await as(() => svc.list(actor('l1'), { queue: 'l1' }))).some((r) => r.id === c.id),
    );
    check(
      'the case is not in the L3 queue yet',
      !(await as(() => svc.list(actor('l3'), { queue: 'l3' }))).some((r) => r.id === c.id),
    );
    check(
      'an L3 approver cannot act on L1',
      /only the l1/i.test(
        await as(() => err(() => svc.stageDecision(actor('l3'), c.id, 'l1', 'approve'))),
      ),
    );
    check(
      'L3 cannot act before L1',
      /not awaiting/i.test(
        await as(() => err(() => svc.stageDecision(actor('l3'), c.id, 'l3', 'approve'))),
      ),
    );
    check(
      'L2 is refused: this case does not use it',
      /not part/i.test(
        await as(() => err(() => svc.stageDecision(actor('l2'), c.id, 'l2', 'approve'))),
      ),
    );
    check(
      'send-back needs a remark',
      /remark/i.test(
        await as(() => err(() => svc.stageDecision(actor('l1'), c.id, 'l1', 'sendback'))),
      ),
    );

    await as(() => svc.stageDecision(actor('l1'), c.id, 'l1', 'approve'));
    check('L1 approved -> case skips L2 and moves to L3', (await stageOf(c.id)) === 'l3');

    await as(() =>
      svc.stageDecision(actor('l3'), c.id, 'l3', 'sendback', 'Need the latest GST return'),
    );
    check(
      'L3 send-back returns the case to the proposer',
      (await stageOf(c.id)) === 'review' &&
        (await prisma.caseL3.findUnique({ where: { caseId: c.id } }))?.status === 'sent_back',
    );
    // What the proposer's resubmit does for a level that sent the case back.
    await prisma.caseL3.update({ where: { caseId: c.id }, data: { status: 'pending' } });
    await prisma.case.update({ where: { id: c.id }, data: { stage: 'l3' } });

    await as(() => svc.stageDecision(actor('l3'), c.id, 'l3', 'reject', 'Not required'));
    check('L3 reject closes the case', (await stageOf(c.id)) === 'rejected');

    const reopened = await as(() => svc.bulk(actor('proposer'), 'reopen', [c.id], 'Try again'));
    check(
      'reopening resumes at the rejected level',
      !!reopened.results[0]?.ok &&
        (await stageOf(c.id)) === 'l3' &&
        (await prisma.caseL3.findUnique({ where: { caseId: c.id } }))?.status === 'pending',
      reopened.results[0]?.message,
    );

    await as(() => svc.stageDecision(actor('l3'), c.id, 'l3', 'approve'));
    check(
      'L3 approved -> SAP confirmation opens',
      (await stageOf(c.id)) === 'sap' &&
        (await prisma.caseSap.findUnique({ where: { caseId: c.id } }))?.status === 'pending',
    );
  } finally {
    await prisma.case.deleteMany({ where: { ref: 'ZZLVL-1' } });
    console.log(
      `\n${pass} passed, ${fail} failed; test cases left: ${await prisma.case.count({ where: { ref: 'ZZLVL-1' } })}`,
    );
    await prisma.$disconnect();
  }
}
main().catch((e: unknown) => {
  console.error(String(e).split('\n').slice(0, 12).join('\n'));
  process.exit(1);
});
