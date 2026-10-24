import type { ListLedgerByCursorOptions } from "@application/ports/wallet-ledger-repository.types";
import type { WalletLedgerEntry } from "@domain/wallet/wallet-ledger-entry";

export type { ListLedgerByCursorOptions };

export interface WalletLedgerRepositoryPort {
  insert(entry: WalletLedgerEntry): Promise<void>;
  listByWalletCursor(options: ListLedgerByCursorOptions): Promise<readonly WalletLedgerEntry[]>;
  listAllByWalletChronological(walletId: string): Promise<readonly WalletLedgerEntry[]>;
}
