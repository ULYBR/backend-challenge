import type { LedgerCursorPayload } from "@application/shared/ledger-cursor.types";

export interface ListLedgerByCursorOptions {
  readonly walletId: string;
  readonly limit: number;
  readonly cursor?: LedgerCursorPayload | undefined;
}
