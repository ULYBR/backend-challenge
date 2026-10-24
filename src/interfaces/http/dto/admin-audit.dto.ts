import type { SecurityAuditAccessEventDto } from "@application/dto/audit-trail.dto";

export interface AuditLogQueryResponseDto {
  readonly total: number;
  readonly events: readonly SecurityAuditAccessEventDto[];
}

export interface WalletAuditLogQueryResponseDto {
  readonly walletId: string;
  readonly total: number;
  readonly events: readonly SecurityAuditAccessEventDto[];
}
