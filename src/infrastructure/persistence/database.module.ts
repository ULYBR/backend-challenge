import { InboxRepositoryPort } from "@application/ports/inbox-repository.port";
import { OutboxRepositoryPort } from "@application/ports/outbox-repository.port";
import { TOKENS } from "@application/ports/tokens";
import { UnitOfWorkPort } from "@application/ports/unit-of-work.port";
import { WagerTransactionRepositoryPort } from "@application/ports/wager-transaction-repository.port";
import { WalletLedgerRepositoryPort } from "@application/ports/wallet-ledger-repository.port";
import { WalletRepositoryPort } from "@application/ports/wallet-repository.port";
import { AppEnv } from "@infrastructure/config/env";
import { buildMikroOrmOptions } from "@infrastructure/persistence/mikro-orm.config";
import {
  MikroOrmInboxRepository,
  MikroOrmOutboxRepository,
  MikroOrmWagerTransactionRepository,
  MikroOrmWalletLedgerRepository,
  MikroOrmWalletRepository,
} from "@infrastructure/persistence/repositories";
import { MikroOrmUnitOfWork } from "@infrastructure/persistence/unit-of-work/mikro-orm-unit-of-work";
import { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { Global, Inject, Module, OnApplicationShutdown } from "@nestjs/common";

@Global()
@Module({
  providers: [
    {
      provide: TOKENS.MIKRO_ORM,
      inject: [TOKENS.APP_ENV],
      useFactory: async (env: AppEnv): Promise<MikroORM> => {
        return MikroORM.init(buildMikroOrmOptions(env));
      },
    },
    {
      provide: TOKENS.ENTITY_MANAGER,
      inject: [TOKENS.MIKRO_ORM],
      useFactory: (orm: MikroORM): EntityManager => {
        return orm.em;
      },
    },
    {
      provide: TOKENS.UNIT_OF_WORK,
      inject: [TOKENS.ENTITY_MANAGER, TOKENS.APP_ENV],
      useFactory: (em: EntityManager, env: AppEnv): UnitOfWorkPort => {
        return new MikroOrmUnitOfWork(em, env.DB_LOCK_TIMEOUT_MS);
      },
    },
    {
      provide: TOKENS.WALLET_REPOSITORY,
      inject: [TOKENS.ENTITY_MANAGER],
      useFactory: (em: EntityManager): WalletRepositoryPort => {
        return new MikroOrmWalletRepository(em);
      },
    },
    {
      provide: TOKENS.WAGER_TRANSACTION_REPOSITORY,
      inject: [TOKENS.ENTITY_MANAGER],
      useFactory: (em: EntityManager): WagerTransactionRepositoryPort => {
        return new MikroOrmWagerTransactionRepository(em);
      },
    },
    {
      provide: TOKENS.WALLET_LEDGER_REPOSITORY,
      inject: [TOKENS.ENTITY_MANAGER],
      useFactory: (em: EntityManager): WalletLedgerRepositoryPort => {
        return new MikroOrmWalletLedgerRepository(em);
      },
    },
    {
      provide: TOKENS.INBOX_REPOSITORY,
      inject: [TOKENS.ENTITY_MANAGER],
      useFactory: (em: EntityManager): InboxRepositoryPort => {
        return new MikroOrmInboxRepository(em);
      },
    },
    {
      provide: TOKENS.OUTBOX_REPOSITORY,
      inject: [TOKENS.ENTITY_MANAGER],
      useFactory: (em: EntityManager): OutboxRepositoryPort => {
        return new MikroOrmOutboxRepository(em);
      },
    },
  ],
  exports: [
    TOKENS.MIKRO_ORM,
    TOKENS.ENTITY_MANAGER,
    TOKENS.UNIT_OF_WORK,
    TOKENS.WALLET_REPOSITORY,
    TOKENS.WAGER_TRANSACTION_REPOSITORY,
    TOKENS.WALLET_LEDGER_REPOSITORY,
    TOKENS.INBOX_REPOSITORY,
    TOKENS.OUTBOX_REPOSITORY,
  ],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(TOKENS.MIKRO_ORM) private readonly orm: MikroORM) {}

  async onApplicationShutdown(): Promise<void> {
    if (await this.orm.isConnected()) {
      await this.orm.close(true);
    }
  }
}
