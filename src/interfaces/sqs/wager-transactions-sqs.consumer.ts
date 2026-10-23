import type { IdGeneratorPort } from "@application/ports/id-generator.port";
import type { MetricsPort } from "@application/ports/metrics.port";
import type { StructuredLoggerPort } from "@application/ports/structured-logger.port";
import { TOKENS } from "@application/ports/tokens";
import { CanonicalPayloadHasher } from "@application/shared/canonical-payload-hasher";
import { ProcessWagerTransactionUseCase } from "@application/use-cases/process-wager-transaction.use-case";
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand,
  type SQSClient,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { DomainError } from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import type { AppEnv } from "@infrastructure/config/env";
import type { SqsQueueRegistry, SqsQueueUrls } from "@infrastructure/messaging/sqs.module";
import { CorrelationContext } from "@infrastructure/observability/correlation-context";
import {
  type ConsumerMessageDisposition,
  type ConsumerPollSummaryDto,
  type WagerTransactionRequestedMessageDto,
  wagerTransactionRequestedMessageSchema,
} from "@interfaces/sqs/dto/sqs-wager-message.dto";
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";

export const FAILURE_CODE_CONSUMER_DISPOSITION: Readonly<
  Record<FailureCode, ConsumerMessageDisposition>
> = {
  [FailureCode.WalletLockTimeout]: "RETRY_TRANSIENT",
  [FailureCode.InsufficientFunds]: "ACK_TERMINAL",
  [FailureCode.ReversalWouldCauseNegativeBalance]: "ACK_TERMINAL",
  [FailureCode.CurrencyMismatch]: "ACK_TERMINAL",
  [FailureCode.WalletOwnershipMismatch]: "ACK_TERMINAL",
  [FailureCode.ReferenceNotFoundTimeout]: "ACK_TERMINAL",
  [FailureCode.ReferenceNotProcessed]: "ACK_TERMINAL",
  [FailureCode.InvalidReferenceKind]: "ACK_TERMINAL",
  [FailureCode.ReferenceContextMismatch]: "ACK_TERMINAL",
  [FailureCode.ReferenceAmountMismatch]: "ACK_TERMINAL",
  [FailureCode.ReferenceAlreadyReversed]: "ACK_TERMINAL",
  [FailureCode.InvalidMoneyAmount]: "PERMANENT_DLQ",
  [FailureCode.InvalidCurrencyCode]: "PERMANENT_DLQ",
  [FailureCode.WalletNotFound]: "PERMANENT_DLQ",
  [FailureCode.TransactionNotFound]: "PERMANENT_DLQ",
  [FailureCode.WalletAlreadyExists]: "PERMANENT_DLQ",
  [FailureCode.OpeningKindForbiddenExternally]: "PERMANENT_DLQ",
  [FailureCode.MissingReferenceTransaction]: "PERMANENT_DLQ",
  [FailureCode.IdempotencyPayloadConflict]: "PERMANENT_DLQ",
  [FailureCode.InvalidTransactionStateTransition]: "PERMANENT_DLQ",
  [FailureCode.LedgerEntryUnbalanced]: "PERMANENT_DLQ",
  [FailureCode.LedgerInconsistencyDetected]: "PERMANENT_DLQ",
  [FailureCode.InvalidPaginationCursor]: "PERMANENT_DLQ",
  [FailureCode.InfrastructurePermanentFailure]: "PERMANENT_DLQ",
};

@Injectable()
export class WagerTransactionsSqsConsumer implements OnModuleInit, OnApplicationShutdown {
  private isShuttingDown = false;
  private pollingLoopPromise: Promise<void> | undefined;
  private inFlightBatchPromise: Promise<ConsumerPollSummaryDto> | undefined;
  private readonly deliveryAttemptsByMessageKey = new Map<string, number>();

  constructor(
    @Inject(TOKENS.SQS_CLIENT) private readonly sqsClient: SQSClient,
    @Inject(TOKENS.SQS_QUEUE_REGISTRY)
    private readonly queueRegistry: SqsQueueRegistry,
    @Inject(TOKENS.APP_ENV) private readonly env: AppEnv,
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.LOGGER) private readonly logger: StructuredLoggerPort,
    @Inject(TOKENS.METRICS) private readonly metrics: MetricsPort,
    private readonly processWagerUseCase: ProcessWagerTransactionUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queueRegistry.ensureQueues();
    if (this.env.NODE_ENV !== "test" && this.env.activeRoles.has("consumer")) {
      this.startPolling();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stopPolling();
  }

  startPolling(): void {
    if (this.pollingLoopPromise !== undefined) {
      return;
    }
    this.isShuttingDown = false;
    this.pollingLoopPromise = this.runPollingLoop();
  }

  async stopPolling(): Promise<void> {
    this.isShuttingDown = true;
    if (this.inFlightBatchPromise !== undefined) {
      await this.inFlightBatchPromise;
    }
    if (this.pollingLoopPromise !== undefined) {
      await this.pollingLoopPromise;
      this.pollingLoopPromise = undefined;
    }
  }

