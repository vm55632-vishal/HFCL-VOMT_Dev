import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PERMISSIONS, type Permission } from '@vop/shared';
import { UsersController } from './users.controller';
import type { UsersService } from './users.service';
import type { AuthUser } from '../auth/auth-user';

function principal(id: string, perms: Permission[] = []): AuthUser {
  return {
    id,
    email: `${id}@vop.local`,
    name: id,
    status: 'ACTIVE',
    roles: [],
    permissions: new Set(perms),
    managerId: null,
    entityId: null,
    entityCode: null,
    entities: [],
    groupWide: false,
    sessionId: 's',
  };
}

describe('UsersController object-level authorization (anti-IDOR)', () => {
  const service = {
    getOne: jest.fn(async (id: string) => ({ id, email: `${id}@vop.local`, name: id })),
  } as unknown as UsersService;
  const controller = new UsersController(service);

  beforeEach(() => jest.clearAllMocks());

  it('lets a user read their OWN record', async () => {
    const me = principal('alice');
    await expect(controller.getOne(me, 'alice')).resolves.toMatchObject({ id: 'alice' });
  });

  it('DENIES reading another user by changing the id (no user:read)', async () => {
    const me = principal('alice');
    await expect(controller.getOne(me, 'bob')).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.getOne).not.toHaveBeenCalled();
  });

  it('allows reading another user WITH user:read', async () => {
    const admin = principal('admin', [PERMISSIONS.UserRead]);
    await expect(controller.getOne(admin, 'bob')).resolves.toMatchObject({ id: 'bob' });
  });

  it('returns 404 when the (authorized) target does not exist', async () => {
    const admin = principal('admin', [PERMISSIONS.UserRead]);
    (service.getOne as jest.Mock).mockResolvedValueOnce(null);
    await expect(controller.getOne(admin, 'ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});
