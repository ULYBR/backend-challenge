import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { OutboxRepositoryPort } from "@application/ports/outbox-repository.port";
import { TOKENS } from "@application/ports/tokens";
import { CanonicalPayloadHasher } from "@application/shared/canonical-payload-hasher";
import {
  GetWalletUseCase,
  OpenWalletUseCase,
  ProcessWagerTransactionUseCase,
  ReconcileWalletUseCase,
} from "@application/use-cases";
import { ReceiveMessageCommand, type SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { WagerTransactionKind } from "@domain/wagering/wager-transaction";
import { parseEnv } from "@infrastructure/config/env";
import { OutboxPublisherWorker } from "@infrastructure/messaging/outbox-publisher.worker";
import { PendingReferenceWorker } from "@infrastructure/messaging/pending-reference.worker";
import type { SqsQueueRegistry, SqsQueueUrls } from "@infrastructure/messaging/sqs.module";
import { WagerTransactionsSqsConsumer } from "@interfaces/sqs/wager-transactions-sqs.consumer";
import { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "@src/app.module";
import { assertAllWalletsMatchLedger } from "@test/helpers/assert-wallet-ledger-invariant";
import { drainSqsQueue } from "@test/helpers/drain-sqs-queue";

interface RunningNode {
  readonly instanceId: string;
  readonly app: INestApplication;
  readonly baseUrl: string;
  readonly em: EntityManager;
  readonly openWalletUseCase: OpenWalletUseCase;
  readonly processWagerUseCase: ProcessWagerTransactionUseCase;
  readonly getWalletUseCase: GetWalletUseCase;
  readonly reconcileUseCase: ReconcileWalletUseCase;
  readonly sqsConsumer: WagerTransactionsSqsConsumer;
  readonly outboxPublisher: OutboxPublisherWorker;
  readonly pendingRefWorker: PendingReferenceWorker;
}

describe("Phase 11 Mandatory 8 Concurrency Scenarios — Multi-Instance (≥3 Nodes) on Real PostgreSQL & SQS (Section 13 / RFC-0009)", () => {
  let nodes: RunningNode[] = [];
  let primaryOrm: MikroORM;
  let primaryEm: EntityManager;
  let sqsClient: SQSClient;
  let queueUrls: SqsQueueUrls;
  let outboxRepository: OutboxRepositoryPort;

  function nodeAt(index: number): RunningNode {
    const candidate = nodes[index % nodes.length];
    if (!candidate) {
      throw new Error(`RunningNode at index ${index} is not initialized`);
    }
    return candidate;
  }

  async function spawnNode(instanceId: string): Promise<RunningNode> {
    const env = parseEnv({
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      APP_ROLE: "all",
      INSTANCE_ID: instanceId,
      DB_POOL_MAX: "15",
      SQS_WAGER_QUEUE_NAME: "wager-tx-phase11.fifo",
      SQS_WAGER_DLQ_NAME: "wager-dlq-phase11.fifo",
      SQS_EVENTS_QUEUE_NAME: "wallet-events-phase11.fifo",
    });

    const app = await NestFactory.create(AppModule.register(env), { logger: false });
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo;

    return {
      instanceId,
      app,
      baseUrl: `http://127.0.0.1:${address.port}`,
      em: app.get<EntityManager>(TOKENS.ENTITY_MANAGER),
      openWalletUseCase: app.get(OpenWalletUseCase),
      processWagerUseCase: app.get(ProcessWagerTransactionUseCase),
      getWalletUseCase: app.get(GetWalletUseCase),
      reconcileUseCase: app.get(ReconcileWalletUseCase),
      sqsConsumer: app.get(WagerTransactionsSqsConsumer),
      outboxPublisher: app.get(OutboxPublisherWorker),
      pendingRefWorker: app.get(PendingReferenceWorker),
    };
  }

  beforeAll(async () => {
    const [node1, node2, node3] = await Promise.all([
      spawnNode("instance-1"),
      spawnNode("instance-2"),
      spawnNode("instance-3"),
    ]);
    nodes = [node1, node2, node3];

    primaryOrm = node1.app.get<MikroORM>(TOKENS.MIKRO_ORM);
    primaryEm = node1.em;
    sqsClient = node1.app.get<SQSClient>(TOKENS.SQS_CLIENT);
    outboxRepository = node1.app.get<OutboxRepositoryPort>(TOKENS.OUTBOX_REPOSITORY);

    const queueRegistry = node1.app.get<SqsQueueRegistry>(TOKENS.SQS_QUEUE_REGISTRY);
    await primaryOrm.getMigrator().up();
    queueUrls = await queueRegistry.ensureQueues();
  });

  beforeEach(async () => {
    await primaryEm.execute(
      "TRUNCATE TABLE outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets CASCADE",
    );
    await Promise.all([
      drainSqsQueue(sqsClient, queueUrls.wagerQueueUrl),
      drainSqsQueue(sqsClient, queueUrls.wagerDlqUrl),
      drainSqsQueue(sqsClient, queueUrls.eventsQueueUrl),
    ]);
  });

  afterAll(async () => {
    await Promise.all(nodes.map((node) => node.app.close()));
  });

  it("Scenarios 1 & 4: Same bet sent 50 times in parallel distributed across 3 simultaneous instances -> 1 single debit", async () => {
    const node0 = nodeAt(0);
    const playerId = randomUUID();
    const wallet = await node0.openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "1000.00", currency: "BRL" },
    });

    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, idx) => {
        const targetNode = nodeAt(idx);
        return fetch(`${targetNode.baseUrl}/wagering/transactions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "prov-multi:ext-50x-http",
          },
          body: JSON.stringify({
            providerId: "prov-multi",
            externalTransactionId: "ext-50x-http",
            playerId,
            walletId: wallet.id,
            roundId: "round-50x-multi",
            gameId: "slot-multi",
            kind: WagerTransactionKind.Bet,
            money: { amount: "25.00", currency: "BRL" },
          }),
        });
      }),
    );

    const bodies = await Promise.all(
      responses.map(
        (res) =>
          res.json() as Promise<{
            readonly transactionId: string;
            readonly status: string;
            readonly idempotentReplay: boolean;
          }>,
      ),
    );

    const statusCodes = responses.map((r) => r.status);
    expect(statusCodes.filter((s) => s === 201)).toHaveLength(1);
    expect(statusCodes.filter((s) => s === 200)).toHaveLength(49);

    const uniqueTxIds = new Set(bodies.map((b) => b.transactionId));
    expect(uniqueTxIds.size).toBe(1);

    const updatedWallet = await node0.getWalletUseCase.execute({
      walletId: wallet.id,
    });
    expect(updatedWallet.balance.amount).toBe("975.00");
    expect(updatedWallet.version).toBe(2);

    await assertAllWalletsMatchLedger(primaryEm, node0.reconcileUseCase);
  });

  it("Scenario 2: Concurrent operations competing for balance on the same hot wallet across 3 instances (100/80/80 + 20 parallel bets)", async () => {
    const node0 = nodeAt(0);
    const player1 = randomUUID();
    const wallet100 = await node0.openWalletUseCase.execute({
      playerId: player1,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const [bet80A, bet80B] = await Promise.all([
      fetch(`${nodeAt(0).baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "prov-hot:bet-80-a",
        },
        body: JSON.stringify({
          providerId: "prov-hot",
          externalTransactionId: "bet-80-a",
          playerId: player1,
          walletId: wallet100.id,
          roundId: "round-80",
          gameId: "slot-hot",
          kind: WagerTransactionKind.Bet,
          money: { amount: "80.00", currency: "BRL" },
        }),
      }),
      fetch(`${nodeAt(1).baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "prov-hot:bet-80-b",
        },
        body: JSON.stringify({
          providerId: "prov-hot",
          externalTransactionId: "bet-80-b",
          playerId: player1,
          walletId: wallet100.id,
          roundId: "round-80",
          gameId: "slot-hot",
          kind: WagerTransactionKind.Bet,
          money: { amount: "80.00", currency: "BRL" },
        }),
      }),
    ]);

    expect([bet80A.status, bet80B.status].sort()).toEqual([201, 422]);

    const player2 = randomUUID();
    const hotWallet = await node0.openWalletUseCase.execute({
      playerId: player2,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const burstResponses = await Promise.all(
      Array.from({ length: 20 }, (_, idx) => {
        const targetNode = nodeAt(idx);
        return fetch(`${targetNode.baseUrl}/wagering/transactions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": `prov-hot:burst-${idx}`,
          },
          body: JSON.stringify({
            providerId: "prov-hot",
            externalTransactionId: `burst-${idx}`,
            playerId: player2,
            walletId: hotWallet.id,
            roundId: `round-burst-${idx}`,
            gameId: "slot-hot",
            kind: WagerTransactionKind.Bet,
            money: { amount: "10.00", currency: "BRL" },
          }),
        });
      }),
    );

    const processedCount = burstResponses.filter((r) => r.status === 201).length;
    const rejectedCount = burstResponses.filter((r) => r.status === 422).length;
    expect(processedCount).toBe(10);
    expect(rejectedCount).toBe(10);

    const finalHotWallet = await node0.getWalletUseCase.execute({
      walletId: hotWallet.id,
    });
    expect(finalHotWallet.balance.amount).toBe("0.00");
    expect(finalHotWallet.version).toBe(11);

    await assertAllWalletsMatchLedger(primaryEm, node0.reconcileUseCase);
  });

  it("Scenario 3: 15 distinct wallets processed in parallel across 3 instances without global lock contention", async () => {
    const node0 = nodeAt(0);
    const wallets = await Promise.all(
      Array.from({ length: 15 }, (_, idx) =>
        nodeAt(idx).openWalletUseCase.execute({
          playerId: randomUUID(),
          initialBalance: { amount: "200.00", currency: "BRL" },
        }),
      ),
    );

    await Promise.all(
      wallets.flatMap((wallet, wIdx) => [
        fetch(`${nodeAt(wIdx).baseUrl}/wagering/transactions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": `prov-par:bet-${wIdx}`,
          },
          body: JSON.stringify({
            providerId: "prov-par",
            externalTransactionId: `bet-${wIdx}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: `round-w-${wIdx}`,
            gameId: "slot-par",
            kind: WagerTransactionKind.Bet,
            money: { amount: "50.00", currency: "BRL" },
          }),
        }),
        fetch(`${nodeAt(wIdx + 1).baseUrl}/wagering/transactions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": `prov-par:win-${wIdx}`,
          },
          body: JSON.stringify({
            providerId: "prov-par",
            externalTransactionId: `win-${wIdx}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: `round-w-${wIdx}`,
            gameId: "slot-par",
            kind: WagerTransactionKind.Win,
            money: { amount: "80.00", currency: "BRL" },
          }),
        }),
      ]),
    );

    for (const wallet of wallets) {
      const updated = await node0.getWalletUseCase.execute({ walletId: wallet.id });
      expect(updated.balance.amount).toBe("230.00");
      expect(updated.version).toBe(3);
    }

    await assertAllWalletsMatchLedger(primaryEm, node0.reconcileUseCase);
  });

  it("Scenarios 5, 6 & 7: Worker crash after commit before SQS ack, multi-publisher Outbox race, and out-of-order ROLLBACK/REFUND across 3 instances", async () => {
    const node0 = nodeAt(0);
    const node1 = nodeAt(1);
    const node2 = nodeAt(2);

    const playerId = randomUUID();
    const wallet = await node0.openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "300.00", currency: "BRL" },
    });

    const crashedMessageEnvelope = {
      messageId: "msg-crash-after-commit-1",
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        providerId: "prov-crash",
        externalTransactionId: "ext-crash-bet-1",
        idempotencyKey: "prov-crash:ext-crash-bet-1",
        playerId,
        walletId: wallet.id,
        roundId: "round-crash",
        gameId: "slot-crash",
        kind: WagerTransactionKind.Bet,
        money: { amount: "60.00", currency: "BRL" },
      },
    };
    const rawBody = JSON.stringify(crashedMessageEnvelope);

    await node0.processWagerUseCase.execute({
      providerId: crashedMessageEnvelope.data.providerId,
      externalTransactionId: crashedMessageEnvelope.data.externalTransactionId,
      idempotencyKey: crashedMessageEnvelope.data.idempotencyKey,
      walletId: wallet.id,
      playerId,
      roundId: crashedMessageEnvelope.data.roundId,
      gameId: crashedMessageEnvelope.data.gameId,
      kind: WagerTransactionKind.Bet,
      money: crashedMessageEnvelope.data.money,
      inboxRegistration: {
        consumerName: "wager-transactions-consumer",
        messageId: crashedMessageEnvelope.messageId,
        payloadHash: CanonicalPayloadHasher.computeRaw(rawBody),
      },
    });

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrls.wagerQueueUrl,
        MessageBody: rawBody,
        MessageGroupId: wallet.id,
        MessageDeduplicationId: `dedup-${randomUUID()}`,
      }),
    );

    const pollOnNode1 = await node1.sqsConsumer.pollOnce(10, 0);
    expect(pollOnNode1.acknowledged).toBe(1);

    const walletAfterRedelivery = await node2.getWalletUseCase.execute({
      walletId: wallet.id,
    });
    expect(walletAfterRedelivery.balance.amount).toBe("240.00");
    expect(walletAfterRedelivery.version).toBe(2);

    const earlyRollbackRes = await fetch(`${node1.baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "prov-crash:ext-early-rb",
      },
      body: JSON.stringify({
        providerId: "prov-crash",
        externalTransactionId: "ext-early-rb",
        playerId,
        walletId: wallet.id,
        roundId: "round-ooo-multi",
        gameId: "slot-crash",
        kind: WagerTransactionKind.Rollback,
        money: { amount: "40.00", currency: "BRL" },
        referenceExternalTransactionId: "ext-delayed-bet",
      }),
    });
    expect(earlyRollbackRes.status).toBe(202);
    const earlyRollbackBody = (await earlyRollbackRes.json()) as {
      readonly transactionId: string;
    };

    const delayedBetRes = await fetch(`${node2.baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "prov-crash:ext-delayed-bet",
      },
      body: JSON.stringify({
        providerId: "prov-crash",
        externalTransactionId: "ext-delayed-bet",
        playerId,
        walletId: wallet.id,
        roundId: "round-ooo-multi",
        gameId: "slot-crash",
        kind: WagerTransactionKind.Bet,
        money: { amount: "40.00", currency: "BRL" },
      }),
    });
    expect(delayedBetRes.status).toBe(201);

    await primaryEm.execute(
      "UPDATE wager_transactions SET next_reference_attempt_at = now() - interval '1 second' WHERE id = ?",
      [earlyRollbackBody.transactionId],
    );

    const resolvedCounts = await Promise.all([
      node0.pendingRefWorker.runOnce(10, 5),
      node1.pendingRefWorker.runOnce(10, 5),
      node2.pendingRefWorker.runOnce(10, 5),
    ]);
    expect(resolvedCounts.reduce((a, b) => a + b, 0)).toBe(1);

    const pubResults = await Promise.all([
      node0.outboxPublisher.publishDueBatch("node-0-pub", 5),
      node1.outboxPublisher.publishDueBatch("node-1-pub", 5),
      node2.outboxPublisher.publishDueBatch("node-2-pub", 5),
    ]);
    expect(pubResults.reduce((acc, r) => acc + r.published, 0)).toBeGreaterThanOrEqual(7);
    expect(await outboxRepository.countUnpublished()).toBe(0);

    const finalWallet = await node0.getWalletUseCase.execute({ walletId: wallet.id });
    expect(finalWallet.balance.amount).toBe("240.00");

    await assertAllWalletsMatchLedger(primaryEm, node0.reconcileUseCase);
  });

  it("Scenario 8: Service restart under pending work with proof of final ledger/balance consistency", async () => {
    const node0 = nodeAt(0);
    const playerId = randomUUID();
    const wallet = await node0.openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "500.00", currency: "BRL" },
    });

    await fetch(`${node0.baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "prov-restart:bet-1",
      },
      body: JSON.stringify({
        providerId: "prov-restart",
        externalTransactionId: "bet-1",
        playerId,
        walletId: wallet.id,
        roundId: "round-restart",
        gameId: "slot-restart",
        kind: WagerTransactionKind.Bet,
        money: { amount: "120.00", currency: "BRL" },
      }),
    });

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrls.wagerQueueUrl,
        MessageBody: JSON.stringify({
          messageId: "msg-queued-before-restart",
          type: "WagerTransactionRequested",
          occurredAt: new Date().toISOString(),
          data: {
            providerId: "prov-restart",
            externalTransactionId: "win-after-restart",
            playerId,
            walletId: wallet.id,
            roundId: "round-restart",
            gameId: "slot-restart",
            kind: WagerTransactionKind.Win,
            money: { amount: "70.00", currency: "BRL" },
          },
        }),
        MessageGroupId: wallet.id,
        MessageDeduplicationId: `dedup-${randomUUID()}`,
      }),
    );

    const recoveryNode = await spawnNode("instance-recovery-after-restart");
    try {
      const pollSummary = await recoveryNode.sqsConsumer.pollOnce(10, 0);
      expect(pollSummary.acknowledged).toBe(1);

      await recoveryNode.outboxPublisher.publishDueBatch("recovery-pub", 50);
      expect(await outboxRepository.countUnpublished()).toBe(0);

      const recoveredWallet = await recoveryNode.getWalletUseCase.execute({
        walletId: wallet.id,
      });
      expect(recoveredWallet.balance.amount).toBe("450.00");
      expect(recoveredWallet.version).toBe(3);

      const eventsBatch = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrls.eventsQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 0,
        }),
      );
      expect((eventsBatch.Messages ?? []).length).toBeGreaterThanOrEqual(1);

      await assertAllWalletsMatchLedger(recoveryNode.em, recoveryNode.reconcileUseCase);
    } finally {
      await recoveryNode.app.close();
    }
  });
});