  async pollOnce(maxMessages = 10, waitTimeSeconds = 0): Promise<ConsumerPollSummaryDto> {
    const urls = await this.queueRegistry.ensureQueues();
    const receiveResult = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: urls.wagerQueueUrl,
        MaxNumberOfMessages: Math.min(Math.max(1, maxMessages), 10),
        WaitTimeSeconds: waitTimeSeconds,
        AttributeNames: ["All"],
        MessageAttributeNames: ["All"],
      }),
    );

    const messages = receiveResult.Messages ?? [];
    if (messages.length === 0) {
      return {
        received: 0,
        acknowledged: 0,
        movedToDlq: 0,
        retriedTransient: 0,
      };
    }

    const batchPromise = this.processReceivedBatch(messages, urls);
    this.inFlightBatchPromise = batchPromise;
    try {
      return await batchPromise;
    } finally {
      this.inFlightBatchPromise = undefined;
    }
  }

  private async runPollingLoop(): Promise<void> {
    while (!this.isShuttingDown) {
      try {
        await this.pollOnce(10, this.env.SQS_WAIT_TIME_SEC);
      } catch (error) {
        this.logger.error({
          event: "sqs.consumer.poll_error",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async processReceivedBatch(
    messages: readonly Message[],
    urls: SqsQueueUrls,
  ): Promise<ConsumerPollSummaryDto> {
    let acknowledged = 0;
    let movedToDlq = 0;
    let retriedTransient = 0;

    for (let index = 0; index < messages.length; index += 1) {
      const sqsMessage = messages[index];
      if (sqsMessage === undefined) {
        continue;
      }

      if (this.isShuttingDown) {
        await this.releaseRemainingMessagesVisibility(messages.slice(index), urls.wagerQueueUrl);
        break;
      }

      const disposition = await this.processSingleMessage(sqsMessage, urls);
      if (disposition === "ACK_TERMINAL") {
        acknowledged += 1;
      }
      if (disposition === "PERMANENT_DLQ") {
        movedToDlq += 1;
      }
      if (disposition === "RETRY_TRANSIENT") {
        retriedTransient += 1;
      }
    }

    return {
      received: messages.length,
      acknowledged,
      movedToDlq,
      retriedTransient,
    };
  }

  async processSingleMessage(
    sqsMessage: Message,
    urls: SqsQueueUrls,
  ): Promise<ConsumerMessageDisposition> {
    const rawBody = sqsMessage.Body ?? "";
    const receiptHandle = sqsMessage.ReceiptHandle;
    const rawPayloadHash = CanonicalPayloadHasher.computeRaw(rawBody);

    const parsedEnvelope = this.parseEnvelope(rawBody);
    if (!parsedEnvelope.ok) {
      await this.moveToDlqAndAck({
        sqsMessage,
        urls,
        failureReason: parsedEnvelope.reason,
        failureCode: "INVALID_SQS_ENVELOPE",
      });
      return "PERMANENT_DLQ";
    }

    const envelope = parsedEnvelope.value;
    const receiveCount = this.incrementAndResolveReceiveCount(sqsMessage, envelope.messageId);
    const correlationId = envelope.correlationId ?? this.idGenerator.generate();

    return CorrelationContext.run(
      {
        correlationId,
        messageId: envelope.messageId,
        walletId: envelope.data.walletId,
        providerId: envelope.data.providerId,
        roundId: envelope.data.roundId,
      },
      async () => {
        try {
          await this.processWagerUseCase.execute({
            providerId: envelope.data.providerId,
            externalTransactionId: envelope.data.externalTransactionId,
            idempotencyKey: envelope.data.idempotencyKey,
            walletId: envelope.data.walletId,
            playerId: envelope.data.playerId,
            roundId: envelope.data.roundId,
            gameId: envelope.data.gameId,
            kind: envelope.data.kind,
            money: envelope.data.money,
            referenceExternalTransactionId: envelope.data.referenceExternalTransactionId,
            occurredAt: envelope.occurredAt,
            correlationId,
            inboxRegistration: {
              consumerName: this.env.SQS_CONSUMER_NAME,
              messageId: envelope.messageId,
              payloadHash: rawPayloadHash,
            },
          });

          await this.deleteFromMainQueue(urls.wagerQueueUrl, receiptHandle);
          this.deliveryAttemptsByMessageKey.delete(envelope.messageId);

          this.logger.info({
            event: "sqs.consumer.message_acknowledged",
            messageId: envelope.messageId,
            walletId: envelope.data.walletId,
            providerId: envelope.data.providerId,
          });

          return "ACK_TERMINAL";
        } catch (error) {
          return this.handleProcessingError({
            error,
            sqsMessage,
            envelope,
            receiveCount,
            urls,
          });
        }
      },
    );
  }

  private async handleProcessingError(params: {
    readonly error: unknown;
    readonly sqsMessage: Message;
    readonly envelope: WagerTransactionRequestedMessageDto;
    readonly receiveCount: number;
    readonly urls: SqsQueueUrls;
  }): Promise<ConsumerMessageDisposition> {
    const { error, sqsMessage, envelope, receiveCount, urls } = params;
    const disposition = this.classifyErrorDisposition(error);
    const failureCode =
      error instanceof DomainError ? error.failureCode : FailureCode.InfrastructurePermanentFailure;
    const reason = error instanceof Error ? error.message : String(error);

    if (disposition === "PERMANENT_DLQ" || receiveCount >= this.env.SQS_MAX_RECEIVE_COUNT) {
      await this.moveToDlqAndAck({
        sqsMessage,
        urls,
        failureReason: reason,
        failureCode,
        messageGroupId: envelope.data.walletId,
        deduplicationId: `${envelope.messageId}:dlq`,
      });
      this.deliveryAttemptsByMessageKey.delete(envelope.messageId);
      return "PERMANENT_DLQ";
    }

    const backoffSeconds = Math.min(30, 2 ** Math.max(0, receiveCount - 1));
    if (sqsMessage.ReceiptHandle !== undefined) {
      await this.sqsClient.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: urls.wagerQueueUrl,
          ReceiptHandle: sqsMessage.ReceiptHandle,
          VisibilityTimeout: backoffSeconds,
        }),
      );
    }

    this.metrics.incrementRetry("sqs_consumer", failureCode);

    this.logger.warn({
      event: "sqs.consumer.transient_retry_scheduled",
      messageId: envelope.messageId,
      walletId: envelope.data.walletId,
      receiveCount,
      backoffSeconds,
      failureCode,
    });

    return "RETRY_TRANSIENT";
  }

  private classifyErrorDisposition(error: unknown): ConsumerMessageDisposition {
    if (error instanceof DomainError) {
      return FAILURE_CODE_CONSUMER_DISPOSITION[error.failureCode] ?? "PERMANENT_DLQ";
    }
    return "RETRY_TRANSIENT";
  }

  private parseEnvelope(
    rawBody: string,
  ):
    | { readonly ok: true; readonly value: WagerTransactionRequestedMessageDto }
    | { readonly ok: false; readonly reason: string } {
    try {
      const json = JSON.parse(rawBody) as unknown;
      const result = wagerTransactionRequestedMessageSchema.safeParse(json);
      if (!result.success) {
        return {
          ok: false,
          reason: result.error.issues.map((i) => i.message).join("; "),
        };
      }
      return { ok: true, value: result.data };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Invalid JSON payload",
      };
    }
  }

  private incrementAndResolveReceiveCount(sqsMessage: Message, messageKey: string): number {
    const sqsAttrCount = Number(sqsMessage.Attributes?.ApproximateReceiveCount ?? "1");
    const localCount = (this.deliveryAttemptsByMessageKey.get(messageKey) ?? 0) + 1;
    this.deliveryAttemptsByMessageKey.set(messageKey, localCount);
    return Math.max(sqsAttrCount, localCount);
  }

  private async moveToDlqAndAck(params: {
    readonly sqsMessage: Message;
    readonly urls: SqsQueueUrls;
    readonly failureReason: string;
    readonly failureCode: string;
    readonly messageGroupId?: string | undefined;
    readonly deduplicationId?: string | undefined;
  }): Promise<void> {
    const { sqsMessage, urls, failureReason, failureCode, messageGroupId, deduplicationId } =
      params;

    const dlqPayload = JSON.stringify({
      originalMessageId: sqsMessage.MessageId ?? this.idGenerator.generate(),
      failureCode,
      failureReason,
      failedAt: new Date().toISOString(),
      rawBody: sqsMessage.Body ?? "",
    });

    const dedupId = deduplicationId ?? `${sqsMessage.MessageId ?? this.idGenerator.generate()}:dlq`;

    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: urls.wagerDlqUrl,
        MessageBody: dlqPayload,
        MessageGroupId: messageGroupId ?? "dlq-default-group",
        MessageDeduplicationId: dedupId,
      }),
    );

    await this.deleteFromMainQueue(urls.wagerQueueUrl, sqsMessage.ReceiptHandle);
    this.metrics.incrementDlqMessages(failureCode);

    this.logger.warn({
      event: "sqs.consumer.message_moved_to_dlq",
      sqsMessageId: sqsMessage.MessageId,
      failureCode,
      failureReason,
    });
  }

  private async deleteFromMainQueue(
    queueUrl: string,
    receiptHandle: string | undefined,
  ): Promise<void> {
    if (receiptHandle === undefined) {
      return;
    }
    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private async releaseRemainingMessagesVisibility(
    remaining: readonly Message[],
    queueUrl: string,
  ): Promise<void> {
    for (const msg of remaining) {
      if (msg.ReceiptHandle === undefined) {
        continue;
      }
      await this.sqsClient.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: msg.ReceiptHandle,
          VisibilityTimeout: 0,
        }),
      );
    }
  }
}
