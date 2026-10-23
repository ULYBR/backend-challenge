import { Money } from "@domain/shared/money";
import { Wallet } from "@domain/wallet/wallet";
import { WalletRecord } from "@infrastructure/persistence/schemas/wallet.schema";

export interface WalletSqlRow {
  readonly id: string;
  readonly player_id: string;
  readonly currency: string;
  readonly balance: string;
  readonly version: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

export class WalletMapper {
  private constructor() {}

  static toDomain(record: WalletRecord): Wallet {
    return Wallet.rehydrate({
      id: record.id,
      playerId: record.playerId,
      currency: record.currency.trim(),
      balance: Money.from({ amount: record.balance, currency: record.currency.trim() }),
      version: Number(record.version),
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    });
  }

  static fromRow(row: WalletSqlRow): Wallet {
    const currency = row.currency.trim();
    return Wallet.rehydrate({
      id: row.id,
      playerId: row.player_id,
      currency,
      balance: Money.from({ amount: row.balance, currency }),
      version: Number(row.version),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  static toRecord(wallet: Wallet): WalletRecord {
    const record = new WalletRecord();
    record.id = wallet.id;
    record.playerId = wallet.playerId;
    record.currency = wallet.currency;
    record.balance = wallet.balance.amount;
    record.version = wallet.version;
    record.createdAt = wallet.createdAt;
    record.updatedAt = wallet.updatedAt;
    return record;
  }
}
