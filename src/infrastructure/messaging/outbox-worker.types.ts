export interface OutboxPublishBatchResultDto {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
}
