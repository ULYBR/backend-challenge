import type {
  PostgresErrorMetadata,
  RawPgError,
} from "@infrastructure/persistence/persistence.types";

export type { PostgresErrorMetadata };

export class PostgresErrorHelper {
  private constructor() {}

  static extract(error: unknown): PostgresErrorMetadata {
    const raw = PostgresErrorHelper.unwrap(error);
    const message = typeof raw.message === "string" ? raw.message : String(error);
    const code = typeof raw.code === "string" ? raw.code : undefined;
    const constraint =
      typeof raw.constraint === "string"
        ? raw.constraint
        : PostgresErrorHelper.extractConstraintFromMessage(message);
    const detail = typeof raw.detail === "string" ? raw.detail : undefined;

    return {
      code,
      constraint,
      detail,
      message,
    };
  }

  static isUniqueViolation(error: unknown, constraintName?: string): boolean {
    const metadata = PostgresErrorHelper.extract(error);
    const isUniqueCode =
      metadata.code === "23505" || metadata.message.includes("duplicate key value");
    if (!isUniqueCode) {
      return false;
    }
    if (constraintName === undefined) {
      return true;
    }
    return metadata.constraint === constraintName || metadata.message.includes(constraintName);
  }

  static isLockTimeout(error: unknown): boolean {
    const metadata = PostgresErrorHelper.extract(error);
    return metadata.code === "55P03" || metadata.message.includes("lock timeout");
  }

  private static unwrap(error: unknown): RawPgError {
    if (typeof error !== "object" || error === null) {
      return { message: String(error) };
    }
    const candidate = error as RawPgError;
    if (typeof candidate.code === "string" || typeof candidate.constraint === "string") {
      return candidate;
    }
    if (typeof candidate.cause === "object" && candidate.cause !== null) {
      return candidate.cause as RawPgError;
    }
    return candidate;
  }

  private static extractConstraintFromMessage(message: string): string | undefined {
    const match = /constraint "([^"]+)"/.exec(message);
    return match?.[1];
  }
}
