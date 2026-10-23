import { describe, expect, it } from "bun:test";
import { CanonicalPayloadHasher } from "@application/shared/canonical-payload-hasher";
import { WagerTransactionKind } from "@domain/wagering/wager-transaction";

describe("CanonicalPayloadHasher (ADR-0012)", () => {
  const baseInput = {
    providerId: "prov-a",
    externalTransactionId: "ext-100",
    walletId: "0195f3a0-0000-7000-8000-000000000001",
    playerId: "0195f3a0-0000-7000-8000-000000000002",
    roundId: "round-1",
    gameId: "slot-1",
    kind: WagerTransactionKind.Bet,
    money: { amount: "25.00", currency: "BRL" },
  } as const;

  it("produces identical SHA-256 hex digest for equivalent decimal strings ('25', '25.0', '25.00') and trimmed strings", () => {
    const hashStandard = CanonicalPayloadHasher.compute(baseInput);
    const hashShortDecimal = CanonicalPayloadHasher.compute({
      ...baseInput,
      providerId: "  prov-a ",
      money: { amount: "25", currency: "BRL" },
    });
    const hashSingleDecimal = CanonicalPayloadHasher.compute({
      ...baseInput,
      money: { amount: "25.0", currency: "BRL" },
    });

    expect(hashStandard).toHaveLength(64);
    expect(hashStandard).toBe(hashShortDecimal);
    expect(hashStandard).toBe(hashSingleDecimal);
  });

  it("produces distinct SHA-256 hex digest when any business field changes", () => {
    const baseHash = CanonicalPayloadHasher.compute(baseInput);
    const diffAmountHash = CanonicalPayloadHasher.compute({
      ...baseInput,
      money: { amount: "25.01", currency: "BRL" },
    });
    const diffKindHash = CanonicalPayloadHasher.compute({
      ...baseInput,
      kind: WagerTransactionKind.Win,
    });
    const diffRoundHash = CanonicalPayloadHasher.compute({
      ...baseInput,
      roundId: "round-2",
    });

    expect(diffAmountHash).not.toBe(baseHash);
    expect(diffKindHash).not.toBe(baseHash);
    expect(diffRoundHash).not.toBe(baseHash);
  });
});
