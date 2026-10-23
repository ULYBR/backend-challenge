import type {
  GetWagerTransactionByExternalIdInputDto,
  GetWagerTransactionInputDto,
  GetWagerTransactionOutputDto,
} from "@application/dto/query-wallet.dto";
import { TOKENS } from "@application/ports/tokens";
import type { WagerTransactionRepositoryPort } from "@application/ports/wager-transaction-repository.port";
import { TransactionNotFoundError } from "@domain/shared/domain-errors";
import { Inject, Injectable } from "@nestjs/common";

@Injectable()
export class GetWagerTransactionUseCase {
  constructor(
    @Inject(TOKENS.WAGER_TRANSACTION_REPOSITORY)
    private readonly wagerTransactionRepository: WagerTransactionRepositoryPort,
  ) {}

  async execute(input: GetWagerTransactionInputDto): Promise<GetWagerTransactionOutputDto> {
    const transaction = await this.wagerTransactionRepository.findById(input.transactionId.trim());
    if (transaction === null) {
      throw new TransactionNotFoundError(input.transactionId);
    }
    return transaction.toJSON();
  }

  async executeByExternalId(
    input: GetWagerTransactionByExternalIdInputDto,
  ): Promise<GetWagerTransactionOutputDto> {
    const transaction = await this.wagerTransactionRepository.findByExternalTransactionId(
      input.providerId.trim(),
      input.externalTransactionId.trim(),
    );
    if (transaction === null) {
      throw new TransactionNotFoundError(`${input.providerId}:${input.externalTransactionId}`);
    }
    return transaction.toJSON();
  }
}
