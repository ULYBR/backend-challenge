import { describe, expect, it } from "bun:test";
import {
  CurrencyMismatchError,
  DomainError,
  DomainValidationError,
  DuplicateInboxMessageError,
  DuplicateWagerKeyError,
  IdempotencyConflictError,
  InsufficientFundsError,
  InvalidMoneyError,
  InvalidPaginationCursorError,
  InvalidTransactionStateError,
  LedgerInconsistencyError,
  TransactionNotFoundError,
  WalletAlreadyExistsError,
  WalletLockTimeoutError,
  WalletNotFoundError,
} from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";

describe("Domain Errors & Serialization", () => {
  it("serializes base DomainError properties via toJSON", () => {
    class ConcreteError extends DomainError {
      constructor() {
        super({
          failureCode: FailureCode.InvalidMoneyAmount,
          message: "test message",
          metadata: { testKey: "testValue" },
        });
      }
    }

    const error = new ConcreteError();
    expect(error.name).toBe("ConcreteError");
    expect(error.failureCode).toBe(FailureCode.InvalidMoneyAmount);
    expect(error.message).toBe("test message");
    expect(error.toJSON()).toEqual({
      name: "ConcreteError",
      failureCode: FailureCode.InvalidMoneyAmount,
      message: "test message",
      metadata: { testKey: "testValue" },
    });
  });

  it("instantiates all concrete domain errors with correct codes and metadata", () => {
    const invalidMoney = new InvalidMoneyError("invalid money", FailureCode.InvalidMoneyAmount, {
      scale: 3,
    });
    expect(invalidMoney.failureCode).toBe(FailureCode.InvalidMoneyAmount);
    expect(invalidMoney.toJSON().metadata).toEqual({ scale: 3 });

    const defaultInvalidMoney = new InvalidMoneyError("default");
    expect(defaultInvalidMoney.failureCode).toBe(FailureCode.InvalidMoneyAmount);

    const currencyMismatch = new CurrencyMismatchError("USD", "EUR");
    expect(currencyMismatch.failureCode).toBe(FailureCode.CurrencyMismatch);
    expect(currencyMismatch.metadata).toEqual({
      expectedCurrency: "USD",
      actualCurrency: "EUR",
    });

    const insufficientFunds = new InsufficientFundsError("w-1");
    expect(insufficientFunds.failureCode).toBe(FailureCode.InsufficientFunds);

    const reversalNeg = new InsufficientFundsError(
      "w-1",
      FailureCode.ReversalWouldCauseNegativeBalance,
    );
    expect(reversalNeg.failureCode).toBe(FailureCode.ReversalWouldCauseNegativeBalance);

    const stateError = new InvalidTransactionStateError("tx-1", "PENDING", "FAILED");
    expect(stateError.failureCode).toBe(FailureCode.InvalidTransactionStateTransition);
    expect(stateError.metadata).toEqual({
      transactionId: "tx-1",
      fromStatus: "PENDING",
      toStatus: "FAILED",
    });

    const conflictError = new IdempotencyConflictError("p-1", "key-1");
    expect(conflictError.failureCode).toBe(FailureCode.IdempotencyPayloadConflict);
    expect(conflictError.metadata).toEqual({
      providerId: "p-1",
      idempotencyKey: "key-1",
    });

    const validationError = new DomainValidationError(
      FailureCode.ReferenceContextMismatch,
      "mismatch",
      { field: "walletId" },
    );
    expect(validationError.failureCode).toBe(FailureCode.ReferenceContextMismatch);

    const walletNotFound = new WalletNotFoundError("w-999");
    expect(walletNotFound.failureCode).toBe(FailureCode.WalletNotFound);

    const txNotFound = new TransactionNotFoundError("tx-999");
    expect(txNotFound.failureCode).toBe(FailureCode.TransactionNotFound);

    const walletExists = new WalletAlreadyExistsError("player-1", "USD");
    expect(walletExists.failureCode).toBe(FailureCode.WalletAlreadyExists);

    const ledgerInconsistency = new LedgerInconsistencyError("w-1", "100.00", "90.00");
    expect(ledgerInconsistency.failureCode).toBe(FailureCode.LedgerInconsistencyDetected);
    expect(ledgerInconsistency.metadata).toEqual({
      walletId: "w-1",
      expectedBalance: "100.00",
      reconstructedBalance: "90.00",
    });

    const lockTimeout = new WalletLockTimeoutError("w-1");
    expect(lockTimeout.failureCode).toBe(FailureCode.WalletLockTimeout);

    const cursorError = new InvalidPaginationCursorError("bad base64");
    expect(cursorError.failureCode).toBe(FailureCode.InvalidPaginationCursor);

    const duplicateKey = new DuplicateWagerKeyError("p-1", "ext-1");
    expect(duplicateKey.failureCode).toBe(FailureCode.IdempotencyPayloadConflict);

    const duplicateInbox = new DuplicateInboxMessageError("sqs-consumer", "msg-1");
    expect(duplicateInbox.failureCode).toBe(FailureCode.IdempotencyPayloadConflict);
  });
});
