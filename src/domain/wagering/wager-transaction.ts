import { DomainValidationError, InvalidTransactionStateError } from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import { Money } from "@domain/shared/money";
import {
  CreateOpeningTransactionInput,
  CreateWagerTransactionInput,
  CreateWagerTransactionProps,
  KindPolicy,
  WagerTransactionKind,
  WagerTransactionOutputDto,
  WagerTransactionState,
  WagerTransactionStatus,
} from "@domain/wagering/wager-transaction.types";
import { INVERSE_DIRECTION, LedgerDirection } from "@domain/wallet/ledger-direction";

export { WagerTransactionKind, WagerTransactionStatus };
export type {
  CreateOpeningTransactionInput,
  CreateWagerTransactionInput,
  CreateWagerTransactionProps,
  KindPolicy,
  WagerTransactionOutputDto,
  WagerTransactionState,
};

export const INTERNAL_PROVIDER_ID = "__internal__" as const;
export const INTERNAL_OPENING_ROUND_ID = "__opening__" as const;
export const INTERNAL_OPENING_GAME_ID = "__opening__" as const;

export const KIND_POLICIES: Readonly<Record<WagerTransactionKind, KindPolicy>> = {
  [WagerTransactionKind.Opening]: {
    isExternalSubmissible: false,
    affectsBalance: true,
    requiresReference: false,
    allowedReferenceKinds: new Set(),
    resolveDirection: () => LedgerDirection.Credit,
  },
  [WagerTransactionKind.Bet]: {
    isExternalSubmissible: true,
    affectsBalance: true,
    requiresReference: false,
    allowedReferenceKinds: new Set(),
    resolveDirection: () => LedgerDirection.Debit,
  },
  [WagerTransactionKind.Win]: {
    isExternalSubmissible: true,
    affectsBalance: true,
    requiresReference: false,
    allowedReferenceKinds: new Set([WagerTransactionKind.Bet]),
    resolveDirection: () => LedgerDirection.Credit,
  },
  [WagerTransactionKind.Loss]: {
    isExternalSubmissible: true,
    affectsBalance: false,
    requiresReference: false,
    allowedReferenceKinds: new Set([WagerTransactionKind.Bet]),
    resolveDirection: () => {
      throw new DomainValidationError(
        FailureCode.LedgerEntryUnbalanced,
        "LOSS transaction does not affect balance and has no ledger direction",
      );
    },
  },
  [WagerTransactionKind.Refund]: {
    isExternalSubmissible: true,
    affectsBalance: true,
    requiresReference: true,
    allowedReferenceKinds: new Set([WagerTransactionKind.Bet]),
    resolveDirection: () => LedgerDirection.Credit,
  },
  [WagerTransactionKind.Rollback]: {
    isExternalSubmissible: true,
    affectsBalance: true,
    requiresReference: true,
    allowedReferenceKinds: new Set([
      WagerTransactionKind.Bet,
      WagerTransactionKind.Win,
      WagerTransactionKind.Refund,
    ]),
    resolveDirection: (reference) => {
      if (reference === undefined) {
        throw new DomainValidationError(
          FailureCode.MissingReferenceTransaction,
          "ROLLBACK requires a resolved reference transaction to determine ledger direction",
        );
      }
      return INVERSE_DIRECTION[reference.ledgerDirectionFor()];
    },
  },
};

const TERMINAL_STATUSES: ReadonlySet<WagerTransactionStatus> = new Set([
  WagerTransactionStatus.Processed,
  WagerTransactionStatus.Rejected,
  WagerTransactionStatus.Failed,
]);

const ALLOWED_STATUS_TRANSITIONS: Readonly<
  Record<WagerTransactionStatus, ReadonlySet<WagerTransactionStatus>>
> = {
  [WagerTransactionStatus.Pending]: new Set([
    WagerTransactionStatus.Processed,
    WagerTransactionStatus.PendingReference,
    WagerTransactionStatus.Rejected,
    WagerTransactionStatus.Failed,
  ]),
  [WagerTransactionStatus.PendingReference]: new Set([
    WagerTransactionStatus.Processed,
    WagerTransactionStatus.PendingReference,
    WagerTransactionStatus.Rejected,
    WagerTransactionStatus.Failed,
  ]),
  [WagerTransactionStatus.Processed]: new Set(),
  [WagerTransactionStatus.Rejected]: new Set(),
  [WagerTransactionStatus.Failed]: new Set(),
};

