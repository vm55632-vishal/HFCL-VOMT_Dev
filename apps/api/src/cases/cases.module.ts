import { Module } from '@nestjs/common';
import { CasesService } from './cases.service';
import { CasesController } from './cases.controller';
import { TeamStructureService } from './team-structure.service';
import { TeamStructureController } from './team-structure.controller';
import { WorkflowModule } from '../workflow/workflow.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { LifecycleModule } from '../lifecycle/lifecycle.module';
import { VerificationModule } from '../verification/verification.module';

@Module({
  // VerificationModule gives us the same-day verification cache, so case creation can persist the
  // PAN/GST/bank/MSME responses that were shown on the form. crypto + audit are global.
  imports: [WorkflowModule, MasterDataModule, LifecycleModule, VerificationModule],
  providers: [CasesService, TeamStructureService],
  controllers: [CasesController, TeamStructureController],
  exports: [CasesService],
})
export class CasesModule {}
