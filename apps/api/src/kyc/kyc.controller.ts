import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@vop/shared';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { RequirePermissions } from '../authz/permissions.decorator';
import { KycService } from './kyc.service';

@ApiTags('kyc')
@Controller('cases/:id/kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Get()
  @ApiOperation({
    summary: 'KYC & risk checks on the authorised signatory (advances a running check)',
  })
  summary(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.kyc.summary(actor, id);
  }

  @Post('initiate')
  @RequirePermissions(PERMISSIONS.KycInitiate)
  @ApiOperation({ summary: 'Initiate Digi KYC and the follow-on risk checks' })
  initiate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.kyc.initiate(actor, id);
  }
}
