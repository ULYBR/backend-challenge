export interface SecurityAuditAccessEventDto {
  readonly id: string;
  readonly timestamp: string;
  readonly clientIp: string;
  readonly providerId: string | null;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly correlationId: string;
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly userAgent: string;
  readonly failureCode?: string | undefined;
  readonly walletId?: string | undefined;
}

export interface AuditQueryFiltersDto {
  readonly providerId?: string | undefined;
  readonly walletId?: string | undefined;
  readonly clientIp?: string | undefined;
  readonly statusCode?: number | undefined;
  readonly since?: string | undefined;
  readonly limit?: number | undefined;
}
