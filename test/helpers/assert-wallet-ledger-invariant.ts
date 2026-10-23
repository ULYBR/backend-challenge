import { expect } from "bun:test";
import { ReconcileWalletUseCase } from "@application/use-cases/reconcile-wallet.use-case";
import { EntityManager } from "@mikro-orm/postgresql";

export async function assertAllWalletsMatchLedger(
  em: EntityManager,
  reconcileUseCase: ReconcileWalletUseCase,
): Promise<void> {
  const walletRows = await em.execute<Array<{ readonly id: string }>>(
    "SELECT id FROM wallets ORDER BY created_at ASC",
  );

  for (const row of walletRows) {
    const report = await reconcileUseCase.execute({ walletId: row.id });
    expect(report.consistent).toBe(true);
    expect(report.walletBalance).toEqual(report.reconstructedBalance);
  }
}
