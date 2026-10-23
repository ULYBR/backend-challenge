import type {
  InboxMessageRegistrationDto,
  ProcessWagerTransactionInputDto,
  ProcessWagerTransactionOutputDto,
} from "@application/dto/process-wager-transaction.dto";
import type { ClockPort } from "@application/ports/clock.port";
import type { IdGeneratorPort } from "@application/ports/id-generator.port";
import type { MetricsPort } from "@application/ports/metrics.port";
import type { StructuredLoggerPort } from "@application/ports/structured-logger.port";
import { TOKENS } from "@application/ports/tokens";
import type { TransactionalContext, UnitOfWorkPort } from "@application/ports/unit-of-work.port";
import { CanonicalPayloadHasher } from "@application/shared/canonical-payload-hasher";
import { InboxMessage } from "@domain/messaging/inbox-message";
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from "@domain/messaging/integration-event";
import { OutboxMessage } from "@domain/messaging/outbox-message";
import {
  DomainValidationError,
  DuplicateInboxMessageError,
  DuplicateWagerKeyError,
  IdempotencyConflictError,
  InsufficientFundsError,
  WalletLockTimeoutError,
  WalletNotFoundError,
} from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import { Money } from "@domain/shared/money";
import { WagerTransaction, WagerTransactionStatus } from "@domain/wagering/wager-transaction";
import { LedgerDirection } from "@domain/wallet/ledger-direction";
import { Wallet } from "@domain/wallet/wallet";
import { WalletLedgerEntry } from "@domain/wallet/wallet-ledger-entry";
import { Inject, Injectable } from "@nestjs/common";

interface MovementExecutionInput {
  readonly wallet: Wallet;
  readonly ledgerEntryId: string;
  readonly transaction: WagerTransaction;
  readonly occurredAt: Date;
}

type WalletMovementStrategy = (input: MovementExecutionInput) => WalletLedgerEntry;

const WALLET_MOVEMENT_STRATEGIES: Readonly<Record<LedgerDirection, WalletMovementStrategy>> = {
  [LedgerDirection.Debit]: ({ wallet, ledgerEntryId, transaction, occurredAt }) =>
    wallet.debit({
      ledgerEntryId,
      transactionId: transaction.id,
      amount: transaction.money,
      occurredAt,
      insufficientFundsCode: transaction.requiresReference()
        ? FailureCode.ReversalWouldCauseNegativeBalance
        : FailureCode.InsufficientFunds,
    }),
  [LedgerDirection.Credit]: ({ wallet, ledgerEntryId, transaction, occurredAt }) =>
    wallet.credit({
      ledgerEntryId,
      transactionId: transaction.id,
      amount: transaction.money,
      occurredAt,
    }),
};

type ReferenceResolutionOutcome =
  | { readonly kind: "NONE" }
  | { readonly kind: "RESOLVED"; readonly reference: WagerTransaction }
  | { readonly kind: "PENDING_REFERENCE" }
  | { readonly kind: "REJECTED"; readonly failureCode: FailureCode };

type PersistenceMode = "insert" | "update";

const PERSIST_TRANSACTION_STRATEGIES: Readonly<
  Record<
    PersistenceMode,
    (txCtx: TransactionalContext, transaction: WagerTransaction) => Promise<void>
  >
> = {
  insert: (txCtx, transaction) => txCtx.wagerTransactions.insert(transaction),
  update: (txCtx, transaction) => txCtx.wagerTransactions.update(transaction),
};

const BASE_REFERENCE_BACKOFF_MS = 250;
const MAX_REFERENCE_BACKOFF_MS = 10_000;

