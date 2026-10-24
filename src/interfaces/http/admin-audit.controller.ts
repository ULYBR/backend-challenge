import type { AuditQueryFiltersDto } from "@application/dto/audit-trail.dto";
import type { AuditTrailPort } from "@application/ports/audit-trail.port";
import { TOKENS } from "@application/ports/tokens";
import type {
  AuditLogQueryResponseDto,
  WalletAuditLogQueryResponseDto,
} from "@interfaces/http/dto/admin-audit.dto";
import { Controller, Get, Inject, Param, Query } from "@nestjs/common";

export type { AuditLogQueryResponseDto, WalletAuditLogQueryResponseDto };

@Controller(["admin/audit", "v1/api/admin/audit", "api/v1/admin/audit"])
export class AdminAuditController {
  constructor(
    @Inject(TOKENS.AUDIT_TRAIL_PORT)
    private readonly auditTrailPort: AuditTrailPort,
  ) {}

  @Get()
  async getAuditLogs(
    @Query("providerId") providerId?: string,
    @Query("walletId") walletId?: string,
    @Query("clientIp") clientIp?: string,
    @Query("statusCode") rawStatusCode?: string,
    @Query("since") since?: string,
    @Query("limit") rawLimit?: string,
  ): Promise<AuditLogQueryResponseDto> {
    const statusCode =
      rawStatusCode !== undefined && !Number.isNaN(Number(rawStatusCode))
        ? Number(rawStatusCode)
        : undefined;

    const limit =
      rawLimit !== undefined && !Number.isNaN(Number(rawLimit)) ? Number(rawLimit) : undefined;

    const filters: AuditQueryFiltersDto = {
      providerId,
      walletId,
      clientIp,
      statusCode,
      since,
      limit,
    };

    const events = await this.auditTrailPort.query(filters);
    return {
      total: events.length,
      events,
    };
  }

  @Get("wallets/:id")
  async getWalletAuditLogs(
    @Param("id") walletId: string,
    @Query("since") since?: string,
    @Query("limit") rawLimit?: string,
  ): Promise<WalletAuditLogQueryResponseDto> {
    const limit =
      rawLimit !== undefined && !Number.isNaN(Number(rawLimit)) ? Number(rawLimit) : undefined;

    const filters: AuditQueryFiltersDto = {
      walletId,
      since,
      limit,
    };

    const events = await this.auditTrailPort.query(filters);
    return {
      walletId,
      total: events.length,
      events,
    };
  }
}
