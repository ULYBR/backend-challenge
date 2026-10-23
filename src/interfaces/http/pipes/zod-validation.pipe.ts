import { DomainValidationError } from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import { ZodError, type ZodSchema } from "zod";

const ZOD_FIELD_FAILURE_CODE_MAP: Readonly<Record<string, FailureCode>> = {
  "money.currency": FailureCode.InvalidCurrencyCode,
  "initialBalance.currency": FailureCode.InvalidCurrencyCode,
  "money.amount": FailureCode.InvalidMoneyAmount,
  "initialBalance.amount": FailureCode.InvalidMoneyAmount,
};

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }

    const mappedDomainCode = this.resolveDomainFailureCode(parsed.error);
    if (mappedDomainCode !== undefined) {
      throw new DomainValidationError(
        mappedDomainCode,
        parsed.error.issues.map((issue) => issue.message).join("; "),
        { issues: parsed.error.issues },
      );
    }

    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: parsed.error.issues.map((issue) => issue.message).join("; "),
      issues: parsed.error.issues,
    });
  }

  private resolveDomainFailureCode(error: ZodError): FailureCode | undefined {
    for (const issue of error.issues) {
      const pathKey = issue.path.join(".");
      const code = ZOD_FIELD_FAILURE_CODE_MAP[pathKey];
      if (code !== undefined) {
        return code;
      }
    }
    return undefined;
  }
}
