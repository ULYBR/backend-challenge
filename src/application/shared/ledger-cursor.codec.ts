import type { LedgerCursorPayload } from "@application/shared/ledger-cursor.types";
import { InvalidPaginationCursorError } from "@domain/shared/domain-errors";

export type { LedgerCursorPayload };

export class LedgerCursorCodec {
  private constructor() {}

  static encode(payload: LedgerCursorPayload): string {
    return Buffer.from(
      JSON.stringify({
        createdAt: payload.createdAt,
        id: payload.id,
      }),
      "utf8",
    ).toString("base64url");
  }

  static decode(cursor: string): LedgerCursorPayload {
    try {
      const decodedJson = Buffer.from(cursor, "base64url").toString("utf8");
      const parsed = JSON.parse(decodedJson) as Partial<LedgerCursorPayload>;
      LedgerCursorCodec.assertValidCursorPayload(parsed);
      return {
        createdAt: parsed.createdAt as string,
        id: parsed.id as string,
      };
    } catch (error) {
      if (error instanceof InvalidPaginationCursorError) {
        throw error;
      }
      throw new InvalidPaginationCursorError("malformed base64url JSON cursor");
    }
  }

  private static assertValidCursorPayload(parsed: Partial<LedgerCursorPayload>): void {
    const hasValidCreatedAt =
      typeof parsed.createdAt === "string" && !Number.isNaN(Date.parse(parsed.createdAt));
    const hasValidId =
      typeof parsed.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id);

    if (!hasValidCreatedAt || !hasValidId) {
      throw new InvalidPaginationCursorError("missing or invalid createdAt/id fields");
    }
  }
}
