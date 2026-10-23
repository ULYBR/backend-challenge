import { MoneyProps } from "@domain/shared/money.types";

export interface ReconcileWalletInputDto {
  readonly walletId: string;
}

export interface ReconcileWalletOutputDto {
  readonly walletId: string;
  readonly consistent: boolean;
  readonly storedBalance: MoneyProps;
  readonly calculatedBalance: MoneyProps;
  readonly difference: MoneyProps;
  readonly checkedEntries: number;
  readonly walletBalance: MoneyProps;
  readonly reconstructedBalance: MoneyProps;
  readonly entryCount: number;
  readonly lastVersion: number;
}
