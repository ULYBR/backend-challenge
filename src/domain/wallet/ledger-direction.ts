import { Money } from "@domain/shared/money";

export enum LedgerDirection {
  Debit = "DEBIT",
  Credit = "CREDIT",
}

export const DIRECTION_ARITHMETIC: Readonly<
  Record<LedgerDirection, (balanceBefore: Money, amount: Money) => Money>
> = {
  [LedgerDirection.Credit]: (balanceBefore, amount) => balanceBefore.add(amount),
  [LedgerDirection.Debit]: (balanceBefore, amount) => balanceBefore.subtract(amount),
};

export const INVERSE_DIRECTION: Readonly<Record<LedgerDirection, LedgerDirection>> = {
  [LedgerDirection.Credit]: LedgerDirection.Debit,
  [LedgerDirection.Debit]: LedgerDirection.Credit,
};
