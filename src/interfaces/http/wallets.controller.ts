import {
  GetWalletUseCase,
  ListWalletLedgerUseCase,
  OpenWalletUseCase,
  ReconcileWalletUseCase,
} from "@application/use-cases";
import { CorrelationContext } from "@infrastructure/observability/correlation-context";
import {
  type ListWalletLedgerResponseDto,
  type OpenWalletRequestDto,
  type OpenWalletResponseDto,
  type ReconcileWalletResponseDto,
  listWalletLedgerQuerySchema,
  openWalletRequestSchema,
} from "@interfaces/http/dto/http.dto";
import { ZodValidationPipe } from "@interfaces/http/pipes/zod-validation.pipe";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";

@Controller("wallets")
export class WalletsController {
  constructor(
    private readonly openWalletUseCase: OpenWalletUseCase,
    private readonly getWalletUseCase: GetWalletUseCase,
    private readonly listWalletLedgerUseCase: ListWalletLedgerUseCase,
    private readonly reconcileWalletUseCase: ReconcileWalletUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async openWallet(
    @Body(new ZodValidationPipe(openWalletRequestSchema))
    body: OpenWalletRequestDto,
  ): Promise<OpenWalletResponseDto> {
    const correlationId = CorrelationContext.get()?.correlationId;
    return this.openWalletUseCase.execute({
      playerId: body.playerId,
      initialBalance: body.initialBalance,
      correlationId,
    });
  }

  @Get(":walletId")
  @HttpCode(HttpStatus.OK)
  async getWallet(
    @Param("walletId", new ParseUUIDPipe()) walletId: string,
  ): Promise<OpenWalletResponseDto> {
    return this.getWalletUseCase.execute({ walletId });
  }

  @Get(":walletId/ledger")
  @HttpCode(HttpStatus.OK)
  async listLedger(
    @Param("walletId", new ParseUUIDPipe()) walletId: string,
    @Query(new ZodValidationPipe(listWalletLedgerQuerySchema))
    query: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
  ): Promise<ListWalletLedgerResponseDto> {
    return this.listWalletLedgerUseCase.execute({
      walletId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Post(":walletId/reconciliation")
  @HttpCode(HttpStatus.OK)
  async reconcileWallet(
    @Param("walletId", new ParseUUIDPipe()) walletId: string,
  ): Promise<ReconcileWalletResponseDto> {
    return this.reconcileWalletUseCase.execute({ walletId });
  }

  @Post(":walletId/reconcile")
  @HttpCode(HttpStatus.OK)
  async reconcileWalletAlias(
    @Param("walletId", new ParseUUIDPipe()) walletId: string,
  ): Promise<ReconcileWalletResponseDto> {
    return this.reconcileWalletUseCase.execute({ walletId });
  }
}
