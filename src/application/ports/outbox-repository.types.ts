export interface ClaimOutboxBatchOptions {
  readonly workerId: string;
  readonly now: Date;
  readonly leaseUntil: Date;
  readonly limit: number;
}
