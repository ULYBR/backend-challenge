import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import type { OutboxRepositoryPort } from "@application/ports/outbox-repository.port";
import { TOKENS } from "@application/ports/tokens";
import {
  GetWagerTransactionUseCase,
  GetWalletUseCase,
  OpenWalletUseCase,
  ReconcileWalletUseCase,
} from "@application/use-cases";
import { ReceiveMessageCommand, type SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { FailureCode } from "@domain/shared/failure-code";
import { WagerTransactionKind, WagerTransactionStatus } from "@domain/wagering/wager-transaction";
import { parseEnv } from "@infrastructure/config/env";
import { OutboxPublisherWorker } from "@infrastructure/messaging/outbox-publisher.worker";
import { PendingReferenceWorker } from "@infrastructure/messaging/pending-reference.worker";
import type { SqsQueueRegistry, SqsQueueUrls } from "@infrastructure/messaging/sqs.module";
import { WagerTransactionsSqsConsumer } from "@interfaces/sqs/wager-transactions-sqs.consumer";
import { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "@src/app.module";
import { assertAllWalletsMatchLedger } from "@test/helpers/assert-wallet-ledger-invariant";
import { drainSqsQueue } from "@test/helpers/drain-sqs-queue";

describe("Phases 6, 7 & 8 Integration — SQS Consumer, Inbox, Outbox Publisher & PendingReferenceWorker", () => {
  let appContext: INestApplicationContext;
  let orm: MikroORM;
  let em: EntityManager;
  let sqsClient: SQSClient;
  let queueRegistry: SqsQueueRegistry;
  let urls: SqsQueueUrls;
  let openWalletUseCase: OpenWalletUseCase;
  let getWalletUseCase: GetWalletUseCase;
  let getTxUseCase: GetWagerTransactionUseCase;
  let reconcileUseCase: ReconcileWalletUseCase;
  let sqsConsumer: WagerTransactionsSqsConsumer;
  let outboxPublisher: OutboxPublisherWorker;
  let outboxRepository: OutboxRepositoryPort;
  let pendingRefWorker: PendingReferenceWorker;

  async function drainQueue(queueUrl: string): Promise<string[]> {
    const bodies: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 0,
        }),
      );
      const msgs = res.Messages ?? [];
      if (msgs.length === 0) {
        break;
      }
      for (const m of msgs) {
        if (m.Body !== undefined) {
          bodies.push(m.Body);
        }
      }
    }
    return bodies;
  }

  beforeAll(async () => {
    const env = parseEnv({
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      APP_ROLE: "all",
      SQS_MAX_RECEIVE_COUNT: "3",
      SQS_WAGER_QUEUE_NAME: "wager-tx-phase6.fifo",
      SQS_WAGER_DLQ_NAME: "wager-dlq-phase6.fifo",
      SQS_EVENTS_QUEUE_NAME: "wallet-events-phase6.fifo",
    });

    appContext = await NestFactory.createApplicationContext(AppModule.register(env), {
      logger: false,
    });

    orm = appContext.get<MikroORM>(TOKENS.MIKRO_ORM);
    em = appContext.get<EntityManager>(TOKENS.ENTITY_MANAGER);
    sqsClient = appContext.get<SQSClient>(TOKENS.SQS_CLIENT);
    queueRegistry = appContext.get<SqsQueueRegistry>(TOKENS.SQS_QUEUE_REGISTRY);
    openWalletUseCase = appContext.get(OpenWalletUseCase);
    getWalletUseCase = appContext.get(GetWalletUseCase);
    getTxUseCase = appContext.get(GetWagerTransactionUseCase);
    reconcileUseCase = appContext.get(ReconcileWalletUseCase);
    sqsConsumer = appContext.get(WagerTransactionsSqsConsumer);
    outboxPublisher = appContext.get(OutboxPublisherWorker);
    outboxRepository = appContext.get<OutboxRepositoryPort>(TOKENS.OUTBOX_REPOSITORY);
    pendingRefWorker = appContext.get(PendingReferenceWorker);

    await orm.getMigrator().up();
    urls = await queueRegistry.ensureQueues();
  });

  beforeEach(async () => {
    await em.execute(
      "TRUNCATE TABLE outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets CASCADE",
    );
    await Promise.all([
      drainSqsQueue(sqsClient, urls.wagerQueueUrl),
      drainSqsQueue(sqsClient, urls.wagerDlqUrl),
      drainSqsQueue(sqsClient, urls.eventsQueueUrl),
    ]);
  });

  afterAll(async () => {
    await appContext.close();
  });

  it("Phase 6: consumes WagerTransactionRequested from SQS, deduplicates redelivery via persistent inbox, and routes malformed/permanent failures to DLQ", async () => {
    const playerId = randomUUID();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const validMessage = {
      messageId: "msg-bet-101",
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        providerId: "provider-sqs",
        externalTransactionId: "ext-sqs-101",
        idempotencyKey: "provider-sqs:ext-sqs-101",
        playerId,
        walletId: wallet.id,
        roundId: "round-sqs-1",
        gameId: "slot-sqs",
        kind: WagerTransactionKind.Bet,
        money: { amount: "30.00", currency: "BRL" },
      },
    };

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: urls.wagerQueueUrl,
        MessageBody: JSON.stringify(validMessage),
        MessageGroupId: wallet.id,
        MessageDeduplicationId: `dedup-${randomUUID()}`,
      }),
    );

    const firstPoll = await sqsConsumer.pollOnce(10, 0);
    expect(firstPoll.received).toBe(1);
    expect(firstPoll.acknowledged).toBe(1);

    const walletAfterFirst = await getWalletUseCase.execute({ walletId: wallet.id });
    expect(walletAfterFirst.balance.amount).toBe("70.00");

    const inboxRows = await em.execute<
      Array<{ readonly message_id: string; readonly processed_at: Date | null }>
    >("SELECT message_id, processed_at FROM inbox_messages WHERE message_id = ?", ["msg-bet-101"]);
    expect(inboxRows).toHaveLength(1);
    expect(inboxRows[0]?.processed_at).not.toBeNull();

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: urls.wagerQueueUrl,
        MessageBody: JSON.stringify(validMessage),
        MessageGroupId: wallet.id,
        MessageDeduplicationId: `dedup-${randomUUID()}`,
      }),
    );

    const secondPoll = await sqsConsumer.pollOnce(10, 0);
    expect(secondPoll.received).toBe(1);
    expect(secondPoll.acknowledged).toBe(1);

    const walletAfterRedelivery = await getWalletUseCase.execute({
      walletId: wallet.id,
    });
    expect(walletAfterRedelivery.balance.amount).toBe("70.00");
    expect(walletAfterRedelivery.version).toBe(2);

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: urls.wagerQueueUrl,
        MessageBody: "{ invalid-json-poison-pill",
        MessageGroupId: wallet.id,
        MessageDeduplicationId: `dedup-${randomUUID()}`,
      }),
    );

    const poisonPoll = await sqsConsumer.pollOnce(10, 0);
    expect(poisonPoll.movedToDlq).toBe(1);

    const dlqBodies = await drainQueue(urls.wagerDlqUrl);
    expect(dlqBodies.length).toBeGreaterThanOrEqual(1);
    expect(dlqBodies[0]).toContain("INVALID_SQS_ENVELOPE");

    await assertAllWalletsMatchLedger(em, reconcileUseCase);
  });

  it("Phase 7: OutboxPublisherWorker recovers from worker crash after lease claim and supports concurrent publishers without losing events", async () => {
    const playerId = randomUUID();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "200.00", currency: "BRL" },
    });

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: urls.wagerQueueUrl,
        MessageBody: JSON.stringify({
          messageId: "msg-outbox-test-1",
          type: "WagerTransactionRequested",
          occurredAt: new Date().toISOString(),
          data: {
            providerId: "provider-ob",
            externalTransactionId: "ext-ob-1",
            playerId,
            walletId: wallet.id,
            roundId: "round-ob",
            gameId: "slot-ob",
            kind: WagerTransactionKind.Bet,
            money: { amount: "50.00", currency: "BRL" },
          },
        }),
        MessageGroupId: wallet.id,
        MessageDeduplicationId: `dedup-${randomUUID()}`,
      }),
    );

    await sqsConsumer.pollOnce(10, 0);

    const unpublishedBefore = await outboxRepository.countUnpublished();
    expect(unpublishedBefore).toBe(3);

    const claimedByCrashedWorker = await outboxPublisher.claimOnlyWithoutPublishing(
      "crashed-worker-1",
      20,
      10,
    );
    expect(claimedByCrashedWorker).toHaveLength(3);

    await new Promise((resolve) => setTimeout(resolve, 35));

    const [pubA, pubB, pubC] = await Promise.all([
      outboxPublisher.publishDueBatch("worker-a", 2),
      outboxPublisher.publishDueBatch("worker-b", 2),
      outboxPublisher.publishDueBatch("worker-c", 2),
    ]);

    expect(pubA.published + pubB.published + pubC.published).toBe(3);
    expect(await outboxRepository.countUnpublished()).toBe(0);

    const publishedEvents = await drainQueue(urls.eventsQueueUrl);
    expect(publishedEvents).toHaveLength(3);
    const eventTypes = publishedEvents.map(
      (raw) => (JSON.parse(raw) as { readonly eventType: string }).eventType,
    );
    expect(eventTypes).toContain("WalletBalanceChanged");
    expect(eventTypes).toContain("WagerTransactionProcessed");

    await assertAllWalletsMatchLedger(em, reconcileUseCase);
  });

  it("Phase 8: PendingReferenceWorker resolves out-of-order ROLLBACK once BET arrives and rejects orphan REFUND after maxAttempts", async () => {
    const playerId = randomUUID();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: urls.wagerQueueUrl,
        MessageBody: JSON.stringify({
          messageId: "msg-rb-before-bet",
          type: "WagerTransactionRequested",
          occurredAt: new Date().toISOString(),
          data: {
            providerId: "provider-ooo",
            externalTransactionId: "ext-rb-early",
            playerId,
            walletId: wallet.id,
            roundId: "round-ooo-sqs",
            gameId: "slot-ooo",
            kind: WagerTransactionKind.Rollback,
            money: { amount: "40.00", currency: "BRL" },
            referenceExternalTransactionId: "ext-bet-delayed",
          },
        }),
        MessageGroupId: wallet.id,
        MessageDeduplicationId: `dedup-${randomUUID()}`,
      }),
    );

    await sqsConsumer.pollOnce(10, 0);

    const pendingRb = await getTxUseCase.executeByExternalId({
      providerId: "provider-ooo",
      externalTransactionId: "ext-rb-early",
    });
    expect(pendingRb.status).toBe(WagerTransactionStatus.PendingReference);

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: urls.wagerQueueUrl,
        MessageBody: JSON.stringify({
          messageId: "msg-bet-delayed",
          type: "WagerTransactionRequested",
          occurredAt: new Date().toISOString(),
          data: {
            providerId: "provider-ooo",
            externalTransactionId: "ext-bet-delayed",
            playerId,
            walletId: wallet.id,
            roundId: "round-ooo-sqs",
            gameId: "slot-ooo",
            kind: WagerTransactionKind.Bet,
            money: { amount: "40.00", currency: "BRL" },
          },
        }),
        MessageGroupId: wallet.id,
        MessageDeduplicationId: `dedup-${randomUUID()}`,
      }),
    );

    await sqsConsumer.pollOnce(10, 0);

    const walletAfterBet = await getWalletUseCase.execute({ walletId: wallet.id });
    expect(walletAfterBet.balance.amount).toBe("60.00");

    await em.execute(
      "UPDATE wager_transactions SET next_reference_attempt_at = now() - interval '1 second' WHERE id = ?",
      [pendingRb.id],
    );

    const resolvedCount = await pendingRefWorker.runOnce(10, 5);
    expect(resolvedCount).toBe(1);

    const resolvedRb = await getTxUseCase.execute({ transactionId: pendingRb.id });
    expect(resolvedRb.status).toBe(WagerTransactionStatus.Processed);

    const walletAfterRb = await getWalletUseCase.execute({ walletId: wallet.id });
    expect(walletAfterRb.balance.amount).toBe("100.00");

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: urls.wagerQueueUrl,
        MessageBody: JSON.stringify({
          messageId: "msg-orphan-refund",
          type: "WagerTransactionRequested",
          occurredAt: new Date().toISOString(),
          data: {
            providerId: "provider-ooo",
            externalTransactionId: "ext-orphan-refund",
            playerId,
            walletId: wallet.id,
            roundId: "round-ooo-sqs",
            gameId: "slot-ooo",
            kind: WagerTransactionKind.Refund,
            money: { amount: "15.00", currency: "BRL" },
            referenceExternalTransactionId: "ext-missing-forever",
          },
        }),
        MessageGroupId: wallet.id,
        MessageDeduplicationId: `dedup-${randomUUID()}`,
      }),
    );

    await sqsConsumer.pollOnce(10, 0);
    const orphanTx = await getTxUseCase.executeByExternalId({
      providerId: "provider-ooo",
      externalTransactionId: "ext-orphan-refund",
    });
    expect(orphanTx.status).toBe(WagerTransactionStatus.PendingReference);

    await em.execute(
      "UPDATE wager_transactions SET next_reference_attempt_at = now() - interval '1 second' WHERE id = ?",
      [orphanTx.id],
    );

    await pendingRefWorker.runOnce(10, 1);

    const expiredOrphan = await getTxUseCase.execute({ transactionId: orphanTx.id });
    expect(expiredOrphan.status).toBe(WagerTransactionStatus.Rejected);
    expect(expiredOrphan.failureCode).toBe(FailureCode.ReferenceNotFoundTimeout);

    await assertAllWalletsMatchLedger(em, reconcileUseCase);
  });
});
