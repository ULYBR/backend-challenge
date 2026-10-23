import { LedgerCursorPayload } from "@application/shared/ledger-cursor.codec";
import { WalletLedgerEntry } from "@domain/wallet/wallet-ledger-entry";

export interface ListLedgerByCursorOptions {
  readonly walletId: string;
  readonly limit: number;
  readonly cursor?: LedgerCursorPayload | undefined;
}

export interface WalletLedgerRepositoryPort {
  insert(entry: WalletLedgerEntry): Promise<void>;
  listByWalletCursor(options: ListLedgerByCursorOptions): Promise<readonly WalletLedgerEntry[]>;
  listAllByWalletChronological(walletId: string): Promise<readonly WalletLedgerEntry[]>;
}
