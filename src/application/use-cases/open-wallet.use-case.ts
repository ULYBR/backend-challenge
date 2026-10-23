import type { OpenWalletInputDto, OpenWalletOutputDto } from "@application/dto/open-wallet.dto";
import type { ClockPort } from "@application/ports/clock.port";
import type { IdGeneratorPort } from "@application/ports/id-generator.port";
import type { StructuredLoggerPort } from "@application/ports/structured-logger.port";
import { TOKENS } from "@application/ports/tokens";
import type { TransactionalContext, UnitOfWorkPort } from "@application/ports/unit-of-work.port";
import { CanonicalPayloadHasher } from "@application/shared/canonical-payload-hasher";
import { WalletBalanceChanged } from "@domain/messaging/integration-event";
import { OutboxMessage } from "@domain/messaging/outbox-message";
import { WalletAlreadyExistsError } from "@domain/shared/domain-errors";
import { Money } from "@domain/shared/money";
import { WagerTransaction } from "@domain/wagering/wager-transaction";
import { Wallet } from "@domain/wallet/wallet";
import { Inject, Injectable } from "@nestjs/common";

@Injectable()
export class OpenWalletUseCase {
  constructor(
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.LOGGER) private readonly logger: StructuredLoggerPort,
  ) {}

  async execute(input: OpenWalletInputDto): Promise<OpenWalletOutputDto> {
    const initialBalance = Money.from(input.initialBalance);
    const now = this.clock.now();
    const correlationId = input.correlationId ?? this.idGenerator.generate();

    const wallet = await this.unitOfWork.execute(async (tx) => {
      await this.assertWalletDoesNotExist(tx, input.playerId, initialBalance.currency);

      const newWallet = Wallet.open({
        id: this.idGenerator.generate(),
        playerId: input.playerId,
        initialBalance,
        createdAt: now,
      });

      await tx.wallets.insert(newWallet);

      if (initialBalance.isPositive()) {
        await this.recordOpeningBalanceMovement(tx, newWallet, correlationId, now);
      }

      return newWallet;
    });

    this.logger.info({
      event: "wallet.opened",
      correlationId,
      walletId: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      version: wallet.version,
    });

    return wallet.toJSON();
  }

  private async assertWalletDoesNotExist(
    tx: TransactionalContext,
    playerId: string,
    currency: string,
  ): Promise<void> {
    const existing = await tx.wallets.findByPlayerAndCurrency(playerId, currency);
    if (existing !== null) {
      throw new WalletAlreadyExistsError(playerId, currency);
    }
  }

  private async recordOpeningBalanceMovement(
    tx: TransactionalContext,
    wallet: Wallet,
    correlationId: string,
    now: Date,
  ): Promise<void> {
    const openingTxId = this.idGenerator.generate();
    const payloadHash = CanonicalPayloadHasher.computeOpening(
      wallet.id,
      wallet.playerId,
      wallet.balance,
    );

    const openingTx = WagerTransaction.createOpening({
      id: openingTxId,
      walletId: wallet.id,
      playerId: wallet.playerId,
      initialBalance: wallet.balance,
      payloadHash,
      createdAt: now,
    });

    await tx.wagerTransactions.insert(openingTx);

    const openingEntry = wallet.createOpeningLedgerEntry({
      ledgerEntryId: this.idGenerator.generate(),
      transactionId: openingTx.id,
      occurredAt: now,
    });

    await tx.ledgerEntries.insert(openingEntry);

    const balanceChangedEvent = WalletBalanceChanged.from(wallet, openingEntry, {
      eventId: this.idGenerator.generate(),
      correlationId,
      occurredAt: now,
    });

    const outboxMessage = OutboxMessage.enqueue({
      id: this.idGenerator.generate(),
      aggregateType: "Wallet",
      event: balanceChangedEvent,
    });

    await tx.outboxMessages.insert(outboxMessage);
  }
}
