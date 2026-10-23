import {
  ListLedgerByCursorOptions,
  WalletLedgerRepositoryPort,
} from "@application/ports/wallet-ledger-repository.port";
import { WalletLedgerEntry } from "@domain/wallet/wallet-ledger-entry";
import {
  WalletLedgerEntryMapper,
  WalletLedgerEntrySqlRow,
} from "@infrastructure/persistence/mappers/wallet-ledger-entry.mapper";
import { EntityManager } from "@mikro-orm/postgresql";

const SELECT_LEDGER_COLUMNS = `
  id,
  wallet_id,
  transaction_id,
  wallet_version,
  direction,
  amount,
  currency,
  balance_before,
  balance_after,
  created_at
`;

export class MikroOrmWalletLedgerRepository implements WalletLedgerRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  async insert(entry: WalletLedgerEntry): Promise<void> {
    await this.em.execute(
      `INSERT INTO wallet_ledger_entries (
        id,
        wallet_id,
        transaction_id,
        wallet_version,
        direction,
        amount,
        currency,
        balance_before,
        balance_after,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.walletId,
        entry.transactionId,
        entry.walletVersion,
        entry.direction,
        entry.money.amount,
        entry.money.currency,
        entry.balanceBefore.amount,
        entry.balanceAfter.amount,
        entry.createdAt,
      ],
    );
  }

  async listByWalletCursor(
    options: ListLedgerByCursorOptions,
  ): Promise<readonly WalletLedgerEntry[]> {
    if (options.cursor !== undefined) {
      const rows = await this.em.execute<WalletLedgerEntrySqlRow[]>(
        `SELECT ${SELECT_LEDGER_COLUMNS}
           FROM wallet_ledger_entries
          WHERE wallet_id = ?
            AND (created_at, id) > (?::timestamptz, ?::uuid)
          ORDER BY created_at ASC, id ASC
          LIMIT ?`,
        [options.walletId, options.cursor.createdAt, options.cursor.id, options.limit],
      );
      return rows.map((row) => WalletLedgerEntryMapper.fromRow(row));
    }

    const rows = await this.em.execute<WalletLedgerEntrySqlRow[]>(
      `SELECT ${SELECT_LEDGER_COLUMNS}
         FROM wallet_ledger_entries
        WHERE wallet_id = ?
        ORDER BY created_at ASC, id ASC
        LIMIT ?`,
      [options.walletId, options.limit],
    );
    return rows.map((row) => WalletLedgerEntryMapper.fromRow(row));
  }

  async listAllByWalletChronological(walletId: string): Promise<readonly WalletLedgerEntry[]> {
    const rows = await this.em.execute<WalletLedgerEntrySqlRow[]>(
      `SELECT ${SELECT_LEDGER_COLUMNS}
         FROM wallet_ledger_entries
        WHERE wallet_id = ?
        ORDER BY wallet_version ASC`,
      [walletId],
    );
    return rows.map((row) => WalletLedgerEntryMapper.fromRow(row));
  }
}
