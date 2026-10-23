import { MoneyProps } from "@domain/shared/money.types";
import { WalletOutputDto } from "@domain/wallet/wallet.types";

export interface OpenWalletInputDto {
  readonly playerId: string;
  readonly initialBalance: MoneyProps;
  readonly correlationId?: string | undefined;
}

export type OpenWalletOutputDto = WalletOutputDto;
