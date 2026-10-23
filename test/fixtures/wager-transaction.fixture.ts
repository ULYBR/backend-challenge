import type { ProcessWagerTransactionInputDto } from "@application/dto/process-wager-transaction.dto";
import { WagerTransactionKind } from "@domain/wagering/wager-transaction";
import { faker } from "@faker-js/faker";

export function buildProcessWagerInput(
  overrides: Partial<ProcessWagerTransactionInputDto> = {},
): ProcessWagerTransactionInputDto {
  const providerId = overrides.providerId ?? `prov-${faker.string.alphanumeric(6)}`;
  const externalTransactionId =
    overrides.externalTransactionId ?? `tx-${faker.string.alphanumeric(8)}`;

  return {
    providerId,
    externalTransactionId,
    idempotencyKey: overrides.idempotencyKey ?? `${providerId}:${externalTransactionId}`,
    playerId: overrides.playerId ?? faker.string.uuid(),
    walletId: overrides.walletId ?? faker.string.uuid(),
    roundId: overrides.roundId ?? `round-${faker.string.alphanumeric(6)}`,
    gameId:
      overrides.gameId ??
      faker.helpers.arrayElement(["fortune-tiger", "sweet-bonanza", "mega-roulette"]),
    kind: overrides.kind ?? WagerTransactionKind.Bet,
    money: overrides.money ?? {
      amount: "25.00",
      currency: "BRL",
    },
    ...(overrides.referenceExternalTransactionId !== undefined
      ? { referenceExternalTransactionId: overrides.referenceExternalTransactionId }
      : {}),
    ...(overrides.correlationId !== undefined ? { correlationId: overrides.correlationId } : {}),
    ...(overrides.causationId !== undefined ? { causationId: overrides.causationId } : {}),
    ...(overrides.inboxRegistration !== undefined
      ? { inboxRegistration: overrides.inboxRegistration }
      : {}),
  };
}
