import type { GetWalletInputDto, GetWalletOutputDto } from "@application/dto/query-wallet.dto";
import { TOKENS } from "@application/ports/tokens";
import type { WalletRepositoryPort } from "@application/ports/wallet-repository.port";
import { WalletNotFoundError } from "@domain/shared/domain-errors";
import { Inject, Injectable } from "@nestjs/common";

@Injectable()
export class GetWalletUseCase {
  constructor(
    @Inject(TOKENS.WALLET_REPOSITORY)
    private readonly walletRepository: WalletRepositoryPort,
  ) {}

  async execute(input: GetWalletInputDto): Promise<GetWalletOutputDto> {
    const wallet = await this.walletRepository.findById(input.walletId.trim());
    if (wallet === null) {
      throw new WalletNotFoundError(input.walletId);
    }
    return wallet.toJSON();
  }
}
