import type { StructuredLoggerPort } from "@application/ports/structured-logger.port";
import { TOKENS } from "@application/ports/tokens";
import { ProcessWagerTransactionUseCase } from "@application/use-cases/process-wager-transaction.use-case";
import type { AppEnv } from "@infrastructure/config/env";
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";

@Injectable()
export class PendingReferenceWorker implements OnModuleInit, OnApplicationShutdown {
  private timer: Timer | undefined;
  private inFlightPromise: Promise<number> | undefined;

  constructor(
    private readonly processWagerUseCase: ProcessWagerTransactionUseCase,
    @Inject(TOKENS.APP_ENV) private readonly env: AppEnv,
    @Inject(TOKENS.LOGGER) private readonly logger: StructuredLoggerPort,
  ) {}

  onModuleInit(): void {
    if (this.env.NODE_ENV !== "test" && this.env.activeRoles.has("scheduler")) {
      this.start();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.env.PENDING_REF_POLL_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.inFlightPromise !== undefined) {
      await this.inFlightPromise;
    }
  }

  async runOnce(batchSize = 50, maxAttempts?: number): Promise<number> {
    const effectiveMaxAttempts = maxAttempts ?? this.env.PENDING_REF_MAX_ATTEMPTS;
    const promise = this.processWagerUseCase.resolvePendingReferenceBatch(
      batchSize,
      effectiveMaxAttempts,
    );
    this.inFlightPromise = promise;
    try {
      const resolvedCount = await promise;
      if (resolvedCount > 0) {
        this.logger.info({
          event: "pending_reference.batch.resolved",
          resolvedCount,
        });
      }
      return resolvedCount;
    } finally {
      this.inFlightPromise = undefined;
    }
  }
}
