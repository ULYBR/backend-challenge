import type {
  ReconcileWalletInputDto,
  ReconcileWalletOutputDto,
} from "@application/dto/reconcile-wallet.dto";
import type { MetricsPort } from "@application/ports/metrics.port";
import type { StructuredLoggerPort } from "@application/ports/structured-logger.port";
import { TOKENS } from "@application/ports/tokens";
import type { WalletLedgerRepositoryPort } from "@application/ports/wallet-ledger-repository.port";
import type { WalletRepositoryPort } from "@application/ports/wallet-repository.port";
import { WalletNotFoundError } from "@domain/shared/domain-errors";
import { Money } from "@domain/shared/money";
import { LedgerDirection } from "@domain/wallet/ledger-direction";
import { WalletLedgerEntry } from "@domain/wallet/wallet-ledger-entry";
import { Inject, Injectable } from "@nestjs/common";

const LEDGER_RECONSTRUCTION_STRATEGIES: Readonly<
  Record<LedgerDirection, (runningBalance: Money, amount: Money) => Money>
> = {
  [LedgerDirection.Credit]: (runningBalance, amount) => runningBalance.add(amount),
  [LedgerDirection.Debit]: (runningBalance, amount) => runningBalance.subtract(amount),
};

@Injectable()
export class ReconcileWalletUseCase {
  constructor(
    @Inject(TOKENS.WALLET_REPOSITORY)
    private readonly walletRepository: WalletRepositoryPort,
    @Inject(TOKENS.WALLET_LEDGER_REPOSITORY)
    private readonly ledgerRepository: WalletLedgerRepositoryPort,
    @Inject(TOKENS.LOGGER)
    private readonly logger: StructuredLoggerPort,
    @Inject(TOKENS.METRICS)
    private readonly metrics: MetricsPort,
  ) {}

  async execute(input: ReconcileWalletInputDto): Promise<ReconcileWalletOutputDto> {
    const wallet = await this.walletRepository.findById(input.walletId.trim());
    if (wallet === null) {
      throw new WalletNotFoundError(input.walletId);
    }

    const entries = await this.ledgerRepository.listAllByWalletChronological(wallet.id);
    const { reconstructedBalance, chainValid, lastVersion } = this.reconstructLedgerChain(
      wallet.currency,
      entries,
    );

    const versionMatches =
      entries.length === 0 ? wallet.version === 1 : lastVersion === wallet.version;
    const balanceMatches = wallet.balance.equals(reconstructedBalance);
    const consistent = chainValid && versionMatches && balanceMatches;

    if (!consistent) {
      this.metrics.incrementReconciliationInconsistency();
      this.logger.error({
        event: "wallet.reconciliation.inconsistent",
        walletId: wallet.id,
        entryCount: entries.length,
        walletVersion: wallet.version,
        lastLedgerVersion: lastVersion,
      });
    }

    const difference = wallet.balance.subtract(reconstructedBalance).toJSON();

    return {
      walletId: wallet.id,
      consistent,
      storedBalance: wallet.balance.toJSON(),
      calculatedBalance: reconstructedBalance.toJSON(),
      difference,
      checkedEntries: entries.length,
      walletBalance: wallet.balance.toJSON(),
      reconstructedBalance: reconstructedBalance.toJSON(),
      entryCount: entries.length,
      lastVersion,
    };
  }

  private reconstructLedgerChain(
    currency: string,
    entries: readonly WalletLedgerEntry[],
  ): {
    readonly reconstructedBalance: Money;
    readonly chainValid: boolean;
    readonly lastVersion: number;
  } {
    let runningBalance = Money.zero(currency);
    let chainValid = true;
    let expectedVersion = 1;

    for (const entry of entries) {
      const nextBalance = LEDGER_RECONSTRUCTION_STRATEGIES[entry.direction](
        runningBalance,
        entry.money,
      );

      const stepValid =
        entry.isBalanced() &&
        entry.walletVersion === expectedVersion &&
        entry.balanceBefore.equals(runningBalance) &&
        entry.balanceAfter.equals(nextBalance);

      if (!stepValid) {
        chainValid = false;
      }

      runningBalance = nextBalance;
      expectedVersion += 1;
    }

    const lastEntry = entries[entries.length - 1];
    return {
      reconstructedBalance: runningBalance,
      chainValid,
      lastVersion: lastEntry !== undefined ? lastEntry.walletVersion : 1,
    };
  }
}
