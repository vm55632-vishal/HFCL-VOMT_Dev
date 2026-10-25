import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './common/logging/logger.module';
import { CorrelationMiddleware } from './common/correlation.middleware';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { PrismaModule } from './prisma/prisma.module';
import { ProvidersModule } from './providers/providers.module';
import { CryptoModule } from './crypto/crypto.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { RegistrationModule } from './registration/registration.module';
import { UsersModule } from './users/users.module';
import { MasterDataModule } from './master-data/master-data.module';
import { WorkflowModule } from './workflow/workflow.module';
import { JobsModule } from './jobs/jobs.module';
import { CasesModule } from './cases/cases.module';
import { DocumentsModule } from './documents/documents.module';
import { VerificationModule } from './verification/verification.module';
import { ReportingModule } from './reporting/reporting.module';
import { LifecycleModule } from './lifecycle/lifecycle.module';
import { KycModule } from './kyc/kyc.module';
import { SessionGuard } from './auth/session.guard';
import { PermissionsGuard } from './authz/permissions.guard';

/**
 * Composition root. Global modules first; feature modules next. Three global guards run in order:
 * rate-limiting → authentication (session) → authorization (permissions) — deny-by-default.
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    ProvidersModule,
    CryptoModule,
    AuditModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    HealthModule,
    AuthModule,
    RegistrationModule,
    UsersModule,
    MasterDataModule,
    WorkflowModule,
    JobsModule,
    CasesModule,
    DocumentsModule,
    VerificationModule,
    ReportingModule,
    LifecycleModule,
    KycModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: throttle, then authenticate, then authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
