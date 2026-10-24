import { Money } from "@domain/shared/money";
import { LedgerDirection } from "@domain/wallet/ledger-direction";
import { WalletLedgerEntry } from "@domain/wallet/wallet-ledger-entry";
import type { WalletLedgerEntrySqlRow } from "@infrastructure/persistence/persistence.types";
import { WalletLedgerEntryRecord } from "@infrastructure/persistence/schemas/wallet-ledger-entry.schema";

export type { WalletLedgerEntrySqlRow };

export class WalletLedgerEntryMapper {
  private constructor() {}

  static toDomain(record: WalletLedgerEntryRecord): WalletLedgerEntry {
    const currency = record.currency.trim();
    return WalletLedgerEntry.rehydrate({
      id: record.id,
      walletId: record.walletId,
      transactionId: record.transactionId,
      walletVersion: Number(record.walletVersion),
      direction: record.direction as LedgerDirection,
      money: Money.from({ amount: record.amount, currency }),
      balanceBefore: Money.from({ amount: record.balanceBefore, currency }),
      balanceAfter: Money.from({ amount: record.balanceAfter, currency }),
      createdAt: new Date(record.createdAt),
    });
  }

  static fromRow(row: WalletLedgerEntrySqlRow): WalletLedgerEntry {
    const currency = row.currency.trim();
    return WalletLedgerEntry.rehydrate({
      id: row.id,
      walletId: row.wallet_id,
      transactionId: row.transaction_id,
      walletVersion: Number(row.wallet_version),
      direction: row.direction as LedgerDirection,
      money: Money.from({ amount: row.amount, currency }),
      balanceBefore: Money.from({ amount: row.balance_before, currency }),
      balanceAfter: Money.from({ amount: row.balance_after, currency }),
      createdAt: new Date(row.created_at),
    });
  }

  static toRecord(entry: WalletLedgerEntry): WalletLedgerEntryRecord {
    const record = new WalletLedgerEntryRecord();
    record.id = entry.id;
    record.walletId = entry.walletId;
    record.transactionId = entry.transactionId;
    record.walletVersion = entry.walletVersion;
    record.direction = entry.direction;
    record.amount = entry.money.amount;
    record.currency = entry.money.currency;
    record.balanceBefore = entry.balanceBefore.amount;
    record.balanceAfter = entry.balanceAfter.amount;
    record.createdAt = entry.createdAt;
    return record;
  }
}
