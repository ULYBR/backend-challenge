import type { ClockPort } from "@application/ports/clock.port";
import type { MetricsPort } from "@application/ports/metrics.port";
import type { OutboxRepositoryPort } from "@application/ports/outbox-repository.port";
import type { StructuredLoggerPort } from "@application/ports/structured-logger.port";
import { TOKENS } from "@application/ports/tokens";
import { type SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { OutboxMessage } from "@domain/messaging/outbox-message";
import type { AppEnv } from "@infrastructure/config/env";
import type { SqsQueueRegistry } from "@infrastructure/messaging/sqs.module";
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";

export interface OutboxPublishBatchResultDto {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
}

@Injectable()
export class OutboxPublisherWorker implements OnModuleInit, OnApplicationShutdown {
  private timer: Timer | undefined;
  private inFlightPromise: Promise<OutboxPublishBatchResultDto> | undefined;

  constructor(
    @Inject(TOKENS.OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepositoryPort,
    @Inject(TOKENS.SQS_CLIENT)
    private readonly sqsClient: SQSClient,
    @Inject(TOKENS.SQS_QUEUE_REGISTRY)
    private readonly queueRegistry: SqsQueueRegistry,
    @Inject(TOKENS.APP_ENV)
    private readonly env: AppEnv,
    @Inject(TOKENS.CLOCK)
    private readonly clock: ClockPort,
    @Inject(TOKENS.LOGGER)
    private readonly logger: StructuredLoggerPort,
    @Inject(TOKENS.METRICS)
    private readonly metrics: MetricsPort,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queueRegistry.ensureQueues();
    if (this.env.NODE_ENV !== "test" && this.env.activeRoles.has("outbox")) {
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
      void this.publishDueBatch();
    }, this.env.OUTBOX_POLL_INTERVAL_MS);
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

  async publishDueBatch(
    customWorkerId?: string,
    customBatchSize?: number,
  ): Promise<OutboxPublishBatchResultDto> {
    const runPromise = this.executeBatchPublish(customWorkerId, customBatchSize);
    this.inFlightPromise = runPromise;
    try {
      return await runPromise;
    } finally {
      this.inFlightPromise = undefined;
    }
  }

  async claimOnlyWithoutPublishing(
    workerId: string,
    leaseMs: number,
    limit: number,
  ): Promise<readonly OutboxMessage[]> {
    const now = this.clock.now();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    return this.outboxRepository.claimDueBatch({
      workerId,
      now,
      leaseUntil,
      limit,
    });
  }

  private async executeBatchPublish(
    customWorkerId?: string,
    customBatchSize?: number,
  ): Promise<OutboxPublishBatchResultDto> {
    const now = this.clock.now();
    const leaseUntil = new Date(now.getTime() + this.env.OUTBOX_LEASE_MS);
    const workerId = customWorkerId ?? this.env.INSTANCE_ID;
    const limit = customBatchSize ?? this.env.OUTBOX_BATCH_SIZE;

    const claimedMessages = await this.outboxRepository.claimDueBatch({
      workerId,
      now,
      leaseUntil,
      limit,
    });

    if (claimedMessages.length === 0) {
      return { claimed: 0, published: 0, failed: 0 };
    }

    const urls = await this.queueRegistry.ensureQueues();
    let published = 0;
    let failed = 0;

    for (const message of claimedMessages) {
      const didPublish = await this.publishSingleOutboxMessage(message, urls.eventsQueueUrl);
      if (didPublish) {
        published += 1;
      }
      if (!didPublish) {
        failed += 1;
      }
    }

    return {
      claimed: claimedMessages.length,
      published,
      failed,
    };
  }

  private async publishSingleOutboxMessage(
    message: OutboxMessage,
    eventsQueueUrl: string,
  ): Promise<boolean> {
    const now = this.clock.now();
    try {
      await this.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: eventsQueueUrl,
          MessageBody: JSON.stringify(message.payload),
          MessageGroupId: message.aggregateId,
          MessageDeduplicationId: message.id,
        }),
      );

      message.markPublished(now);
      await this.outboxRepository.update(message);

      this.logger.info({
        event: "outbox.event.published",
        correlationId: message.correlationId,
        causationId: message.causationId,
        outboxMessageId: message.id,
        eventType: message.eventType,
        aggregateType: message.aggregateType,
        aggregateId: message.aggregateId,
      });

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      message.scheduleRetry(now, errorMessage);
      await this.outboxRepository.update(message);
      this.metrics.incrementRetry("outbox_publisher", message.eventType);

      this.logger.warn({
        event: "outbox.event.publish_failed",
        correlationId: message.correlationId,
        outboxMessageId: message.id,
        eventType: message.eventType,
        attempts: message.attempts,
        errorMessage,
      });

      return false;
    }
  }
}
