import { InboxRepositoryPort } from "@application/ports/inbox-repository.port";
import { OutboxRepositoryPort } from "@application/ports/outbox-repository.port";
import { WagerTransactionRepositoryPort } from "@application/ports/wager-transaction-repository.port";
import { WalletLedgerRepositoryPort } from "@application/ports/wallet-ledger-repository.port";
import { WalletRepositoryPort } from "@application/ports/wallet-repository.port";

export interface TransactionalContext {
  readonly wallets: WalletRepositoryPort;
  readonly wagerTransactions: WagerTransactionRepositoryPort;
  readonly ledgerEntries: WalletLedgerRepositoryPort;
  readonly inboxMessages: InboxRepositoryPort;
  readonly outboxMessages: OutboxRepositoryPort;
}

export interface UnitOfWorkPort {
  execute<T>(work: (tx: TransactionalContext) => Promise<T>): Promise<T>;
}
