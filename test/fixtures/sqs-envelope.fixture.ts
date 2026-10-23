import { WagerTransactionKind } from "@domain/wagering/wager-transaction";
import { faker } from "@faker-js/faker";

export interface SqsWagerEnvelopeData {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: {
    readonly amount: string;
    readonly currency: string;
  };
  readonly referenceExternalTransactionId?: string;
}

export interface SqsWagerEnvelope {
  readonly messageId: string;
  readonly type: string;
  readonly occurredAt: string;
  readonly data: SqsWagerEnvelopeData;
}

export function buildSqsWagerEnvelope(
  overrides: Partial<SqsWagerEnvelopeData> = {},
): SqsWagerEnvelope {
  const providerId = overrides.providerId ?? `sqs-${faker.string.alphanumeric(6)}`;
  const externalTransactionId =
    overrides.externalTransactionId ?? `tx-${faker.string.alphanumeric(8)}`;

  return {
    messageId: `msg-${faker.string.uuid()}`,
    type: "WagerTransactionRequested",
    occurredAt: new Date().toISOString(),
    data: {
      providerId,
      externalTransactionId,
      idempotencyKey: overrides.idempotencyKey ?? `${providerId}:${externalTransactionId}`,
      playerId: overrides.playerId ?? faker.string.uuid(),
      walletId: overrides.walletId ?? faker.string.uuid(),
      roundId: overrides.roundId ?? `round-${faker.string.alphanumeric(6)}`,
      gameId: overrides.gameId ?? "fortune-chimp",
      kind: overrides.kind ?? WagerTransactionKind.Bet,
      money: overrides.money ?? {
        amount: "30.00",
        currency: "BRL",
      },
      ...(overrides.referenceExternalTransactionId !== undefined
        ? { referenceExternalTransactionId: overrides.referenceExternalTransactionId }
        : {}),
    },
  };
}
