import type { InboxRepositoryPort } from "@application/ports/inbox-repository.port";
import type { OutboxRepositoryPort } from "@application/ports/outbox-repository.port";
import type { WagerTransactionRepositoryPort } from "@application/ports/wager-transaction-repository.port";
import type { WalletLedgerRepositoryPort } from "@application/ports/wallet-ledger-repository.port";
import type { WalletRepositoryPort } from "@application/ports/wallet-repository.port";

export interface TransactionalContext {
  readonly wallets: WalletRepositoryPort;
  readonly wagerTransactions: WagerTransactionRepositoryPort;
  readonly ledgerEntries: WalletLedgerRepositoryPort;
  readonly inboxMessages: InboxRepositoryPort;
  readonly outboxMessages: OutboxRepositoryPort;
}