export class WagerTransaction {
  public readonly id: string;
  public readonly providerId: string;
  public readonly externalTransactionId: string;
  public readonly idempotencyKey: string;
  public readonly payloadHash: string;
  public readonly walletId: string;
  public readonly playerId: string;
  public readonly roundId: string;
  public readonly gameId: string;
  public readonly kind: WagerTransactionKind;
  public readonly money: Money;
  public readonly referenceExternalTransactionId: string | undefined;
  public readonly createdAt: Date;
  private _status: WagerTransactionStatus;
  private _referenceTransactionId: string | undefined;
  private _failureCode: FailureCode | undefined;
  private _recordedBalance: Money | undefined;
  private _referenceAttempts: number;
  private _nextReferenceAttemptAt: Date | undefined;
  private _processedAt: Date | undefined;
  private _updatedAt: Date;

  private constructor(state: WagerTransactionState) {
    this.id = state.id;
    this.providerId = state.providerId;
    this.externalTransactionId = state.externalTransactionId;
    this.idempotencyKey = state.idempotencyKey;
    this.payloadHash = state.payloadHash;
    this.walletId = state.walletId;
    this.playerId = state.playerId;
    this.roundId = state.roundId;
    this.gameId = state.gameId;
    this.kind = state.kind;
    this.money = state.money;
    this.referenceExternalTransactionId = state.referenceExternalTransactionId;
    this.createdAt = state.createdAt;
    this._status = state.status;
    this._referenceTransactionId = state.referenceTransactionId;
    this._failureCode = state.failureCode;
    this._recordedBalance = state.recordedBalance;
    this._referenceAttempts = state.referenceAttempts ?? 0;
    this._nextReferenceAttemptAt = state.nextReferenceAttemptAt;
    this._processedAt = state.processedAt;
    this._updatedAt = state.updatedAt ?? state.createdAt;
  }

  static create(input: CreateWagerTransactionInput): WagerTransaction {
    WagerTransaction.assertExternalSubmissible(input.kind);
    WagerTransaction.assertPositiveMoney(input.money);
    WagerTransaction.assertReferencePresence(input.kind, input.referenceExternalTransactionId);

    const now = input.createdAt ?? new Date();
    return new WagerTransaction({
      id: input.id,
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
      createdAt: now,
      status: WagerTransactionStatus.Pending,
      referenceAttempts: 0,
      updatedAt: now,
    });
  }

