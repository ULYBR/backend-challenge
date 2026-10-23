export interface MoneyProps {
  readonly amount: string;
  readonly currency: string;
}

export type MoneyInputDto = MoneyProps;
export type MoneyOutputDto = MoneyProps;

export interface MoneyInternalState {
  readonly minorUnits: bigint;
  readonly currency: string;
}
