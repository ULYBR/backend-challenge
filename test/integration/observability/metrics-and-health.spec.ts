import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { TOKENS } from "@application/ports/tokens";
import { ReconcileWalletUseCase } from "@application/use-cases/reconcile-wallet.use-case";
import { WagerTransactionKind } from "@domain/wagering/wager-transaction";
import { parseEnv } from "@infrastructure/config/env";
import { OutboxPublisherWorker } from "@infrastructure/messaging/outbox-publisher.worker";
import { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "@src/app.module";
import { assertAllWalletsMatchLedger } from "@test/helpers/assert-wallet-ledger-invariant";

describe("Phase 9 Observability — Prometheus /metrics, Outbox Lag Gauge & Health Checks (RFC-0008 / ADR-0019)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let orm: MikroORM;
  let em: EntityManager;
  let outboxPublisher: OutboxPublisherWorker;
  let reconcileUseCase: ReconcileWalletUseCase;

  beforeAll(async () => {
    const env = parseEnv({
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      APP_ROLE: "all",
    });

    app = await NestFactory.create(AppModule.register(env), { logger: false });
    await app.listen(0, "127.0.0.1");

    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    orm = app.get<MikroORM>(TOKENS.MIKRO_ORM);
    em = app.get<EntityManager>(TOKENS.ENTITY_MANAGER);
    outboxPublisher = app.get(OutboxPublisherWorker);
    reconcileUseCase = app.get(ReconcileWalletUseCase);

    await orm.getMigrator().up();
  });

  beforeEach(async () => {
    await em.execute(
      "TRUNCATE TABLE outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets CASCADE",
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("exposes all required Prometheus metrics on GET /metrics and tracks processed, rejected, replay, and outbox lag accurately", async () => {
    const playerId = randomUUID();
    const walletRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "100.00", currency: "BRL" },
      }),
    });
    const wallet = (await walletRes.json()) as { readonly id: string };

    const betPayload = {
      providerId: "prov-metrics",
      externalTransactionId: "ext-m-1",
      playerId,
      walletId: wallet.id,
      roundId: "round-m-1",
      gameId: "slot-m",
      kind: WagerTransactionKind.Bet,
      money: { amount: "40.00", currency: "BRL" },
    };

    const betRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "prov-metrics:ext-m-1",
      },
      body: JSON.stringify(betPayload),
    });
    expect(betRes.status).toBe(201);

    const replayRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "prov-metrics:ext-m-1",
      },
      body: JSON.stringify(betPayload),
    });
    expect(replayRes.status).toBe(200);

    const rejectRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "prov-metrics:ext-m-2",
      },
      body: JSON.stringify({
        ...betPayload,
        externalTransactionId: "ext-m-2",
        money: { amount: "500.00", currency: "BRL" },
      }),
    });
    expect(rejectRes.status).toBe(422);

    const metricsBeforePublishRes = await fetch(`${baseUrl}/metrics`);
    expect(metricsBeforePublishRes.status).toBe(200);
    const metricsBeforeText = await metricsBeforePublishRes.text();

    expect(metricsBeforeText).toContain("wager_transactions_total");
    expect(metricsBeforeText).toContain(
      'wager_transactions_total{kind="BET",status="PROCESSED",failure_code="NONE"}',
    );
    expect(metricsBeforeText).toContain(
      'wager_transactions_total{kind="BET",status="REJECTED",failure_code="INSUFFICIENT_FUNDS"}',
    );
    expect(metricsBeforeText).toContain('wager_idempotency_replays_total{source="http"}');
    expect(metricsBeforeText).toContain("wager_processing_duration_seconds_bucket");
    expect(metricsBeforeText).toContain("wager_outbox_unpublished_count 4");

    await outboxPublisher.publishDueBatch("metrics-worker", 20);

    const metricsAfterPublishRes = await fetch(`${baseUrl}/metrics`);
    const metricsAfterText = await metricsAfterPublishRes.text();
    expect(metricsAfterText).toContain("wager_outbox_unpublished_count 0");

    const liveRes = await fetch(`${baseUrl}/health/live`);
    expect(liveRes.status).toBe(200);

    const readyRes = await fetch(`${baseUrl}/health/ready`);
    expect(readyRes.status).toBe(200);

    await assertAllWalletsMatchLedger(em, reconcileUseCase);
  });
});
