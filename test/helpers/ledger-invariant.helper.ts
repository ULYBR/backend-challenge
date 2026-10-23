import { expect } from "bun:test";
import { EntityManager } from "@mikro-orm/postgresql";

export interface ReconciledWalletRow {
  readonly wallet_id: string;
  readonly stored_balance: string;
  readonly calculated_balance: string;
  readonly diff: string;
}

export async function assertAllWalletsMatchLedger(
  em: EntityManager,
  walletId?: string,
): Promise<void> {
  const filterSql = walletId !== undefined ? `WHERE w.id = '${walletId}'` : "";
  const rows = await em.getConnection().execute<ReconciledWalletRow[]>(`
    SELECT
      w.id AS wallet_id,
      w.balance::text AS stored_balance,
      COALESCE(
        SUM(
          CASE
            WHEN l.direction = 'CREDIT' THEN l.amount
            WHEN l.direction = 'DEBIT' THEN -l.amount
            ELSE 0
          END
        ),
        0.00
      )::numeric(19,2)::text AS calculated_balance,
      (
        w.balance - COALESCE(
          SUM(
            CASE
              WHEN l.direction = 'CREDIT' THEN l.amount
              WHEN l.direction = 'DEBIT' THEN -l.amount
              ELSE 0
            END
          ),
          0.00
        )
      )::numeric(19,2)::text AS diff
    FROM wallets w
    LEFT JOIN wallet_ledger_entries l ON l.wallet_id = w.id
    ${filterSql}
    GROUP BY w.id, w.balance
  `);

  for (const row of rows) {
    expect(row.diff).toBe("0.00");
    expect(row.stored_balance).toBe(row.calculated_balance);
  }
}
