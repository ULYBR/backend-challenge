import { describe, expect, it } from "bun:test";
import { PostgresErrorHelper } from "@infrastructure/persistence/postgres-error.helper";

describe("PostgresErrorHelper", () => {
  it("extracts metadata from string and primitive errors", () => {
    const meta = PostgresErrorHelper.extract("simple error string");
    expect(meta.message).toBe("simple error string");
    expect(meta.code).toBeUndefined();
    expect(meta.constraint).toBeUndefined();

    const nullMeta = PostgresErrorHelper.extract(null);
    expect(nullMeta.message).toBe("null");

    const numberMeta = PostgresErrorHelper.extract(12345);
    expect(numberMeta.message).toBe("12345");
  });

  it("extracts metadata from error objects with direct properties", () => {
    const errorObj = {
      code: "23505",
      constraint: "uq_wallets__player_currency",
      detail: "Key already exists",
      message: "duplicate key value violates unique constraint",
    };
    const meta = PostgresErrorHelper.extract(errorObj);
    expect(meta.code).toBe("23505");
    expect(meta.constraint).toBe("uq_wallets__player_currency");
    expect(meta.detail).toBe("Key already exists");
    expect(meta.message).toBe("duplicate key value violates unique constraint");
  });

  it("extracts metadata from nested cause property", () => {
    const wrapper = {
      message: "DriverError",
      cause: {
        code: "55P03",
        message: "canceling statement due to lock timeout",
      },
    };
    const meta = PostgresErrorHelper.extract(wrapper);
    expect(meta.code).toBe("55P03");
    expect(meta.message).toBe("canceling statement due to lock timeout");
  });

  it("extracts constraint name from message regex when constraint property is missing", () => {
    const errorWithoutConstraint = {
      code: "23505",
      message: 'duplicate key violates unique constraint "uq_custom_constraint_name"',
    };
    const meta = PostgresErrorHelper.extract(errorWithoutConstraint);
    expect(meta.constraint).toBe("uq_custom_constraint_name");
  });

  it("identifies unique violations correctly by code and constraint", () => {
    const uniqueByCode = { code: "23505", constraint: "uq_test" };
    expect(PostgresErrorHelper.isUniqueViolation(uniqueByCode)).toBe(true);
    expect(PostgresErrorHelper.isUniqueViolation(uniqueByCode, "uq_test")).toBe(true);
    expect(PostgresErrorHelper.isUniqueViolation(uniqueByCode, "uq_other")).toBe(false);

    const uniqueByMsg = {
      message: 'duplicate key value violates unique constraint "uq_msg_check"',
    };
    expect(PostgresErrorHelper.isUniqueViolation(uniqueByMsg)).toBe(true);
    expect(PostgresErrorHelper.isUniqueViolation(uniqueByMsg, "uq_msg_check")).toBe(true);

    const nonUnique = { code: "42P01", message: "relation does not exist" };
    expect(PostgresErrorHelper.isUniqueViolation(nonUnique)).toBe(false);
  });

  it("identifies lock timeouts correctly by code and message", () => {
    const timeoutByCode = { code: "55P03", message: "timeout" };
    expect(PostgresErrorHelper.isLockTimeout(timeoutByCode)).toBe(true);

    const timeoutByMsg = { message: "statement canceled due to lock timeout" };
    expect(PostgresErrorHelper.isLockTimeout(timeoutByMsg)).toBe(true);

    const otherError = { code: "23505", message: "duplicate" };
    expect(PostgresErrorHelper.isLockTimeout(otherError)).toBe(false);
  });
});
