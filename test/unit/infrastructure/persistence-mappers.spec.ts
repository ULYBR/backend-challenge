import { describe, expect, it } from "bun:test";
import { WalletBalanceChanged } from "@domain/messaging/integration-event";
import { OutboxMessage } from "@domain/messaging/outbox-message";
import { Money } from "@domain/shared/money";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "@domain/wagering/wager-transaction";
import { LedgerDirection } from "@domain/wallet/ledger-direction";
import { Wallet } from "@domain/wallet/wallet";
import { WalletLedgerEntry } from "@domain/wallet/wallet-ledger-entry";
import { OutboxMessageMapper } from "@infrastructure/persistence/mappers/outbox-message.mapper";
import { WagerTransactionMapper } from "@infrastructure/persistence/mappers/wager-transaction.mapper";
import { WalletLedgerEntryMapper } from "@infrastructure/persistence/mappers/wallet-ledger-entry.mapper";
import { WalletMapper } from "@infrastructure/persistence/mappers/wallet.mapper";

describe("Persistence Mappers (toDomain, toRecord, fromRow)", () => {
  it("maps Wallet bidirectionally between domain, entity record, and SQL row", () => {
    const opened = Wallet.open({
      playerId: "p-1",
      initialBalance: Money.from({ amount: "50.00", currency: "BRL" }),
      id: "w-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const record = WalletMapper.toRecord(opened);
    expect(record.id).toBe("w-1");
    expect(record.playerId).toBe("p-1");
    expect(record.currency).toBe("BRL");
    expect(record.balance).toBe("50.00");
    expect(record.version).toBe(1);

    const fromRecord = WalletMapper.toDomain(record);
    expect(fromRecord.id).toBe(opened.id);
    expect(fromRecord.balance.amount).toBe("50.00");
    expect(fromRecord.version).toBe(1);

    const fromSql = WalletMapper.fromRow({
      id: "w-sql",
      player_id: "p-sql",
      currency: "USD  ",
      balance: "123.45",
      version: 5,
      created_at: new Date("2026-01-02T00:00:00.000Z"),
      updated_at: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(fromSql.id).toBe("w-sql");
    expect(fromSql.currency).toBe("USD");
    expect(fromSql.balance.amount).toBe("123.45");
    expect(fromSql.version).toBe(5);
  });

  it("maps WalletLedgerEntry bidirectionally between domain, entity record, and SQL row", () => {
    const entry = WalletLedgerEntry.create({
      id: "le-1",
      walletId: "w-1",
      transactionId: "tx-1",
      walletVersion: 2,
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: "25.00", currency: "EUR" }),
      balanceBefore: Money.from({ amount: "10.00", currency: "EUR" }),
      balanceAfter: Money.from({ amount: "35.00", currency: "EUR" }),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const record = WalletLedgerEntryMapper.toRecord(entry);
    expect(record.id).toBe("le-1");
    expect(record.amount).toBe("25.00");
    expect(record.direction).toBe(LedgerDirection.Credit);

    const fromRecord = WalletLedgerEntryMapper.toDomain(record);
    expect(fromRecord.id).toBe(entry.id);
    expect(fromRecord.money.amount).toBe("25.00");
    expect(fromRecord.direction).toBe(LedgerDirection.Credit);

    const fromSql = WalletLedgerEntryMapper.fromRow({
      id: "le-sql",
      wallet_id: "w-sql",
      transaction_id: "tx-sql",
      wallet_version: 3,
      direction: LedgerDirection.Debit,
      amount: "15.00",
      currency: "EUR  ",
      balance_before: "35.00",
      balance_after: "20.00",
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(fromSql.id).toBe("le-sql");
    expect(fromSql.money.amount).toBe("15.00");
    expect(fromSql.direction).toBe(LedgerDirection.Debit);
  });

  it("maps WagerTransaction bidirectionally between domain, entity record, and SQL row", () => {
    const tx = WagerTransaction.create({
      id: "tx-1",
      providerId: "prov-1",
      externalTransactionId: "ext-1",
      idempotencyKey: "idemp-1",
      payloadHash: "hash-1234",
      walletId: "w-1",
      playerId: "p-1",
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "10.00", currency: "USD" }),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const record = WagerTransactionMapper.toRecord(tx);
    expect(record.id).toBe("tx-1");
    expect(record.providerId).toBe("prov-1");
    expect(record.status).toBe(WagerTransactionStatus.Pending);

    const fromRecord = WagerTransactionMapper.toDomain(record);
    expect(fromRecord.id).toBe(tx.id);
    expect(fromRecord.money.amount).toBe("10.00");
    expect(fromRecord.status).toBe(WagerTransactionStatus.Pending);

    const sqlRow = {
      id: "tx-sql",
      provider_id: "prov-sql",
      external_transaction_id: "ext-sql",
      idempotency_key: "idemp-sql",
      payload_hash: "hash-sql",
      wallet_id: "w-sql",
      player_id: "p-sql",
      round_id: "r-sql",
      game_id: "g-sql",
      kind: WagerTransactionKind.Win,
      amount: "40.00",
      currency: "USD  ",
      reference_external_transaction_id: null,
      reference_transaction_id: null,
      status: WagerTransactionStatus.Processed,
      failure_code: null,
      recorded_balance: "140.00",
      reference_attempts: 0,
      next_reference_attempt_at: null,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      processed_at: new Date("2026-01-01T00:00:01.000Z"),
      updated_at: new Date("2026-01-01T00:00:01.000Z"),
    };
    const fromSql = WagerTransactionMapper.fromRow(sqlRow);
    expect(fromSql.id).toBe("tx-sql");
    expect(fromSql.status).toBe(WagerTransactionStatus.Processed);
    expect(fromSql.recordedBalance?.amount).toBe("140.00");
  });

  it("maps OutboxMessage bidirectionally with object and string payloads", () => {
    const opened = Wallet.open({
      playerId: "p-1",
      initialBalance: Money.from({ amount: "50.00", currency: "BRL" }),
      id: "w-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const entry = WalletLedgerEntry.create({
      id: "le-1",
      walletId: "w-1",
      transactionId: "tx-open",
      walletVersion: 1,
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: "50.00", currency: "BRL" }),
      balanceBefore: Money.zero("BRL"),
      balanceAfter: Money.from({ amount: "50.00", currency: "BRL" }),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const event = WalletBalanceChanged.from(opened, entry, {
      eventId: "out-1",
      correlationId: "corr-1",
      causationId: "caus-1",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const msg = OutboxMessage.enqueue(event, "Wallet");

    const record = OutboxMessageMapper.toRecord(msg);
    expect(record.id).toBe("out-1");
    expect(record.aggregateType).toBe("Wallet");
    expect(record.attempts).toBe(0);

    const fromRecord = OutboxMessageMapper.toDomain(record);
    expect(fromRecord.id).toBe(msg.id);
    expect(fromRecord.correlationId).toBe("corr-1");

    const sqlRowWithStringPayload = {
      id: "out-sql",
      aggregate_type: "Wallet",
      aggregate_id: "w-sql",
      event_type: "WagerTransactionProcessed",
      event_version: 1,
      correlation_id: "corr-sql",
      causation_id: null,
      payload: JSON.stringify({ amount: "20.00" }),
      occurred_at: new Date("2026-01-01T00:00:00.000Z"),
      attempts: 2,
      next_attempt_at: new Date("2026-01-01T00:01:00.000Z"),
      locked_until: null,
      locked_by: null,
      published_at: null,
      last_error: null,
    };
    const fromSql = OutboxMessageMapper.fromRow(sqlRowWithStringPayload);
    expect(fromSql.id).toBe("out-sql");
    expect(fromSql.payload).toEqual({ amount: "20.00" });
    expect(fromSql.attempts).toBe(2);
  });
});
