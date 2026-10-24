import { createHash } from "node:crypto";
import type { CanonicalWagerPayloadInput } from "@application/shared/canonical-payload-hasher.types";
import { Money } from "@domain/shared/money";
import { WagerTransactionKind } from "@domain/wagering/wager-transaction.types";

export type { CanonicalWagerPayloadInput };

export class CanonicalPayloadHasher {
  private constructor() {}

  static compute(input: CanonicalWagerPayloadInput): string {
    const normalizedMoney = Money.from(input.money);
    const canonicalTuple = {
      providerId: input.providerId.trim(),
      externalTransactionId: input.externalTransactionId.trim(),
      walletId: input.walletId.trim(),
      playerId: input.playerId.trim(),
      roundId: input.roundId.trim(),
      gameId: input.gameId.trim(),
      kind: input.kind,
      amount: normalizedMoney.amount,
      currency: normalizedMoney.currency,
      referenceExternalTransactionId:
        input.referenceExternalTransactionId !== undefined &&
        input.referenceExternalTransactionId.trim().length > 0
          ? input.referenceExternalTransactionId.trim()
          : null,
    };

    return createHash("sha256").update(JSON.stringify(canonicalTuple)).digest("hex");
  }

  static computeOpening(walletId: string, playerId: string, initialBalance: Money): string {
    const canonicalTuple = {
      kind: WagerTransactionKind.Opening,
      walletId: walletId.trim(),
      playerId: playerId.trim(),
      amount: initialBalance.amount,
      currency: initialBalance.currency,
    };
    return createHash("sha256").update(JSON.stringify(canonicalTuple)).digest("hex");
  }

  static computeRaw(rawContent: string): string {
    return createHash("sha256").update(rawContent).digest("hex");
  }
}
