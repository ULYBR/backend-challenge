import type { TransactionalContext } from "@application/ports/unit-of-work.types";

export type { TransactionalContext };

export interface UnitOfWorkPort {
  execute<T>(work: (tx: TransactionalContext) => Promise<T>): Promise<T>;
}
