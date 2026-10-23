import { TransactionalContext, UnitOfWorkPort } from "@application/ports/unit-of-work.port";
import {
  MikroOrmInboxRepository,
  MikroOrmOutboxRepository,
  MikroOrmWagerTransactionRepository,
  MikroOrmWalletLedgerRepository,
  MikroOrmWalletRepository,
} from "@infrastructure/persistence/repositories";
import { EntityManager } from "@mikro-orm/postgresql";

export class MikroOrmUnitOfWork implements UnitOfWorkPort {
  constructor(
    private readonly em: EntityManager,
    private readonly lockTimeoutMs: number = 5000,
  ) {}

  async execute<T>(work: (tx: TransactionalContext) => Promise<T>): Promise<T> {
    const forkedEm = this.em.fork({ clear: true });
    const safeTimeoutMs = Math.max(100, Math.floor(this.lockTimeoutMs));

    return forkedEm.transactional(async (txEm) => {
      await txEm.execute(`SET LOCAL lock_timeout = '${safeTimeoutMs}ms'`);

      const context: TransactionalContext = {
        wallets: new MikroOrmWalletRepository(txEm),
        wagerTransactions: new MikroOrmWagerTransactionRepository(txEm),
        ledgerEntries: new MikroOrmWalletLedgerRepository(txEm),
        inboxMessages: new MikroOrmInboxRepository(txEm),
        outboxMessages: new MikroOrmOutboxRepository(txEm),
      };

      return work(context);
    });
  }
}
