import { WagerTransactionOutputDto } from "@domain/wagering/wager-transaction.types";
import { WalletLedgerEntryOutputDto, WalletOutputDto } from "@domain/wallet/wallet.types";

export interface GetWalletInputDto {
  readonly walletId: string;
}

export type GetWalletOutputDto = WalletOutputDto;

export interface ListWalletLedgerInputDto {
  readonly walletId: string;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export interface ListWalletLedgerOutputDto {
  readonly items: readonly WalletLedgerEntryOutputDto[];
  readonly nextCursor: string | null;
}

export interface GetWagerTransactionInputDto {
  readonly transactionId: string;
}

export interface GetWagerTransactionByExternalIdInputDto {
  readonly providerId: string;
  readonly externalTransactionId: string;
}

export type GetWagerTransactionOutputDto = WagerTransactionOutputDto;
