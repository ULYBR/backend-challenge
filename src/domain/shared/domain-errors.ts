import { DomainErrorInput, DomainErrorOutputDto } from "@domain/shared/domain-errors.types";
import { FailureCode } from "@domain/shared/failure-code";

export abstract class DomainError extends Error {
  public readonly failureCode: FailureCode;
  public readonly metadata: Readonly<Record<string, unknown>>;

  protected constructor(input: DomainErrorInput) {
    super(input.message);
    this.name = new.target.name;
    this.failureCode = input.failureCode;
    this.metadata = input.metadata ?? {};
  }

  toJSON(): DomainErrorOutputDto {
    return {
      name: this.name,
      failureCode: this.failureCode,
      message: this.message,
      metadata: this.metadata,
    };
  }
}

export class InvalidMoneyError extends DomainError {
  constructor(
    message: string,
    failureCode: FailureCode = FailureCode.InvalidMoneyAmount,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super({ failureCode, message, metadata });
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(expectedCurrency: string, actualCurrency: string) {
    super({
      failureCode: FailureCode.CurrencyMismatch,
      message: `Currency mismatch: expected '${expectedCurrency}', received '${actualCurrency}'`,
      metadata: { expectedCurrency, actualCurrency },
    });
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(
    walletId: string,
    failureCode:
      | FailureCode.InsufficientFunds
      | FailureCode.ReversalWouldCauseNegativeBalance = FailureCode.InsufficientFunds,
  ) {
    super({
      failureCode,
      message: `Insufficient funds in wallet '${walletId}' (${failureCode})`,
      metadata: { walletId },
    });
  }
}

export class InvalidTransactionStateError extends DomainError {
  constructor(transactionId: string, fromStatus: string, toStatus: string) {
    super({
      failureCode: FailureCode.InvalidTransactionStateTransition,
      message: `Invalid state transition for transaction '${transactionId}': '${fromStatus}' -> '${toStatus}'`,
      metadata: { transactionId, fromStatus, toStatus },
    });
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor(providerId: string, idempotencyKey: string) {
    super({
      failureCode: FailureCode.IdempotencyPayloadConflict,
      message: `Idempotency conflict for provider '${providerId}' and key '${idempotencyKey}': payload hash mismatch`,
      metadata: { providerId, idempotencyKey },
    });
  }
}

export class DomainValidationError extends DomainError {
  constructor(
    failureCode: FailureCode,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super({ failureCode, message, metadata });
  }
}

export class WalletNotFoundError extends DomainError {
  constructor(walletId: string) {
    super({
      failureCode: FailureCode.WalletNotFound,
      message: `Wallet '${walletId}' was not found`,
      metadata: { walletId },
    });
  }
}

export class TransactionNotFoundError extends DomainError {
  constructor(transactionId: string) {
    super({
      failureCode: FailureCode.TransactionNotFound,
      message: `Transaction '${transactionId}' was not found`,
      metadata: { transactionId },
    });
  }
}

export class WalletAlreadyExistsError extends DomainError {
  constructor(playerId: string, currency: string) {
    super({
      failureCode: FailureCode.WalletAlreadyExists,
      message: `Wallet already exists for player '${playerId}' and currency '${currency}'`,
      metadata: { playerId, currency },
    });
  }
}

export class LedgerInconsistencyError extends DomainError {
  constructor(walletId: string, expectedBalance: string, reconstructedBalance: string) {
    super({
      failureCode: FailureCode.LedgerInconsistencyDetected,
      message: `Ledger inconsistency detected for wallet '${walletId}'`,
      metadata: { walletId, expectedBalance, reconstructedBalance },
    });
  }
}

export class WalletLockTimeoutError extends DomainError {
  constructor(walletId: string) {
    super({
      failureCode: FailureCode.WalletLockTimeout,
      message: `Timed out waiting for pessimistic row lock on wallet '${walletId}'`,
      metadata: { walletId },
    });
  }
}

export class InvalidPaginationCursorError extends DomainError {
  constructor(reason: string) {
    super({
      failureCode: FailureCode.InvalidPaginationCursor,
      message: `Invalid pagination cursor: ${reason}`,
      metadata: { reason },
    });
  }
}

export class DuplicateWagerKeyError extends DomainError {
  constructor(providerId: string, key: string) {
    super({
      failureCode: FailureCode.IdempotencyPayloadConflict,
      message: `Duplicate wager key for provider '${providerId}' and key '${key}'`,
      metadata: { providerId, key },
    });
  }
}

export class DuplicateInboxMessageError extends DomainError {
  constructor(consumerName: string, messageId: string) {
    super({
      failureCode: FailureCode.IdempotencyPayloadConflict,
      message: `Duplicate inbox message '${messageId}' for consumer '${consumerName}'`,
      metadata: { consumerName, messageId },
    });
  }
}
