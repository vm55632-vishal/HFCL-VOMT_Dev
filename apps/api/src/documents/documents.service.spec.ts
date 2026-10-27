import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PERMISSIONS } from '@vop/shared';
import { DocumentsService } from './documents.service';
import type { AuthUser } from '../auth/auth-user';

const CASE = '01HZZZZZZZZZZZZZZZZZZZZZZA';
const MINE = '01HZZZZZZZZZZZZZZZZZZZZZZB';
const THEIRS = '01HZZZZZZZZZZZZZZZZZZZZZZC';

function actor(id: string, perms: string[] = [PERMISSIONS.DocumentUpload]): AuthUser {
  return { id, permissions: new Set(perms), roles: [] } as unknown as AuthUser;
}

function setup(stage = 'review') {
  const docs = [
    { id: MINE, docType: 'insurance', sha256: 'aa', storageKey: 'k1', uploadedById: 'me' },
    { id: THEIRS, docType: 'fcu_dd_report', sha256: 'bb', storageKey: 'k2', uploadedById: 'fcu' },
  ];
  const prisma = {
    case: {
      findUnique: jest.fn().mockResolvedValue({
        createdById: 'me',
        onBehalfOfId: null,
        assigneeId: null,
        stage,
      }),
    },
    document: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        docs.filter((d) => where.id.in.includes(d.id)),
      ),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const storage = { remove: jest.fn().mockResolvedValue(undefined) };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const svc = new DocumentsService(
    {} as never,
    storage as never,
    {} as never,
    prisma as never,
    audit as never,
  );
  return { svc, prisma, storage, audit };
}

describe('DocumentsService.remove', () => {
  it('removes your own upload, audits it and deletes the stored file', async () => {
    const { svc, prisma, storage, audit } = setup();
    await expect(svc.remove(actor('me'), CASE, [MINE])).resolves.toEqual({ removed: 1 });
    expect(prisma.document.deleteMany).toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.remove', entityId: MINE }),
    );
    expect(storage.remove).toHaveBeenCalledWith('k1');
  });

  it("refuses someone else's file, and removes nothing from a mixed selection", async () => {
    const { svc, prisma } = setup();
    await expect(svc.remove(actor('me'), CASE, [MINE, THEIRS])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.document.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses on a finished case, even your own file', async () => {
    const { svc, prisma } = setup('approved');
    await expect(svc.remove(actor('me'), CASE, [MINE])).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.document.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses without the upload permission', async () => {
    const { svc } = setup();
    await expect(svc.remove(actor('me', []), CASE, [MINE])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a file that is not on this case', async () => {
    const { svc } = setup();
    await expect(
      svc.remove(actor('me'), CASE, ['01HZZZZZZZZZZZZZZZZZZZZZZD']),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a user who cannot see the case', async () => {
    const { svc } = setup();
    await expect(svc.remove(actor('stranger'), CASE, [MINE])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
