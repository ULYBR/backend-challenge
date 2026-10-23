import {
  InboxMessageEntitySchema,
  InboxMessageRecord,
} from "@infrastructure/persistence/schemas/inbox-message.schema";
import {
  OutboxMessageEntitySchema,
  OutboxMessageRecord,
} from "@infrastructure/persistence/schemas/outbox-message.schema";
import {
  WagerTransactionEntitySchema,
  WagerTransactionRecord,
} from "@infrastructure/persistence/schemas/wager-transaction.schema";
import {
  WalletLedgerEntryEntitySchema,
  WalletLedgerEntryRecord,
} from "@infrastructure/persistence/schemas/wallet-ledger-entry.schema";
import {
  WalletEntitySchema,
  WalletRecord,
} from "@infrastructure/persistence/schemas/wallet.schema";
import { EntitySchema } from "@mikro-orm/core";

export {
  InboxMessageEntitySchema,
  InboxMessageRecord,
  OutboxMessageEntitySchema,
  OutboxMessageRecord,
  WagerTransactionEntitySchema,
  WagerTransactionRecord,
  WalletEntitySchema,
  WalletLedgerEntryEntitySchema,
  WalletLedgerEntryRecord,
  WalletRecord,
};

export const PERSISTENCE_SCHEMAS: EntitySchema[] = [
  WalletEntitySchema,
  WagerTransactionEntitySchema,
  WalletLedgerEntryEntitySchema,
  InboxMessageEntitySchema,
  OutboxMessageEntitySchema,
];
