import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';

// Prisma, audit, crypto and the KYC provider are provided globally.
@Module({
  providers: [KycService],
  controllers: [KycController],
})
export class KycModule {}
