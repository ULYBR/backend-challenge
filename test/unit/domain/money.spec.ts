import { describe, expect, it } from "bun:test";
import { CurrencyMismatchError, InvalidMoneyError } from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import { Money } from "@domain/shared/money";

describe("Money Value Object (Section 6.1 & ADR-0007)", () => {
  it("parses and normalizes 0, 1, and 2 decimal places into fixed scale 2", () => {
    expect(Money.from({ amount: "25", currency: "BRL" }).toJSON()).toEqual({
      amount: "25.00",
      currency: "BRL",
    });
    expect(Money.from({ amount: "25.5", currency: "BRL" }).toJSON()).toEqual({
      amount: "25.50",
      currency: "BRL",
    });
    expect(Money.from({ amount: "25.05", currency: "BRL" }).toString()).toBe("25.05 BRL");
    expect(Money.zero("BRL").toJSON()).toEqual({ amount: "0.00", currency: "BRL" });
  });

  it("performs exact arithmetic without IEEE 754 floating-point drift", () => {
    const a = Money.from({ amount: "0.10", currency: "BRL" });
    const b = Money.from({ amount: "0.20", currency: "BRL" });
    const sum = a.add(b);

    expect(sum.amount).toBe("0.30");
    expect(sum.subtract(a).equals(b)).toBe(true);
    expect(sum.isPositive()).toBe(true);
    expect(sum.isZero()).toBe(false);
    expect(sum.isNegative()).toBe(false);
  });

  it("supports negate(), isNegative() and comparisons", () => {
    const twenty = Money.from({ amount: "20.00", currency: "BRL" });
    const fifty = Money.from({ amount: "50.00", currency: "BRL" });
    const negative = twenty.subtract(fifty);

    expect(negative.amount).toBe("-30.00");
    expect(negative.isNegative()).toBe(true);
    expect(twenty.negate().amount).toBe("-20.00");
    expect(twenty.isLessThan(fifty)).toBe(true);
    expect(fifty.isLessThan(twenty)).toBe(false);
  });

  it("rejects operations across different currencies with CurrencyMismatchError", () => {
    const brl = Money.from({ amount: "10.00", currency: "BRL" });
    const usd = Money.from({ amount: "10.00", currency: "USD" });

    expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.equals(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
  });

  it("rejects invalid inputs: NaN, Infinity, scientific notation, >2 decimals, negative input, leading zeros, invalid ISO currency", () => {
    const invalidAmounts = [
      "",
      "   ",
      "NaN",
      "Infinity",
      "-Infinity",
      "1e2",
      "1E-2",
      "25.000",
      "25.123",
      "-10.00",
      "+10.00",
      "00",
      "01.50",
      "25.",
      ".50",
      "abc",
    ];

    for (const amount of invalidAmounts) {
      expect(() => Money.from({ amount, currency: "BRL" })).toThrow(InvalidMoneyError);
    }

    const invalidCurrencies = ["", "BR", "BRLX", "brl", "123", "B$L"];
    for (const currency of invalidCurrencies) {
      try {
        Money.from({ amount: "10.00", currency });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidMoneyError);
        expect((err as InvalidMoneyError).failureCode).toBe(FailureCode.InvalidCurrencyCode);
      }
    }
  });
});
