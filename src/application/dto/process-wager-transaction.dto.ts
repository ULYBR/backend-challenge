import { MoneyProps } from "@domain/shared/money.types";
import {
  WagerTransactionKind,
  WagerTransactionOutputDto,
} from "@domain/wagering/wager-transaction.types";

export interface InboxMessageRegistrationDto {
  readonly consumerName: string;
  readonly messageId: string;
  readonly payloadHash: string;
}

export interface ProcessWagerTransactionInputDto {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey?: string | undefined;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId?: string | undefined;
  readonly occurredAt?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly causationId?: string | undefined;
  readonly inboxRegistration?: InboxMessageRegistrationDto | undefined;
}

export interface ProcessWagerTransactionOutputDto {
  readonly transaction: WagerTransactionOutputDto;
  readonly balance?: MoneyProps | undefined;
  readonly idempotentReplay: boolean;
}
