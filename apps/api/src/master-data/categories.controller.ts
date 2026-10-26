import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { APPROVAL_LEVELS, PERMISSIONS } from '@vop/shared';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { RequirePermissions } from '../authz/permissions.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CategoriesService } from './categories.service';

const createSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]+$/, 'Use lower_snake_case.'),
    name: z.string().min(1),
    description: z.string().optional(),
    sortOrder: z.number().int().optional(),
    enhancedDueDiligence: z.boolean().optional(),
    requiredDocuments: z.array(z.string()).optional(),
    requiredValidations: z.array(z.string()).optional(),
    workflowKey: z.string().min(1),
    // Approval levels this category's cases run after the reviews (none = straight to SAP).
    approvalLevels: z.array(z.enum(APPROVAL_LEVELS)).max(APPROVAL_LEVELS.length).optional(),
  })
  .strict();
type CreateBody = z.infer<typeof createSchema>;

const updateSchema = createSchema
  .partial()
  .omit({ key: true })
  .extend({ active: z.boolean().optional() })
  .strict();
type UpdateBody = z.infer<typeof updateSchema>;

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List vendor categories (active by default)' })
  list(@Query('all') all?: string) {
    return this.categories.list(all === 'true');
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SettingsManage)
  @ApiOperation({ summary: 'Create a vendor category (admin)' })
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(createSchema)) body: CreateBody,
  ) {
    return this.categories.create(body, actor.id);
  }

  @Patch(':key')
  @RequirePermissions(PERMISSIONS.SettingsManage)
  @ApiOperation({ summary: 'Update a vendor category (admin)' })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateBody,
  ) {
    return this.categories.update(key, body, actor.id);
  }
}
