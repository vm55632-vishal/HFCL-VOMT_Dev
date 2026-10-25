import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@vop/shared';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { RequirePermissions } from '../authz/permissions.decorator';
import { TeamStructureService } from './team-structure.service';

@ApiTags('team-structure')
@Controller('team-structure')
export class TeamStructureController {
  constructor(private readonly team: TeamStructureService) {}

  @Get('me')
  @RequirePermissions(PERMISSIONS.VendorCreate)
  @ApiOperation({ summary: "The signed-in proposer's team structure, from the master table" })
  me(@CurrentUser() actor: AuthUser) {
    return this.team.preview(actor);
  }
}
