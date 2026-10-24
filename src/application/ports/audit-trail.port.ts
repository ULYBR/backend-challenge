import type {
  AuditQueryFiltersDto,
  SecurityAuditAccessEventDto,
} from "@application/dto/audit-trail.dto";

export type { AuditQueryFiltersDto, SecurityAuditAccessEventDto };

export interface AuditTrailPort {
  record(event: SecurityAuditAccessEventDto): Promise<void>;
  query(filters: AuditQueryFiltersDto): Promise<readonly SecurityAuditAccessEventDto[]>;
}