@Injectable()
export class ProcessWagerTransactionUseCase {
  constructor(
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.LOGGER) private readonly logger: StructuredLoggerPort,
    @Inject(TOKENS.METRICS) private readonly metrics: MetricsPort,
  ) {}

  async execute(input: ProcessWagerTransactionInputDto): Promise<ProcessWagerTransactionOutputDto> {
    const startMs = performance.now();
    const money = Money.from(input.money);
    const providerId = input.providerId.trim();
    const externalTransactionId = input.externalTransactionId.trim();
    const effectiveIdempotencyKey =
      input.idempotencyKey !== undefined && input.idempotencyKey.trim().length > 0
        ? input.idempotencyKey.trim()
        : externalTransactionId;
    const referenceExternalTransactionId =
      input.referenceExternalTransactionId !== undefined &&
      input.referenceExternalTransactionId.trim().length > 0
        ? input.referenceExternalTransactionId.trim()
        : undefined;

    const payloadHash = CanonicalPayloadHasher.compute({
      providerId,
      externalTransactionId,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money,
      referenceExternalTransactionId,
    });

    const correlationId = input.correlationId ?? this.idGenerator.generate();
    const now = this.clock.now();

    try {
      return await this.unitOfWork.execute(async (txCtx) => {
        const inboxMessage = await this.prepareInboxMessageIfPresent(
          txCtx,
          input.inboxRegistration,
          now,
        );

        const preLockExisting = await this.findExistingTransaction(
          txCtx,
          providerId,
          externalTransactionId,
          effectiveIdempotencyKey,
        );
        if (preLockExisting !== null) {
          return this.buildIdempotentReplayResult(
            txCtx,
            preLockExisting,
            payloadHash,
            effectiveIdempotencyKey,
            inboxMessage,
            now,
          );
        }

        const wallet = await this.requireLockedWallet(txCtx, input.walletId);

        const postLockExisting = await this.findExistingTransaction(
          txCtx,
          providerId,
          externalTransactionId,
          effectiveIdempotencyKey,
        );
        if (postLockExisting !== null) {
          return this.buildIdempotentReplayResult(
            txCtx,
            postLockExisting,
            payloadHash,
            effectiveIdempotencyKey,
            inboxMessage,
            now,
          );
        }

        const candidateTx = WagerTransaction.create({
          id: this.idGenerator.generate(),
          providerId,
          externalTransactionId,
          idempotencyKey: effectiveIdempotencyKey,
          payloadHash,
          walletId: input.walletId.trim(),
          playerId: input.playerId.trim(),
          roundId: input.roundId.trim(),
          gameId: input.gameId.trim(),
          kind: input.kind,
          money,
          referenceExternalTransactionId,
          createdAt: now,
        });

        const result = await this.evaluateAndPersistOnLockedWallet({
          txCtx,
          wallet,
          transaction: candidateTx,
          persistenceMode: "insert",
          correlationId,
          causationId: input.causationId,
          now,
        });

        await this.markInboxMessageProcessedIfPresent(txCtx, inboxMessage, now);

        this.metrics.recordTransactionOutcome({
          kind: result.transaction.kind,
          status: result.transaction.status,
          failureCode: result.transaction.failureCode,
          durationSeconds: (performance.now() - startMs) / 1000,
        });

        return result;
      });
    } catch (error) {
      if (error instanceof WalletLockTimeoutError) {
        this.metrics.incrementLockConflict();
      }
      if (error instanceof DuplicateWagerKeyError || error instanceof DuplicateInboxMessageError) {
        return this.recoverFromConcurrentDuplicateKey(
          providerId,
          externalTransactionId,
          effectiveIdempotencyKey,
          payloadHash,
          input.inboxRegistration,
          now,
        );
      }
      throw error;
    }
  }

  async resolvePendingReferenceBatch(batchSize: number, maxAttempts: number): Promise<number> {
    const now = this.clock.now();
    const resolvedIds = await this.unitOfWork.execute(async (txCtx) => {
      const dueTransactions =
        await txCtx.wagerTransactions.findDuePendingReferenceForUpdateSkipLocked(now, batchSize);
      return dueTransactions.map((tx) => tx.id);
    });

    let processedCount = 0;
    for (const txId of resolvedIds) {
      const didResolve = await this.resolveSinglePendingReference(txId, maxAttempts);
      if (didResolve) {
        processedCount += 1;
      }
    }
    return processedCount;
  }

  private async resolveSinglePendingReference(
    transactionId: string,
    maxAttempts: number,
  ): Promise<boolean> {
    const now = this.clock.now();
    const correlationId = this.idGenerator.generate();

    return this.unitOfWork.execute(async (txCtx) => {
      const snapshot = await txCtx.wagerTransactions.findById(transactionId);
      if (snapshot === null || snapshot.status !== WagerTransactionStatus.PendingReference) {
        return false;
      }

      const wallet = await this.requireLockedWallet(txCtx, snapshot.walletId);
      const lockedTx = await txCtx.wagerTransactions.findById(transactionId);
      if (lockedTx === null || lockedTx.status !== WagerTransactionStatus.PendingReference) {
        return false;
      }
      if (lockedTx.nextReferenceAttemptAt !== undefined && lockedTx.nextReferenceAttemptAt > now) {
        return false;
      }
      if (lockedTx.nextReferenceAttemptAt !== undefined && lockedTx.nextReferenceAttemptAt > now) {
        return false;
      }

      await this.evaluateAndPersistOnLockedWallet({
        txCtx,
        wallet,
        transaction: lockedTx,
        persistenceMode: "update",
        correlationId,
        now,
        maxReferenceAttempts: maxAttempts,
      });

      return true;
    });
  }

  private async evaluateAndPersistOnLockedWallet(params: {
    readonly txCtx: TransactionalContext;
    readonly wallet: Wallet;
    readonly transaction: WagerTransaction;
    readonly persistenceMode: PersistenceMode;
    readonly correlationId: string;
    readonly causationId?: string | undefined;
    readonly now: Date;
    readonly maxReferenceAttempts?: number | undefined;
  }): Promise<ProcessWagerTransactionOutputDto> {
    const {
      txCtx,
      wallet,
      transaction,
      persistenceMode,
      correlationId,
      causationId,
      now,
      maxReferenceAttempts,
    } = params;

    const contextFailureCode = this.validateWalletContext(wallet, transaction);
    if (contextFailureCode !== undefined) {
      return this.finalizeRejected({
        txCtx,
        wallet,
        transaction,
        failureCode: contextFailureCode,
        persistenceMode,
        correlationId,
        causationId,
        now,
      });
    }

    const referenceOutcome = await this.resolveReferenceOutcome(
      txCtx,
      transaction,
      maxReferenceAttempts,
    );

    if (referenceOutcome.kind === "REJECTED") {
      return this.finalizeRejected({
        txCtx,
        wallet,
        transaction,
        failureCode: referenceOutcome.failureCode,
        persistenceMode,
        correlationId,
        causationId,
        now,
      });
    }

    if (referenceOutcome.kind === "PENDING_REFERENCE") {
      return this.finalizePendingReference({
        txCtx,
        wallet,
        transaction,
        persistenceMode,
        correlationId,
        causationId,
        now,
      });
    }

    const resolvedReference =
      referenceOutcome.kind === "RESOLVED" ? referenceOutcome.reference : undefined;

    if (!transaction.affectsBalance()) {
      return this.finalizeProcessedWithoutMovement({
        txCtx,
        wallet,
        transaction,
        referenceTransactionId: resolvedReference?.id,
        persistenceMode,
        correlationId,
        causationId,
        now,
      });
    }

    const direction = transaction.ledgerDirectionFor(resolvedReference);
    const movementStrategy = WALLET_MOVEMENT_STRATEGIES[direction];

    let ledgerEntry: WalletLedgerEntry;
    try {
      ledgerEntry = movementStrategy({
        wallet,
        ledgerEntryId: this.idGenerator.generate(),
        transaction,
        occurredAt: now,
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        return this.finalizeRejected({
          txCtx,
          wallet,
          transaction,
          failureCode: error.failureCode,
          persistenceMode,
          correlationId,
          causationId,
          now,
        });
      }
      throw error;
    }

    return this.finalizeProcessedWithMovement({
      txCtx,
      wallet,
      transaction,
      ledgerEntry,
      referenceTransactionId: resolvedReference?.id,
      persistenceMode,
      correlationId,
      causationId,
      now,
    });
  }

  private async resolveReferenceOutcome(
    txCtx: TransactionalContext,
    transaction: WagerTransaction,
    maxReferenceAttempts: number | undefined,
  ): Promise<ReferenceResolutionOutcome> {
    if (transaction.referenceExternalTransactionId === undefined) {
      return { kind: "NONE" };
    }

    const refCandidate = await txCtx.wagerTransactions.findByExternalTransactionId(
      transaction.providerId,
      transaction.referenceExternalTransactionId,
    );

    if (refCandidate === null) {
      if (!transaction.requiresReference()) {
        return { kind: "NONE" };
      }
      if (
        maxReferenceAttempts !== undefined &&
        transaction.referenceAttempts >= maxReferenceAttempts
      ) {
        return { kind: "REJECTED", failureCode: FailureCode.ReferenceNotFoundTimeout };
      }
      return { kind: "PENDING_REFERENCE" };
    }

    const refFailureCode = transaction.validateReferenceTarget(refCandidate);
    if (refFailureCode !== undefined) {
      return { kind: "REJECTED", failureCode: refFailureCode };
    }

    if (transaction.requiresReference()) {
      const existingReversal = await txCtx.wagerTransactions.findProcessedReversalByReferenceId(
        refCandidate.id,
      );
      if (existingReversal !== null) {
        return { kind: "REJECTED", failureCode: FailureCode.ReferenceAlreadyReversed };
      }
    }

    return { kind: "RESOLVED", reference: refCandidate };
  }

  private validateWalletContext(
    wallet: Wallet,
    transaction: WagerTransaction,
  ): FailureCode | undefined {
    if (wallet.playerId !== transaction.playerId) {
      return FailureCode.WalletOwnershipMismatch;
    }
    if (wallet.currency !== transaction.money.currency) {
      return FailureCode.CurrencyMismatch;
    }
    return undefined;
  }

  private async finalizeProcessedWithMovement(params: {
    readonly txCtx: TransactionalContext;
    readonly wallet: Wallet;
    readonly transaction: WagerTransaction;
    readonly ledgerEntry: WalletLedgerEntry;
    readonly referenceTransactionId: string | undefined;
    readonly persistenceMode: PersistenceMode;
    readonly correlationId: string;
    readonly causationId?: string | undefined;
    readonly now: Date;
  }): Promise<ProcessWagerTransactionOutputDto> {
    const {
      txCtx,
      wallet,
      transaction,
      ledgerEntry,
      referenceTransactionId,
      persistenceMode,
      correlationId,
      causationId,
      now,
    } = params;

    transaction.markProcessed(referenceTransactionId, now, wallet.balance);

    try {
      await PERSIST_TRANSACTION_STRATEGIES[persistenceMode](txCtx, transaction);
    } catch (error) {
      if (
        error instanceof DomainValidationError &&
        error.failureCode === FailureCode.ReferenceAlreadyReversed
      ) {
        throw error;
      }
      throw error;
    }

    await txCtx.wallets.update(wallet);
    await txCtx.ledgerEntries.insert(ledgerEntry);

    const balanceChangedEvent = WalletBalanceChanged.from(wallet, ledgerEntry, {
      eventId: this.idGenerator.generate(),
      correlationId,
      causationId,
      occurredAt: now,
    });

    const txProcessedEvent = WagerTransactionProcessed.from(transaction, wallet.balance.toJSON(), {
      eventId: this.idGenerator.generate(),
      correlationId,
      causationId: balanceChangedEvent.eventId,
      occurredAt: now,
    });

    await txCtx.outboxMessages.insertMany([
      OutboxMessage.enqueue({
        id: this.idGenerator.generate(),
        aggregateType: "Wallet",
        event: balanceChangedEvent,
      }),
      OutboxMessage.enqueue({
        id: this.idGenerator.generate(),
        aggregateType: "WagerTransaction",
        event: txProcessedEvent,
      }),
    ]);

    this.logger.info({
      event: "wager.transaction.processed",
      correlationId,
      transactionId: transaction.id,
      walletId: wallet.id,
      providerId: transaction.providerId,
      roundId: transaction.roundId,
      kind: transaction.kind,
      status: transaction.status,
      walletVersion: wallet.version,
    });

    return {
      transaction: transaction.toJSON(),
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
    };
  }

  private async finalizeProcessedWithoutMovement(params: {
    readonly txCtx: TransactionalContext;
    readonly wallet: Wallet;
    readonly transaction: WagerTransaction;
    readonly referenceTransactionId: string | undefined;
    readonly persistenceMode: PersistenceMode;
    readonly correlationId: string;
    readonly causationId?: string | undefined;
    readonly now: Date;
  }): Promise<ProcessWagerTransactionOutputDto> {
    const {
      txCtx,
      wallet,
      transaction,
      referenceTransactionId,
      persistenceMode,
      correlationId,
      causationId,
      now,
    } = params;

    transaction.markProcessed(referenceTransactionId, now, wallet.balance);
    await PERSIST_TRANSACTION_STRATEGIES[persistenceMode](txCtx, transaction);

    const txProcessedEvent = WagerTransactionProcessed.from(transaction, wallet.balance.toJSON(), {
      eventId: this.idGenerator.generate(),
      correlationId,
      causationId,
      occurredAt: now,
    });

    await txCtx.outboxMessages.insert(
      OutboxMessage.enqueue({
        id: this.idGenerator.generate(),
        aggregateType: "WagerTransaction",
        event: txProcessedEvent,
      }),
    );

    this.logger.info({
      event: "wager.transaction.processed",
      correlationId,
      transactionId: transaction.id,
      walletId: wallet.id,
      providerId: transaction.providerId,
      roundId: transaction.roundId,
      kind: transaction.kind,
      status: transaction.status,
      walletVersion: wallet.version,
    });

    return {
      transaction: transaction.toJSON(),
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
    };
  }

  private async finalizeRejected(params: {
    readonly txCtx: TransactionalContext;
    readonly wallet: Wallet;
    readonly transaction: WagerTransaction;
    readonly failureCode: FailureCode;
    readonly persistenceMode: PersistenceMode;
    readonly correlationId: string;
    readonly causationId?: string | undefined;
    readonly now: Date;
  }): Promise<ProcessWagerTransactionOutputDto> {
    const {
      txCtx,
      wallet,
      transaction,
      failureCode,
      persistenceMode,
      correlationId,
      causationId,
      now,
    } = params;

    const recordedBalance =
      wallet.currency === transaction.money.currency ? wallet.balance : undefined;
    transaction.reject(failureCode, now, recordedBalance);
    await PERSIST_TRANSACTION_STRATEGIES[persistenceMode](txCtx, transaction);

    const rejectedEvent = WagerTransactionRejected.from(transaction, {
      eventId: this.idGenerator.generate(),
      correlationId,
      causationId,
      occurredAt: now,
    });

    await txCtx.outboxMessages.insert(
      OutboxMessage.enqueue({
        id: this.idGenerator.generate(),
        aggregateType: "WagerTransaction",
        event: rejectedEvent,
      }),
    );

    this.logger.warn({
      event: "wager.transaction.rejected",
      correlationId,
      transactionId: transaction.id,
      walletId: wallet.id,
      providerId: transaction.providerId,
      roundId: transaction.roundId,
      kind: transaction.kind,
      status: transaction.status,
      failureCode,
    });

    return {
      transaction: transaction.toJSON(),
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
    };
  }

  private async finalizePendingReference(params: {
    readonly txCtx: TransactionalContext;
    readonly wallet: Wallet;
    readonly transaction: WagerTransaction;
    readonly persistenceMode: PersistenceMode;
    readonly correlationId: string;
    readonly causationId?: string | undefined;
    readonly now: Date;
  }): Promise<ProcessWagerTransactionOutputDto> {
    const { txCtx, wallet, transaction, persistenceMode, correlationId, causationId, now } = params;

    const nextAttemptDelayMs = Math.min(
      MAX_REFERENCE_BACKOFF_MS,
      BASE_REFERENCE_BACKOFF_MS * 2 ** transaction.referenceAttempts,
    );
    const nextAttemptAt = new Date(now.getTime() + nextAttemptDelayMs);

    transaction.markPendingReference(nextAttemptAt, now);
    await PERSIST_TRANSACTION_STRATEGIES[persistenceMode](txCtx, transaction);

    const pendingRefEvent = WagerTransactionPendingReference.from(transaction, {
      eventId: this.idGenerator.generate(),
      correlationId,
      causationId,
      occurredAt: now,
    });

    await txCtx.outboxMessages.insert(
      OutboxMessage.enqueue({
        id: this.idGenerator.generate(),
        aggregateType: "WagerTransaction",
        event: pendingRefEvent,
      }),
    );

    this.logger.info({
      event: "wager.transaction.pending_reference",
      correlationId,
      transactionId: transaction.id,
      walletId: wallet.id,
      providerId: transaction.providerId,
      roundId: transaction.roundId,
      kind: transaction.kind,
      status: transaction.status,
      attempts: transaction.referenceAttempts,
    });

    return {
      transaction: transaction.toJSON(),
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
    };
  }

  private async requireLockedWallet(
    txCtx: TransactionalContext,
    walletId: string,
  ): Promise<Wallet> {
    const wallet = await txCtx.wallets.findByIdForUpdate(walletId.trim());
    if (wallet === null) {
      throw new WalletNotFoundError(walletId);
    }
    return wallet;
  }

  private async findExistingTransaction(
    txCtx: TransactionalContext,
    providerId: string,
    externalTransactionId: string,
    idempotencyKey: string,
  ): Promise<WagerTransaction | null> {
    const byExternalId = await txCtx.wagerTransactions.findByExternalTransactionId(
      providerId,
      externalTransactionId,
    );
    if (byExternalId !== null) {
      return byExternalId;
    }
    if (idempotencyKey !== externalTransactionId) {
      return txCtx.wagerTransactions.findByIdempotencyKey(providerId, idempotencyKey);
    }
    return null;
  }

  private async buildIdempotentReplayResult(
    txCtx: TransactionalContext,
    existing: WagerTransaction,
    payloadHash: string,
    requestedIdempotencyKey: string,
    inboxMessage: InboxMessage | undefined,
    now: Date,
  ): Promise<ProcessWagerTransactionOutputDto> {
    if (!existing.matchesPayload(payloadHash)) {
      throw new IdempotencyConflictError(existing.providerId, requestedIdempotencyKey);
    }

    await this.markInboxMessageProcessedIfPresent(txCtx, inboxMessage, now);

    const wallet = await txCtx.wallets.findById(existing.walletId);
    const balance = existing.recordedBalance?.toJSON() ?? wallet?.balance.toJSON();

    this.metrics.incrementIdempotencyReplay(inboxMessage !== undefined ? "sqs" : "http");

    this.logger.info({
      event: "wager.transaction.idempotent_replay",
      transactionId: existing.id,
      walletId: existing.walletId,
      providerId: existing.providerId,
      roundId: existing.roundId,
      kind: existing.kind,
      status: existing.status,
    });

    return {
      transaction: existing.toJSON(),
      balance,
      idempotentReplay: true,
    };
  }

  private async prepareInboxMessageIfPresent(
    txCtx: TransactionalContext,
    registration: InboxMessageRegistrationDto | undefined,
    now: Date,
  ): Promise<InboxMessage | undefined> {
    if (registration === undefined) {
      return undefined;
    }

    const existingInbox = await txCtx.inboxMessages.findByKey(
      registration.consumerName,
      registration.messageId,
    );

    if (existingInbox !== null) {
      if (!existingInbox.matchesPayload(registration.payloadHash)) {
        throw new IdempotencyConflictError(registration.consumerName, registration.messageId);
      }
      return existingInbox;
    }

    const newInbox = InboxMessage.receive({
      consumerName: registration.consumerName,
      messageId: registration.messageId,
      payloadHash: registration.payloadHash,
      receivedAt: now,
    });

    await txCtx.inboxMessages.insert(newInbox);
    return newInbox;
  }

  private async markInboxMessageProcessedIfPresent(
    txCtx: TransactionalContext,
    inboxMessage: InboxMessage | undefined,
    now: Date,
  ): Promise<void> {
    if (inboxMessage === undefined || inboxMessage.isProcessed()) {
      return;
    }
    inboxMessage.markProcessed(now);
    await txCtx.inboxMessages.update(inboxMessage);
  }

  private async recoverFromConcurrentDuplicateKey(
    providerId: string,
    externalTransactionId: string,
    effectiveIdempotencyKey: string,
    payloadHash: string,
    inboxRegistration: InboxMessageRegistrationDto | undefined,
    now: Date,
  ): Promise<ProcessWagerTransactionOutputDto> {
    return this.unitOfWork.execute(async (txCtx) => {
      const inboxMessage = await this.prepareInboxMessageIfPresent(txCtx, inboxRegistration, now);
      const existing = await this.findExistingTransaction(
        txCtx,
        providerId,
        externalTransactionId,
        effectiveIdempotencyKey,
      );
      if (existing === null) {
        throw new IdempotencyConflictError(providerId, effectiveIdempotencyKey);
      }
      return this.buildIdempotentReplayResult(
        txCtx,
        existing,
        payloadHash,
        effectiveIdempotencyKey,
        inboxMessage,
        now,
      );
    });
  }
}
