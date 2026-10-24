import type {
  AuditQueryFiltersDto,
  SecurityAuditAccessEventDto,
} from "@application/dto/audit-trail.dto";
import type { AuditTrailPort } from "@application/ports/audit-trail.port";
import { Injectable } from "@nestjs/common";

const DEFAULT_BUFFER_CAPACITY = 10_000;
const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 200;

@Injectable()
export class InMemoryRingBufferAuditTrailAdapter implements AuditTrailPort {
  private readonly buffer: SecurityAuditAccessEventDto[] = [];
  private readonly capacity: number;

  constructor(capacity: number = DEFAULT_BUFFER_CAPACITY) {
    this.capacity = capacity;
  }

  async record(event: SecurityAuditAccessEventDto): Promise<void> {
    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();
    }
    this.buffer.push(event);
  }

  async query(filters: AuditQueryFiltersDto): Promise<readonly SecurityAuditAccessEventDto[]> {
    const limit = Math.min(Math.max(1, filters.limit ?? DEFAULT_QUERY_LIMIT), MAX_QUERY_LIMIT);

    const sinceDate = filters.since !== undefined ? new Date(filters.since).getTime() : 0;

    const matched: SecurityAuditAccessEventDto[] = [];

    for (let i = this.buffer.length - 1; i >= 0 && matched.length < limit; i--) {
      const item = this.buffer[i];
      if (item === undefined) {
        continue;
      }

      if (sinceDate > 0 && new Date(item.timestamp).getTime() < sinceDate) {
        continue;
      }

      if (filters.providerId !== undefined && filters.providerId.trim().length > 0) {
        if (
          item.providerId === null ||
          !item.providerId.toLowerCase().includes(filters.providerId.trim().toLowerCase())
        ) {
          continue;
        }
      }

      if (filters.walletId !== undefined && filters.walletId.trim().length > 0) {
        if (item.walletId !== filters.walletId.trim()) {
          continue;
        }
      }

      if (filters.clientIp !== undefined && filters.clientIp.trim().length > 0) {
        if (!item.clientIp.startsWith(filters.clientIp.trim())) {
          continue;
        }
      }

      if (filters.statusCode !== undefined && item.statusCode !== filters.statusCode) {
        continue;
      }

      matched.push(item);
    }

    return matched;
  }

  get totalRecorded(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer.length = 0;
  }
}
