import { describe, expect, it } from "bun:test";
import { StructuredLoggerPort } from "@application/ports/structured-logger.port";
import { FailureCode } from "@domain/shared/failure-code";
import { CorrelationContext } from "@infrastructure/observability/correlation-context";
import { DomainExceptionFilter } from "@interfaces/http/filters/domain-exception.filter";
import { ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";

describe("DomainExceptionFilter", () => {
  const mockLogger: StructuredLoggerPort = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  const filter = new DomainExceptionFilter(mockLogger);

  function createMockHost() {
    let statusCode = 200;
    let jsonBody: unknown = null;

    const res = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (body: unknown) => {
        jsonBody = body;
        return res;
      },
    };

    const req = {
      headers: {},
    };

    const host = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ArgumentsHost;

    return { host, getResult: () => ({ statusCode, jsonBody }) };
  }

  it("handles standard HttpException with plain string response", () => {
    const { host, getResult } = createMockHost();
    const exception = new HttpException("Plain error message", HttpStatus.BAD_REQUEST);

    CorrelationContext.run({ correlationId: "corr-1" }, () => {
      filter.catch(exception, host);
    });

    const result = getResult();
    expect(result.statusCode).toBe(400);
    const body = result.jsonBody as { error: { message: string; correlationId: string } };
    expect(body.error.message).toBe("Plain error message");
    expect(body.error.correlationId).toBe("corr-1");
  });

  it("handles unhandled non-Http non-Domain unexpected errors as 500", () => {
    const { host, getResult } = createMockHost();
    const exception = new Error("Database driver segmentation fault");

    filter.catch(exception, host);

    const result = getResult();
    expect(result.statusCode).toBe(500);
    const body = result.jsonBody as { error: { code: string; message: string } };
    expect(body.error.code).toBe(FailureCode.InfrastructurePermanentFailure);
    expect(body.error.message).toBe("Internal server error");
  });

  it("handles primitive throwables (string/number) as 500", () => {
    const { host, getResult } = createMockHost();

    filter.catch("unexpected string throw", host);

    const result = getResult();
    expect(result.statusCode).toBe(500);
  });
});
