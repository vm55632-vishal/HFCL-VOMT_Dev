import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS, UserStatus } from '@vop/shared';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { RequirePermissions } from '../authz/permissions.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

const updateSchema = z
  .object({
    name: z.string().min(1).optional(),
    groupRoleKeys: z.array(z.string()).max(10).optional(),
    entityRoles: z
      .object({
        entityCode: z.string().trim().min(2).max(12),
        roleKeys: z.array(z.string()).max(20),
      })
      .strict()
      .optional(),
    status: z.nativeEnum(UserStatus).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes provided.' });
type UpdateBody = z.infer<typeof updateSchema>;

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.UserRead)
  @ApiOperation({ summary: 'List/search users (admin)' })
  async list(
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.users.list({
      q,
      role,
      status,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user (self, or with user:read)' })
  async getOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    // Object-level authorization (anti-IDOR): a user may read only their own record
    // unless they hold user:read. The id in the URL never widens access.
    if (id !== actor.id && !actor.permissions.has(PERMISSIONS.UserRead)) {
      throw new ForbiddenException('Not authorized to view this user.');
    }
    const user = await this.users.getOne(id);
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.UserManage)
  @ApiOperation({ summary: 'Update a user: name, roles, status (admin)' })
  async update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateBody,
  ) {
    return this.users.update(id, body, actor.id);
  }

  @Post(':id/force-logout')
  @RequirePermissions(PERMISSIONS.UserForceLogout)
  @ApiOperation({ summary: 'Revoke all of a user’s sessions (admin)' })
  async forceLogout(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.forceLogout(id, actor.id);
  }
}
