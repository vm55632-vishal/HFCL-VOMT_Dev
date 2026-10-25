import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Thin wrapper over the generated Prisma client. All persistence goes through this.
 * Parameterised queries only (no string-built SQL) — see ADR-0003.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private keepAlive?: NodeJS.Timeout;

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // Prisma opens pool connections lazily; against a remote database each new connection costs
    // several round trips (TCP + TLS + auth), which the first user request would otherwise pay.
    // Warm the pool in the background so it's ready (never blocks or fails startup).
    void Promise.all(Array.from({ length: 6 }, () => this.$queryRaw`SELECT 1`)).catch(
      () => undefined,
    );
    // Idle pool connections are dropped after a quiet spell, and the next click then pays the full
    // reconnect cost (0.8 – 2 s against a remote database). A light ping keeps a few ready.
    this.keepAlive = setInterval(() => {
      void Promise.all(Array.from({ length: 3 }, () => this.$queryRaw`SELECT 1`)).catch(
        () => undefined,
      );
    }, 30_000);
    this.keepAlive.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.keepAlive) clearInterval(this.keepAlive);
    await this.$disconnect();
  }
}
