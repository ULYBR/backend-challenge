import type { StructuredLoggerPort } from "@application/ports/structured-logger.port";
import { TOKENS } from "@application/ports/tokens";
import { DomainError } from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import { CorrelationContext } from "@infrastructure/observability/correlation-context";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from "@nestjs/common";
import type { Response } from "express";

export const FAILURE_CODE_HTTP_STATUS: Readonly<Record<FailureCode, number>> = {
  [FailureCode.InvalidMoneyAmount]: HttpStatus.BAD_REQUEST,
  [FailureCode.InvalidCurrencyCode]: HttpStatus.BAD_REQUEST,
  [FailureCode.OpeningKindForbiddenExternally]: HttpStatus.BAD_REQUEST,
  [FailureCode.MissingReferenceTransaction]: HttpStatus.BAD_REQUEST,
  [FailureCode.InvalidPaginationCursor]: HttpStatus.BAD_REQUEST,
  [FailureCode.WalletNotFound]: HttpStatus.NOT_FOUND,
  [FailureCode.TransactionNotFound]: HttpStatus.NOT_FOUND,
  [FailureCode.WalletAlreadyExists]: HttpStatus.CONFLICT,
  [FailureCode.IdempotencyPayloadConflict]: HttpStatus.CONFLICT,
  [FailureCode.InvalidTransactionStateTransition]: HttpStatus.CONFLICT,
  [FailureCode.InsufficientFunds]: HttpStatus.UNPROCESSABLE_ENTITY,
  [FailureCode.ReversalWouldCauseNegativeBalance]: HttpStatus.UNPROCESSABLE_ENTITY,
  [FailureCode.CurrencyMismatch]: HttpStatus.UNPROCESSABLE_ENTITY,
  [FailureCode.WalletOwnershipMismatch]: HttpStatus.UNPROCESSABLE_ENTITY,
  [FailureCode.ReferenceNotFoundTimeout]: HttpStatus.UNPROCESSABLE_ENTITY,
  [FailureCode.ReferenceNotProcessed]: HttpStatus.UNPROCESSABLE_ENTITY,
  [FailureCode.InvalidReferenceKind]: HttpStatus.UNPROCESSABLE_ENTITY,
  [FailureCode.ReferenceContextMismatch]: HttpStatus.UNPROCESSABLE_ENTITY,
  [FailureCode.ReferenceAmountMismatch]: HttpStatus.UNPROCESSABLE_ENTITY,
  [FailureCode.ReferenceAlreadyReversed]: HttpStatus.UNPROCESSABLE_ENTITY,
  [FailureCode.LedgerEntryUnbalanced]: HttpStatus.INTERNAL_SERVER_ERROR,
  [FailureCode.LedgerInconsistencyDetected]: HttpStatus.INTERNAL_SERVER_ERROR,
  [FailureCode.InfrastructurePermanentFailure]: HttpStatus.INTERNAL_SERVER_ERROR,
  [FailureCode.WalletLockTimeout]: HttpStatus.SERVICE_UNAVAILABLE,
};

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(@Inject(TOKENS.LOGGER) private readonly logger: StructuredLoggerPort) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const correlationId = CorrelationContext.get()?.correlationId;

    if (exception instanceof DomainError) {
      const status =
        FAILURE_CODE_HTTP_STATUS[exception.failureCode] ?? HttpStatus.INTERNAL_SERVER_ERROR;

      this.logger.warn({
        event: "http.request.domain_error",
        correlationId,
        failureCode: exception.failureCode,
        statusCode: status,
      });

      response.status(status).json({
        error: {
          code: exception.failureCode,
          failureCode: exception.failureCode,
          message: exception.message,
          correlationId,
          details: exception.metadata,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const extracted =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)
          : { message: String(body) };
      const code = typeof extracted.code === "string" ? extracted.code : "HTTP_REQUEST_ERROR";
      const message = typeof extracted.message === "string" ? extracted.message : exception.message;

      response.status(status).json({
        error: {
          code,
          failureCode: code,
          message,
          correlationId,
          details: extracted.issues,
        },
      });
      return;
    }

    this.logger.error({
      event: "http.request.unhandled_exception",
      correlationId,
      errorName: exception instanceof Error ? exception.name : "UnknownError",
      errorMessage: exception instanceof Error ? exception.message : String(exception),
    });

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: FailureCode.InfrastructurePermanentFailure,
        failureCode: FailureCode.InfrastructurePermanentFailure,
        message: "Internal server error",
        correlationId,
      },
    });
  }
}
