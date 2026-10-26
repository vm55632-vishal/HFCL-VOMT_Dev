import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@vop/shared';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { RequirePermissions } from '../authz/permissions.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { EntitiesService } from './entities.service';

const domains = z.array(z.string().trim().min(1).max(253)).max(20);
const createSchema = z
  .object({
    code: z.string().trim().min(2).max(12),
    name: z.string().trim().min(2).max(200),
    emailDomains: domains.optional(),
  })
  .strict();
const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    emailDomains: domains.optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes provided.' });

@ApiTags('entities')
@Controller('entities')
export class EntitiesController {
  constructor(private readonly entities: EntitiesService) {}

  @Get()
  @ApiOperation({ summary: 'Companies the signed-in user may work in' })
  mine(@CurrentUser() actor: AuthUser) {
    return actor.entities;
  }

  @Get('all')
  @RequirePermissions(PERMISSIONS.SettingsRead)
  @ApiOperation({ summary: 'Every company in the group, with email domains (admin)' })
  all() {
    return this.entities.all();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SettingsManage)
  @ApiOperation({ summary: 'Add a company to the group (admin)' })
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.entities.create(body, actor.id);
  }

  @Patch(':code')
  @RequirePermissions(PERMISSIONS.SettingsManage)
  @ApiOperation({ summary: "Change a company's name, email domains or status (admin)" })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.entities.update(code, body, actor.id);
  }
}
