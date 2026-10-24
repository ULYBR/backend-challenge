import type { MoneyProps } from "@domain/shared/money.types";
import type { WagerTransactionKind } from "@domain/wagering/wager-transaction.types";

export interface CanonicalWagerPayloadInput {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId?: string | undefined;
}
