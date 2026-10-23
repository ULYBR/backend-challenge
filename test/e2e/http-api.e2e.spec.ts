import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { AddressInfo } from "node:net";
import { TOKENS } from "@application/ports/tokens";
import { ReconcileWalletUseCase } from "@application/use-cases/reconcile-wallet.use-case";
import { FailureCode } from "@domain/shared/failure-code";
import { WagerTransactionKind, WagerTransactionStatus } from "@domain/wagering/wager-transaction";
import { parseEnv } from "@infrastructure/config/env";
import { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "@src/app.module";
import { buildOpenWalletInput, buildProcessWagerInput } from "@test/fixtures";
import { assertAllWalletsMatchLedger } from "@test/helpers/assert-wallet-ledger-invariant";

describe("Phase 5 E2E HTTP API — Wallets, Wagering, Ledger Cursor & Error Mapping (RFC-0005 / ADR-0013 / ADR-0015)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let orm: MikroORM;
  let em: EntityManager;
  let reconcileUseCase: ReconcileWalletUseCase;

  beforeAll(async () => {
    const env = parseEnv({
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      APP_ROLE: "api",
    });

    app = await NestFactory.create(AppModule.register(env), { logger: false });
    await app.listen(0, "127.0.0.1");

    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    orm = app.get<MikroORM>(TOKENS.MIKRO_ORM);
    em = app.get<EntityManager>(TOKENS.ENTITY_MANAGER);
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

  it("POST /wallets creates a wallet (201) and rejects duplicate player+currency with 409 WALLET_ALREADY_EXISTS", async () => {
    const walletFixture = buildOpenWalletInput({
      initialBalance: { amount: "1000.00", currency: "BRL" },
    });
    const createRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": "corr-wallet-1",
      },
      body: JSON.stringify(walletFixture),
    });

    expect(createRes.status).toBe(201);
    expect(createRes.headers.get("x-correlation-id")).toBe("corr-wallet-1");

    const createdWallet = (await createRes.json()) as {
      readonly id: string;
      readonly playerId: string;
      readonly balance: { readonly amount: string; readonly currency: string };
      readonly version: number;
    };
    expect(createdWallet.playerId).toBe(walletFixture.playerId);
    expect(createdWallet.balance).toEqual({ amount: "1000.00", currency: "BRL" });
    expect(createdWallet.version).toBe(1);

    const dupRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(walletFixture),
    });
    expect(dupRes.status).toBe(409);
    const dupBody = (await dupRes.json()) as {
      readonly error: { readonly failureCode: string };
    };
    expect(dupBody.error.failureCode).toBe(FailureCode.WalletAlreadyExists);

    await assertAllWalletsMatchLedger(em, reconcileUseCase);
  });

  it("POST /wagering/transactions maps 201 (PROCESSED), 200 (replay), 409 (payload conflict), 422 (business rejection), 202 (PENDING_REFERENCE), and 400 (validation)", async () => {
    const walletFixture = buildOpenWalletInput({
      initialBalance: { amount: "100.00", currency: "BRL" },
    });
    const walletRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(walletFixture),
    });
    const wallet = (await walletRes.json()) as { readonly id: string };

    const missingKeyRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildProcessWagerInput({
          playerId: walletFixture.playerId,
          walletId: wallet.id,
          kind: WagerTransactionKind.Bet,
          money: { amount: "25.00", currency: "BRL" },
        }),
      ),
    });
    expect(missingKeyRes.status).toBe(400);

    const openingForbiddenRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "provider-a:tx-opening",
      },
      body: JSON.stringify(
        buildProcessWagerInput({
          providerId: "provider-a",
          externalTransactionId: "tx-opening",
          idempotencyKey: "provider-a:tx-opening",
          playerId: walletFixture.playerId,
          walletId: wallet.id,
          kind: WagerTransactionKind.Opening,
          money: { amount: "25.00", currency: "BRL" },
        }),
      ),
    });
    expect(openingForbiddenRes.status).toBe(400);
    const openingBody = (await openingForbiddenRes.json()) as {
      readonly error: { readonly failureCode: string };
    };
    expect(openingBody.error.failureCode).toBe(FailureCode.OpeningKindForbiddenExternally);

    const betPayload = buildProcessWagerInput({
      providerId: "provider-a",
      externalTransactionId: "tx-123",
      idempotencyKey: "provider-a:tx-123",
      playerId: walletFixture.playerId,
      walletId: wallet.id,
      roundId: "round-987",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25.00", currency: "BRL" },
    });

    const betRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "provider-a:tx-123",
      },
      body: JSON.stringify(betPayload),
    });
    expect(betRes.status).toBe(201);
    const betBody = (await betRes.json()) as {
      readonly transactionId: string;
      readonly status: string;
      readonly balance: { readonly amount: string; readonly currency: string };
      readonly idempotentReplay: boolean;
    };
    expect(betBody.status).toBe(WagerTransactionStatus.Processed);
    expect(betBody.balance).toEqual({ amount: "75.00", currency: "BRL" });
    expect(betBody.idempotentReplay).toBe(false);

    const replayRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "provider-a:tx-123",
      },
      body: JSON.stringify(betPayload),
    });
    expect(replayRes.status).toBe(200);
    const replayBody = (await replayRes.json()) as {
      readonly transactionId: string;
      readonly status: string;
      readonly idempotentReplay: boolean;
    };
    expect(replayBody.transactionId).toBe(betBody.transactionId);
    expect(replayBody.idempotentReplay).toBe(true);

    const conflictRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "provider-a:tx-123",
      },
      body: JSON.stringify({
        ...betPayload,
        money: { amount: "30.00", currency: "BRL" },
      }),
    });
    expect(conflictRes.status).toBe(409);
    const conflictBody = (await conflictRes.json()) as {
      readonly error: { readonly failureCode: string };
    };
    expect(conflictBody.error.failureCode).toBe(FailureCode.IdempotencyPayloadConflict);

    const insufficientRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "provider-a:tx-too-high",
      },
      body: JSON.stringify({
        ...betPayload,
        externalTransactionId: "tx-too-high",
        money: { amount: "200.00", currency: "BRL" },
      }),
    });
    expect(insufficientRes.status).toBe(422);
    const insufficientBody = (await insufficientRes.json()) as {
      readonly status: string;
      readonly failureCode: string;
      readonly balance: { readonly amount: string };
    };
    expect(insufficientBody.status).toBe(WagerTransactionStatus.Rejected);
    expect(insufficientBody.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(insufficientBody.balance.amount).toBe("75.00");

    const pendingRefRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "provider-a:tx-refund-early",
      },
      body: JSON.stringify({
        ...betPayload,
        externalTransactionId: "tx-refund-early",
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "tx-bet-not-yet-sent",
      }),
    });
    expect(pendingRefRes.status).toBe(202);
    const pendingRefBody = (await pendingRefRes.json()) as {
      readonly status: string;
    };
    expect(pendingRefBody.status).toBe(WagerTransactionStatus.PendingReference);

    await assertAllWalletsMatchLedger(em, reconcileUseCase);
  });

  it("supports GET wallet, GET ledger with cursor pagination, GET transactions by internal & external ID, and POST reconciliation", async () => {
    const walletFixture = buildOpenWalletInput({
      initialBalance: { amount: "100.00", currency: "BRL" },
    });
    const walletRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(walletFixture),
    });
    const wallet = (await walletRes.json()) as { readonly id: string };

    const betRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "provider-b:bet-1",
      },
      body: JSON.stringify(
        buildProcessWagerInput({
          providerId: "provider-b",
          externalTransactionId: "bet-1",
          idempotencyKey: "provider-b:bet-1",
          playerId: walletFixture.playerId,
          walletId: wallet.id,
          roundId: "round-q",
          gameId: "slot-q",
          kind: WagerTransactionKind.Bet,
          money: { amount: "20.00", currency: "BRL" },
        }),
      ),
    });
    const betBody = (await betRes.json()) as { readonly transactionId: string };

    await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "provider-b:win-1",
      },
      body: JSON.stringify(
        buildProcessWagerInput({
          providerId: "provider-b",
          externalTransactionId: "win-1",
          idempotencyKey: "provider-b:win-1",
          playerId: walletFixture.playerId,
          walletId: wallet.id,
          roundId: "round-q",
          gameId: "slot-q",
          kind: WagerTransactionKind.Win,
          money: { amount: "45.00", currency: "BRL" },
        }),
      ),
    });

    const getWalletRes = await fetch(`${baseUrl}/wallets/${wallet.id}`);
    expect(getWalletRes.status).toBe(200);
    const getWalletBody = (await getWalletRes.json()) as {
      readonly balance: { readonly amount: string };
      readonly version: number;
    };
    expect(getWalletBody.balance.amount).toBe("125.00");
    expect(getWalletBody.version).toBe(3);

    const ledgerPage1Res = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger?limit=2`);
    expect(ledgerPage1Res.status).toBe(200);
    const ledgerPage1 = (await ledgerPage1Res.json()) as {
      readonly items: ReadonlyArray<{ readonly walletVersion: number }>;
      readonly nextCursor: string | null;
    };
    expect(ledgerPage1.items).toHaveLength(2);
    expect(ledgerPage1.nextCursor).not.toBeNull();

    const ledgerPage2Res = await fetch(
      `${baseUrl}/wallets/${wallet.id}/ledger?limit=2&cursor=${encodeURIComponent(
        ledgerPage1.nextCursor ?? "",
      )}`,
    );
    expect(ledgerPage2Res.status).toBe(200);
    const ledgerPage2 = (await ledgerPage2Res.json()) as {
      readonly items: ReadonlyArray<{ readonly walletVersion: number }>;
      readonly nextCursor: string | null;
    };
    expect(ledgerPage2.items).toHaveLength(1);
    expect(ledgerPage2.nextCursor).toBeNull();

    const byInternalIdRes = await fetch(
      `${baseUrl}/wagering/transactions/${betBody.transactionId}`,
    );
    expect(byInternalIdRes.status).toBe(200);

    const byExternalIdRes = await fetch(
      `${baseUrl}/providers/provider-b/wagering/transactions/bet-1`,
    );
    expect(byExternalIdRes.status).toBe(200);
    const byExternalBody = (await byExternalIdRes.json()) as {
      readonly id: string;
    };
    expect(byExternalBody.id).toBe(betBody.transactionId);

    const reconcileRes = await fetch(`${baseUrl}/wallets/${wallet.id}/reconciliation`, {
      method: "POST",
    });
    expect(reconcileRes.status).toBe(200);
    const reconcileBody = (await reconcileRes.json()) as {
      readonly consistent: boolean;
      readonly storedBalance: { readonly amount: string };
      readonly calculatedBalance: { readonly amount: string };
      readonly difference: { readonly amount: string };
      readonly checkedEntries: number;
    };
    expect(reconcileBody.consistent).toBe(true);
    expect(reconcileBody.storedBalance.amount).toBe("125.00");
    expect(reconcileBody.calculatedBalance.amount).toBe("125.00");
    expect(reconcileBody.difference.amount).toBe("0.00");
    expect(reconcileBody.checkedEntries).toBe(3);

    await assertAllWalletsMatchLedger(em, reconcileUseCase);
  });
});
