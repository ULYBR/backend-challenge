import { WalletRepositoryPort } from "@application/ports/wallet-repository.port";
import { WalletAlreadyExistsError, WalletLockTimeoutError } from "@domain/shared/domain-errors";
import { Wallet } from "@domain/wallet/wallet";
import { WalletMapper, WalletSqlRow } from "@infrastructure/persistence/mappers/wallet.mapper";
import { PostgresErrorHelper } from "@infrastructure/persistence/postgres-error.helper";
import { EntityManager } from "@mikro-orm/postgresql";

export class MikroOrmWalletRepository implements WalletRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<Wallet | null> {
    const rows = await this.em.execute<WalletSqlRow[]>(
      `SELECT id, player_id, currency, balance, version, created_at, updated_at
         FROM wallets
        WHERE id = ?`,
      [id],
    );
    const row = rows[0];
    return row !== undefined ? WalletMapper.fromRow(row) : null;
  }

  async findByIdForUpdate(id: string): Promise<Wallet | null> {
    try {
      const rows = await this.em.execute<WalletSqlRow[]>(
        `SELECT id, player_id, currency, balance, version, created_at, updated_at
           FROM wallets
          WHERE id = ?
            FOR UPDATE`,
        [id],
      );
      const row = rows[0];
      return row !== undefined ? WalletMapper.fromRow(row) : null;
    } catch (error) {
      if (PostgresErrorHelper.isLockTimeout(error)) {
        throw new WalletLockTimeoutError(id);
      }
      throw error;
    }
  }

  async findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const rows = await this.em.execute<WalletSqlRow[]>(
      `SELECT id, player_id, currency, balance, version, created_at, updated_at
         FROM wallets
        WHERE player_id = ? AND currency = ?`,
      [playerId, currency],
    );
    const row = rows[0];
    return row !== undefined ? WalletMapper.fromRow(row) : null;
  }

  async insert(wallet: Wallet): Promise<void> {
    try {
      await this.em.execute(
        `INSERT INTO wallets (id, player_id, currency, balance, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          wallet.id,
          wallet.playerId,
          wallet.currency,
          wallet.balance.amount,
          wallet.version,
          wallet.createdAt,
          wallet.updatedAt,
        ],
      );
    } catch (error) {
      if (PostgresErrorHelper.isUniqueViolation(error, "uq_wallets__player_currency")) {
        throw new WalletAlreadyExistsError(wallet.playerId, wallet.currency);
      }
      throw error;
    }
  }

  async update(wallet: Wallet): Promise<void> {
    await this.em.execute(
      `UPDATE wallets
          SET balance = ?,
              version = ?,
              updated_at = ?
        WHERE id = ?`,
      [wallet.balance.amount, wallet.version, wallet.updatedAt, wallet.id],
    );
  }
}
