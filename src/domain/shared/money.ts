import { CurrencyMismatchError, InvalidMoneyError } from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import {
  MoneyInputDto,
  MoneyInternalState,
  MoneyOutputDto,
  MoneyProps,
} from "@domain/shared/money.types";

export type { MoneyInputDto, MoneyInternalState, MoneyOutputDto, MoneyProps };

const CURRENCY_ISO_REGEX = /^[A-Z]{3}$/;
const UNSIGNED_DECIMAL_REGEX = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/;
const SIGNED_DECIMAL_REGEX = /^(-?)(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/;
const SCALE_FACTOR = 100n;

function assertValidCurrency(currency: string): void {
  if (typeof currency !== "string" || !CURRENCY_ISO_REGEX.test(currency)) {
    throw new InvalidMoneyError(
      `Invalid ISO-4217 currency code '${String(currency)}'`,
      FailureCode.InvalidCurrencyCode,
      { currency },
    );
  }
}

function parseMinorUnits(amount: string, allowNegative: boolean): bigint {
  if (typeof amount !== "string") {
    throw new InvalidMoneyError("Money amount must be a decimal string");
  }

  const pattern = allowNegative ? SIGNED_DECIMAL_REGEX : UNSIGNED_DECIMAL_REGEX;
  const match = pattern.exec(amount);
  if (match === null) {
    throw new InvalidMoneyError(`Invalid money amount format '${amount}'`);
  }

  const [wholePartRaw = "0", fractionPartRaw = ""] = amount.replace(/^-/, "").split(".");
  const fractionPadded = fractionPartRaw.padEnd(2, "0");
  const magnitude = BigInt(wholePartRaw) * SCALE_FACTOR + BigInt(fractionPadded);
  const isNegative = amount.startsWith("-") && magnitude > 0n;

  return isNegative ? -magnitude : magnitude;
}

function formatMinorUnits(minorUnits: bigint): string {
  const isNegative = minorUnits < 0n;
  const abs = isNegative ? -minorUnits : minorUnits;
  const whole = abs / SCALE_FACTOR;
  const fraction = (abs % SCALE_FACTOR).toString().padStart(2, "0");
  const prefix = isNegative ? "-" : "";
  return `${prefix}${whole.toString()}.${fraction}`;
}

export class Money {
  private readonly minorUnits: bigint;
  public readonly currency: string;

  private constructor(state: MoneyInternalState) {
    this.minorUnits = state.minorUnits;
    this.currency = state.currency;
  }

  static from(input: MoneyInputDto): Money {
    assertValidCurrency(input.currency);
    const minorUnits = parseMinorUnits(input.amount, false);
    return new Money({ minorUnits, currency: input.currency });
  }

  static rehydrate(input: MoneyInputDto): Money {
    assertValidCurrency(input.currency);
    const minorUnits = parseMinorUnits(input.amount, true);
    return new Money({ minorUnits, currency: input.currency });
  }

  static zero(currency: string): Money {
    assertValidCurrency(currency);
    return new Money({ minorUnits: 0n, currency });
  }

  get amount(): string {
    return formatMinorUnits(this.minorUnits);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money({
      minorUnits: this.minorUnits + other.minorUnits,
      currency: this.currency,
    });
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money({
      minorUnits: this.minorUnits - other.minorUnits,
      currency: this.currency,
    });
  }

  negate(): Money {
    return new Money({
      minorUnits: -this.minorUnits,
      currency: this.currency,
    });
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minorUnits < other.minorUnits;
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minorUnits === other.minorUnits;
  }

  toJSON(): MoneyOutputDto {
    return {
      amount: this.amount,
      currency: this.currency,
    };
  }

  toString(): string {
    return `${this.amount} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
