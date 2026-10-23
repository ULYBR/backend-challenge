import { WagerTransactionKind } from "@domain/wagering/wager-transaction.types";
import { z } from "zod";

const moneySchema = z.object({
  amount: z.string().trim().min(1),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/),
});

export const wagerTransactionRequestedMessageSchema = z.object({
  messageId: z.string().trim().min(1),
  type: z.literal("WagerTransactionRequested"),
  correlationId: z.string().trim().min(1).optional(),
  occurredAt: z.string().trim().min(1),
  data: z.object({
    providerId: z.string().trim().min(1),
    externalTransactionId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
    playerId: z.string().uuid(),
    walletId: z.string().uuid(),
    roundId: z.string().trim().min(1),
    gameId: z.string().trim().min(1),
    kind: z.nativeEnum(WagerTransactionKind),
    money: moneySchema,
    referenceExternalTransactionId: z.string().trim().min(1).optional(),
  }),
});

export type WagerTransactionRequestedMessageDto = z.infer<
  typeof wagerTransactionRequestedMessageSchema
>;

export type ConsumerMessageDisposition = "ACK_TERMINAL" | "RETRY_TRANSIENT" | "PERMANENT_DLQ";

export interface ConsumerPollSummaryDto {
  readonly received: number;
  readonly acknowledged: number;
  readonly movedToDlq: number;
  readonly retriedTransient: number;
}
