import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { OutboxRepositoryPort } from "@application/ports/outbox-repository.port";
import { TOKENS } from "@application/ports/tokens";
import { OpenWalletUseCase, ReconcileWalletUseCase } from "@application/use-cases";
import { WagerTransactionKind } from "@domain/wagering/wager-transaction";
import { parseEnv } from "@infrastructure/config/env";
import { OutboxPublisherWorker } from "@infrastructure/messaging/outbox-publisher.worker";
import { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "@src/app.module";

function percentile(sortedValues: readonly number[], p: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1),
  );
  return sortedValues[index] ?? 0;
}

async function runLoadTest(): Promise<void> {
  const env = parseEnv({
    ...process.env,
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    APP_ROLE: "all",
    DB_POOL_MAX: "30",
  });

  const app = await NestFactory.create(AppModule.register(env), { logger: false });
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const orm = app.get<MikroORM>(TOKENS.MIKRO_ORM);
  const em = app.get<EntityManager>(TOKENS.ENTITY_MANAGER);
  const openWalletUseCase = app.get(OpenWalletUseCase);
  const reconcileUseCase = app.get(ReconcileWalletUseCase);
  const outboxPublisher = app.get(OutboxPublisherWorker);
  const outboxRepository = app.get<OutboxRepositoryPort>(TOKENS.OUTBOX_REPOSITORY);

  await orm.getMigrator().up();
  await em.execute(
    "TRUNCATE TABLE outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets CASCADE",
  );

  const distributedWalletCount = 20;
  const totalRequests = 300;
  const concurrency = 25;

  const wallets = await Promise.all(
    Array.from({ length: distributedWalletCount }, () =>
      openWalletUseCase.execute({
        playerId: randomUUID(),
        initialBalance: { amount: "500.00", currency: "BRL" },
      }),
    ),
  );
  const firstWallet = wallets[0];
  if (!firstWallet) {
    throw new Error("Load test requires at least one wallet");
  }
  const hotWallet = firstWallet;

  const latenciesMs: number[] = [];
  const statusCounts: Record<"processed201" | "replay200" | "rejected422" | "errors5xx", number> = {
    processed201: 0,
    replay200: 0,
    rejected422: 0,
    errors5xx: 0,
  };
  const statusBucketByCode: Record<number, "processed201" | "replay200" | "rejected422"> = {
    201: "processed201",
    200: "replay200",
    422: "rejected422",
  };

  const startWallMs = performance.now();

  for (let batchStart = 0; batchStart < totalRequests; batchStart += concurrency) {
    const batchSize = Math.min(concurrency, totalRequests - batchStart);
    await Promise.all(
      Array.from({ length: batchSize }, async (_, offset) => {
        const reqIndex = batchStart + offset;
        const isReplay = reqIndex % 10 === 9 && reqIndex >= 9;
        const isHotWallet = !isReplay && reqIndex % 5 === 0;
        const effectiveIndex = isReplay ? reqIndex - 9 : reqIndex;
        const targetWallet = isHotWallet
          ? hotWallet
          : (wallets[effectiveIndex % wallets.length] ?? hotWallet);

        const kind = effectiveIndex % 4 === 0 ? WagerTransactionKind.Win : WagerTransactionKind.Bet;
        const externalTxId = `load-tx-${effectiveIndex}`;
        const idempotencyKey = `prov-load:${externalTxId}`;

        const t0 = performance.now();
        const res = await fetch(`${baseUrl}/wagering/transactions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            providerId: "prov-load",
            externalTransactionId: externalTxId,
            playerId: targetWallet.playerId,
            walletId: targetWallet.id,
            roundId: `round-load-${effectiveIndex}`,
            gameId: "fortune-chimp",
            kind,
            money: { amount: "15.00", currency: "BRL" },
          }),
        });
        const elapsedMs = performance.now() - t0;
        latenciesMs.push(elapsedMs);

        const bucket =
          statusBucketByCode[res.status] ?? (res.status >= 500 ? "errors5xx" : undefined);
        if (bucket) {
          statusCounts[bucket] += 1;
        }
      }),
    );
  }

  const totalDurationSec = (performance.now() - startWallMs) / 1000;
  const throughputRps = totalRequests / totalDurationSec;
  const sortedLatencies = [...latenciesMs].sort((a, b) => a - b);

  const outboxLagBeforeDrain = await outboxRepository.countUnpublished();
  const drainStartMs = performance.now();
  while ((await outboxRepository.countUnpublished()) > 0) {
    await outboxPublisher.publishDueBatch("load-test-publisher", 100);
  }
  const outboxDrainDurationMs = performance.now() - drainStartMs;

  let consistentWallets = 0;
  for (const w of wallets) {
    const report = await reconcileUseCase.execute({ walletId: w.id });
    if (report.consistent) {
      consistentWallets += 1;
    }
  }

  const summary = {
    totalRequests,
    concurrency,
    distributedWalletCount,
    durationSeconds: Number(totalDurationSec.toFixed(3)),
    throughputRps: Number(throughputRps.toFixed(2)),
    latencyMs: {
      p50: Number(percentile(sortedLatencies, 50).toFixed(2)),
      p95: Number(percentile(sortedLatencies, 95).toFixed(2)),
      p99: Number(percentile(sortedLatencies, 99).toFixed(2)),
      max: Number(percentile(sortedLatencies, 100).toFixed(2)),
    },
    outcomes: statusCounts,
    outbox: {
      lagBeforeDrain: outboxLagBeforeDrain,
      drainDurationMs: Number(outboxDrainDurationMs.toFixed(2)),
      lagAfterDrain: await outboxRepository.countUnpublished(),
    },
    reconciliation: {
      totalWallets: wallets.length,
      consistentWallets,
    },
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  await app.close();

  if (consistentWallets !== wallets.length || statusCounts.errors5xx > 0) {
    process.exit(1);
  }
}

void runLoadTest();
