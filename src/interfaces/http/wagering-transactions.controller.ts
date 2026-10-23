import type { GetWagerTransactionOutputDto } from "@application/dto/query-wallet.dto";
import { GetWagerTransactionUseCase, ProcessWagerTransactionUseCase } from "@application/use-cases";
import { WagerTransactionStatus } from "@domain/wagering/wager-transaction";
import { CorrelationContext } from "@infrastructure/observability/correlation-context";
import {
  type SubmitWagerTransactionRequestDto,
  type SubmitWagerTransactionResponseDto,
  submitWagerTransactionRequestSchema,
} from "@interfaces/http/dto/http.dto";
import { ZodValidationPipe } from "@interfaces/http/pipes/zod-validation.pipe";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

const WAGER_INITIAL_HTTP_STATUS: Readonly<Record<WagerTransactionStatus, number>> = {
  [WagerTransactionStatus.Processed]: HttpStatus.CREATED,
  [WagerTransactionStatus.PendingReference]: HttpStatus.ACCEPTED,
  [WagerTransactionStatus.Pending]: HttpStatus.ACCEPTED,
  [WagerTransactionStatus.Rejected]: HttpStatus.UNPROCESSABLE_ENTITY,
  [WagerTransactionStatus.Failed]: HttpStatus.INTERNAL_SERVER_ERROR,
};

@Controller()
export class WageringTransactionsController {
  constructor(
    private readonly processWagerUseCase: ProcessWagerTransactionUseCase,
    private readonly getWagerTransactionUseCase: GetWagerTransactionUseCase,
  ) {}

  @Post("wagering/transactions")
  async submitTransaction(
    @Headers("idempotency-key") idempotencyKeyHeader: string | undefined,
    @Body(new ZodValidationPipe(submitWagerTransactionRequestSchema))
    body: SubmitWagerTransactionRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SubmitWagerTransactionResponseDto> {
    const idempotencyKey = this.requireIdempotencyKeyHeader(idempotencyKeyHeader);
    const correlationId = CorrelationContext.get()?.correlationId;

    const result = await this.processWagerUseCase.execute({
      providerId: body.providerId,
      externalTransactionId: body.externalTransactionId,
      idempotencyKey,
      walletId: body.walletId,
      playerId: body.playerId,
      roundId: body.roundId,
      gameId: body.gameId,
      kind: body.kind,
      money: body.money,
      referenceExternalTransactionId: body.referenceExternalTransactionId,
      occurredAt: body.occurredAt,
      correlationId,
    });

    const statusCode = result.idempotentReplay
      ? HttpStatus.OK
      : WAGER_INITIAL_HTTP_STATUS[result.transaction.status];

    response.status(statusCode);

    return {
      transactionId: result.transaction.id,
      id: result.transaction.id,
      status: result.transaction.status,
      balance: result.balance,
      failureCode: result.transaction.failureCode ?? null,
      idempotentReplay: result.idempotentReplay,
      transaction: result.transaction,
    };
  }

  @Get("wagering/transactions/:transactionId")
  @HttpCode(HttpStatus.OK)
  async getTransactionById(
    @Param("transactionId", new ParseUUIDPipe()) transactionId: string,
  ): Promise<GetWagerTransactionOutputDto> {
    return this.getWagerTransactionUseCase.execute({ transactionId });
  }

  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  @HttpCode(HttpStatus.OK)
  async getTransactionByExternalId(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ): Promise<GetWagerTransactionOutputDto> {
    return this.getWagerTransactionUseCase.executeByExternalId({
      providerId,
      externalTransactionId,
    });
  }

  private requireIdempotencyKeyHeader(rawHeader: string | undefined): string {
    if (rawHeader === undefined || rawHeader.trim().length === 0) {
      throw new BadRequestException({
        code: "MISSING_IDEMPOTENCY_KEY",
        message: "Header 'Idempotency-Key' is required and cannot be empty",
      });
    }
    return rawHeader.trim();
  }
}
