import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@vop/shared';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RegistrationService } from './registration.service';

const selfRegisterSchema = z
  .object({
    requestedRoles: z.array(z.string()).min(1, 'Request at least one role.'),
    entityCode: z.string().trim().min(2).max(12).optional(),
    justification: z.string().min(10, 'Provide a business justification (min 10 chars).'),
    department: z.string().optional(),
    designation: z.string().optional(),
    employeeId: z.string().optional(),
  })
  .strict();
type SelfRegisterBody = z.infer<typeof selfRegisterSchema>;

const decisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'request-info']),
    roles: z.array(z.string()).optional(),
    note: z.string().max(2000).optional(),
  })
  .strict();
type DecisionBody = z.infer<typeof decisionSchema>;

@ApiTags('registration')
@Controller('registrations')
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  @Post()
  @ApiOperation({ summary: 'Submit an access request (self-registration)' })
  async submit(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(selfRegisterSchema)) body: SelfRegisterBody,
  ): Promise<{ id: string }> {
    return this.registration.selfRegister(user.id, body);
  }

  @Get('pending')
  @ApiOperation({ summary: "The current user's approval inbox (their reports' requests)" })
  async pending(@CurrentUser() user: AuthUser) {
    return this.registration.pendingForManager(user.id);
  }

  @Post(':id/decision')
  @ApiOperation({
    summary: 'Approve, reject, or request info on a request (manager / platform admin)',
  })
  async decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decisionSchema)) body: DecisionBody,
  ): Promise<{ ok: true }> {
    await this.registration.decide(
      id,
      { id: user.id, isPlatformAdmin: user.permissions.has(PERMISSIONS.RegistrationApprove) },
      body.decision,
      body.note,
      body.roles,
    );
    return { ok: true };
  }
}
