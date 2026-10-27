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
    summary:
      'Digi KYC on the authorised signatory, plus the risk checks for FCU (advances a running check)',
  })
  summary(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.kyc.summary(actor, id);
  }

  @Post('initiate')
  @RequirePermissions(PERMISSIONS.KycInitiate)
  @ApiOperation({
    summary: 'Start Digi KYC and email the vendor to complete it (again, if it was incomplete)',
  })
  initiate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.kyc.initiateDigi(actor, id);
  }

  @Post('risk/initiate')
  @RequirePermissions(PERMISSIONS.KycInitiate)
  @ApiOperation({ summary: 'Start the Hunter, IXSite and CRIF / CIBIL checks (FCU only)' })
  initiateRisk(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.kyc.initiateRisk(actor, id);
  }
}
