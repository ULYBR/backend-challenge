import { describe, expect, it } from "bun:test";
import { DomainValidationError } from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import { ZodValidationPipe } from "@interfaces/http/pipes/zod-validation.pipe";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

describe("ZodValidationPipe", () => {
  const schema = z.object({
    playerId: z.string().min(1),
    money: z.object({
      amount: z.string().regex(/^\d+\.\d{2}$/),
      currency: z.string().length(3),
    }),
    initialBalance: z
      .object({
        amount: z.string().regex(/^\d+\.\d{2}$/),
        currency: z.string().length(3),
      })
      .optional(),
  });

  const pipe = new ZodValidationPipe(schema);

  it("passes through valid payload successfully", () => {
    const valid = {
      playerId: "p-1",
      money: { amount: "10.00", currency: "BRL" },
    };
    const result = pipe.transform(valid);
    expect(result).toEqual(valid);
  });

  it("maps currency validation failure to DomainValidationError with InvalidCurrencyCode", () => {
    const invalidCurrency = {
      playerId: "p-1",
      money: { amount: "10.00", currency: "INVALID_LENGTH" },
    };

    expect(() => pipe.transform(invalidCurrency)).toThrow(DomainValidationError);
    try {
      pipe.transform(invalidCurrency);
    } catch (err) {
      const domainErr = err as DomainValidationError;
      expect(domainErr.failureCode).toBe(FailureCode.InvalidCurrencyCode);
    }
  });

  it("maps initialBalance currency validation failure to DomainValidationError", () => {
    const invalidInitialCurrency = {
      playerId: "p-1",
      money: { amount: "10.00", currency: "BRL" },
      initialBalance: { amount: "10.00", currency: "TOOLONG" },
    };

    try {
      pipe.transform(invalidInitialCurrency);
    } catch (err) {
      const domainErr = err as DomainValidationError;
      expect(domainErr.failureCode).toBe(FailureCode.InvalidCurrencyCode);
    }
  });

  it("maps amount validation failure to DomainValidationError with InvalidMoneyAmount", () => {
    const invalidAmount = {
      playerId: "p-1",
      money: { amount: "not-a-number", currency: "BRL" },
    };

    try {
      pipe.transform(invalidAmount);
    } catch (err) {
      const domainErr = err as DomainValidationError;
      expect(domainErr.failureCode).toBe(FailureCode.InvalidMoneyAmount);
    }
  });

  it("throws standard BadRequestException for general non-monetary validation errors", () => {
    const missingPlayer = {
      playerId: "",
      money: { amount: "10.00", currency: "BRL" },
    };

    expect(() => pipe.transform(missingPlayer)).toThrow(BadRequestException);
    try {
      pipe.transform(missingPlayer);
    } catch (err) {
      const badReq = err as BadRequestException;
      const resp = badReq.getResponse() as { code: string; message: string };
      expect(resp.code).toBe("VALIDATION_ERROR");
    }
  });
});