  static createOpening(input: CreateOpeningTransactionInput): WagerTransaction {
    WagerTransaction.assertPositiveMoney(input.initialBalance);
    const now = input.createdAt ?? new Date();
    const externalKey = `opening:${input.walletId}`;

    return new WagerTransaction({
      id: input.id,
      providerId: INTERNAL_PROVIDER_ID,
      externalTransactionId: externalKey,
      idempotencyKey: externalKey,
      payloadHash: input.payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: INTERNAL_OPENING_ROUND_ID,
      gameId: INTERNAL_OPENING_GAME_ID,
      kind: WagerTransactionKind.Opening,
      money: input.initialBalance,
      createdAt: now,
      status: WagerTransactionStatus.Processed,
      recordedBalance: input.initialBalance,
      referenceAttempts: 0,
      processedAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(state);
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get recordedBalance(): Money | undefined {
    return this._recordedBalance;
  }

  get referenceAttempts(): number {
    return this._referenceAttempts;
  }

  get nextReferenceAttemptAt(): Date | undefined {
    return this._nextReferenceAttemptAt;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  markProcessed(
    referenceTransactionId: string | undefined,
    at: Date,
    recordedBalance?: Money,
  ): void {
    this.assertCanTransitionTo(WagerTransactionStatus.Processed);
    if (this.requiresReference() && referenceTransactionId === undefined) {
      throw new DomainValidationError(
        FailureCode.MissingReferenceTransaction,
        `Cannot mark ${this.kind} transaction '${this.id}' as PROCESSED without referenceTransactionId`,
      );
    }

    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._failureCode = undefined;
    this._recordedBalance = recordedBalance;
    this._nextReferenceAttemptAt = undefined;
    this._processedAt = at;
    this._updatedAt = at;
  }

  markPendingReference(nextAttemptAt?: Date, at: Date = new Date()): void {
    this.assertCanTransitionTo(WagerTransactionStatus.PendingReference);
    this._status = WagerTransactionStatus.PendingReference;
    this._referenceAttempts += 1;
    this._nextReferenceAttemptAt = nextAttemptAt;
    this._updatedAt = at;
  }

  reject(code: FailureCode, at: Date = new Date(), recordedBalance?: Money): void {
    this.assertCanTransitionTo(WagerTransactionStatus.Rejected);
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._recordedBalance = recordedBalance;
    this._nextReferenceAttemptAt = undefined;
    this._processedAt = at;
    this._updatedAt = at;
  }

  fail(code: FailureCode, at: Date = new Date()): void {
    this.assertCanTransitionTo(WagerTransactionStatus.Failed);
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._nextReferenceAttemptAt = undefined;
    this._processedAt = at;
    this._updatedAt = at;
  }

  isTerminal(): boolean {
    return TERMINAL_STATUSES.has(this._status);
  }

  affectsBalance(): boolean {
    return KIND_POLICIES[this.kind].affectsBalance;
  }

  requiresReference(): boolean {
    return KIND_POLICIES[this.kind].requiresReference;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    return KIND_POLICIES[this.kind].resolveDirection(reference);
  }

  validateReferenceTarget(reference: WagerTransaction): FailureCode | undefined {
    const policy = KIND_POLICIES[this.kind];

    if (
      reference.providerId !== this.providerId ||
      reference.walletId !== this.walletId ||
      reference.playerId !== this.playerId ||
      reference.roundId !== this.roundId ||
      reference.money.currency !== this.money.currency
    ) {
      return FailureCode.ReferenceContextMismatch;
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      return FailureCode.ReferenceNotProcessed;
    }

    if (!policy.allowedReferenceKinds.has(reference.kind)) {
      return FailureCode.InvalidReferenceKind;
    }

    if (this.requiresReference() && !reference.money.equals(this.money)) {
      return FailureCode.ReferenceAmountMismatch;
    }

    return undefined;
  }

  toJSON(): WagerTransactionOutputDto {
    return {
      id: this.id,
      providerId: this.providerId,
      externalTransactionId: this.externalTransactionId,
      idempotencyKey: this.idempotencyKey,
      walletId: this.walletId,
      playerId: this.playerId,
      roundId: this.roundId,
      gameId: this.gameId,
      kind: this.kind,
      money: this.money.toJSON(),
      referenceExternalTransactionId: this.referenceExternalTransactionId,
      referenceTransactionId: this._referenceTransactionId,
      status: this._status,
      failureCode: this._failureCode,
      recordedBalance: this._recordedBalance?.toJSON(),
      createdAt: this.createdAt.toISOString(),
      processedAt: this._processedAt?.toISOString(),
    };
  }

  private assertCanTransitionTo(targetStatus: WagerTransactionStatus): void {
    const allowedTargets = ALLOWED_STATUS_TRANSITIONS[this._status];
    if (!allowedTargets.has(targetStatus)) {
      throw new InvalidTransactionStateError(this.id, this._status, targetStatus);
    }
  }

  private static assertExternalSubmissible(kind: WagerTransactionKind): void {
    const policy = KIND_POLICIES[kind];
    if (!policy.isExternalSubmissible) {
      throw new DomainValidationError(
        FailureCode.OpeningKindForbiddenExternally,
        `Transaction kind '${kind}' is reserved for internal operations`,
      );
    }
  }

  private static assertPositiveMoney(money: Money): void {
    if (!money.isPositive()) {
      throw new DomainValidationError(
        FailureCode.InvalidMoneyAmount,
        "WagerTransaction money must be strictly positive",
      );
    }
  }

  private static assertReferencePresence(
    kind: WagerTransactionKind,
    referenceExternalTransactionId: string | undefined,
  ): void {
    const policy = KIND_POLICIES[kind];
    const hasReference =
      referenceExternalTransactionId !== undefined &&
      referenceExternalTransactionId.trim().length > 0;

    if (policy.requiresReference && !hasReference) {
      throw new DomainValidationError(
        FailureCode.MissingReferenceTransaction,
        `Transaction kind '${kind}' requires referenceExternalTransactionId`,
      );
    }
  }
}
