import type { ReconcileWalletOutputDto } from "@application/dto/reconcile-wallet.dto";
import type { MoneyProps } from "@domain/shared/money.types";
import {
  WagerTransactionKind,
  type WagerTransactionOutputDto,
  type WagerTransactionStatus,
} from "@domain/wagering/wager-transaction.types";
import type { WalletLedgerEntryOutputDto, WalletOutputDto } from "@domain/wallet/wallet.types";
import { z } from "zod";

const moneySchema = z.object({
  amount: z.string().trim().min(1),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter uppercase ISO-4217 code"),
});

export const openWalletRequestSchema = z.object({
  playerId: z.string().uuid("playerId must be a valid UUID"),
  initialBalance: moneySchema,
});

export type OpenWalletRequestDto = z.infer<typeof openWalletRequestSchema>;
export type OpenWalletResponseDto = WalletOutputDto;

export const submitWagerTransactionRequestSchema = z.object({
  providerId: z.string().trim().min(1),
  externalTransactionId: z.string().trim().min(1),
  playerId: z.string().uuid("playerId must be a valid UUID"),
  walletId: z.string().uuid("walletId must be a valid UUID"),
  roundId: z.string().trim().min(1),
  gameId: z.string().trim().min(1),
  kind: z.nativeEnum(WagerTransactionKind),
  money: moneySchema,
  referenceExternalTransactionId: z.string().trim().min(1).optional(),
  occurredAt: z.string().datetime().optional(),
});

export type SubmitWagerTransactionRequestDto = z.infer<typeof submitWagerTransactionRequestSchema>;

export interface SubmitWagerTransactionResponseDto {
  readonly transactionId: string;
  readonly id: string;
  readonly status: WagerTransactionStatus;
  readonly balance?: MoneyProps | undefined;
  readonly failureCode: string | null;
  readonly idempotentReplay: boolean;
  readonly transaction: WagerTransactionOutputDto;
}

export const listWalletLedgerQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type ListWalletLedgerQueryDto = z.infer<typeof listWalletLedgerQuerySchema>;

export interface ListWalletLedgerResponseDto {
  readonly items: readonly WalletLedgerEntryOutputDto[];
  readonly nextCursor: string | null;
}

export type ReconcileWalletResponseDto = ReconcileWalletOutputDto;

export interface HttpErrorResponseDto {
  readonly error: {
    readonly code: string;
    readonly failureCode: string;
    readonly message: string;
    readonly correlationId?: string | undefined;
    readonly details?: unknown;
  };
}
