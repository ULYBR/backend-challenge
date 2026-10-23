import type {
  ListWalletLedgerInputDto,
  ListWalletLedgerOutputDto,
} from "@application/dto/query-wallet.dto";
import { TOKENS } from "@application/ports/tokens";
import type { WalletLedgerRepositoryPort } from "@application/ports/wallet-ledger-repository.port";
import type { WalletRepositoryPort } from "@application/ports/wallet-repository.port";
import { LedgerCursorCodec } from "@application/shared/ledger-cursor.codec";
import { WalletNotFoundError } from "@domain/shared/domain-errors";
import { Inject, Injectable } from "@nestjs/common";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

@Injectable()
export class ListWalletLedgerUseCase {
  constructor(
    @Inject(TOKENS.WALLET_REPOSITORY)
    private readonly walletRepository: WalletRepositoryPort,
    @Inject(TOKENS.WALLET_LEDGER_REPOSITORY)
    private readonly ledgerRepository: WalletLedgerRepositoryPort,
  ) {}

  async execute(input: ListWalletLedgerInputDto): Promise<ListWalletLedgerOutputDto> {
    const walletId = input.walletId.trim();
    const wallet = await this.walletRepository.findById(walletId);
    if (wallet === null) {
      throw new WalletNotFoundError(walletId);
    }

    const requestedLimit = input.limit ?? DEFAULT_PAGE_LIMIT;
    const boundedLimit = Math.min(Math.max(1, requestedLimit), MAX_PAGE_LIMIT);
    const decodedCursor =
      input.cursor !== undefined && input.cursor.trim().length > 0
        ? LedgerCursorCodec.decode(input.cursor.trim())
        : undefined;

    const fetchedEntries = await this.ledgerRepository.listByWalletCursor({
      walletId,
      limit: boundedLimit + 1,
      cursor: decodedCursor,
    });

    const hasNextPage = fetchedEntries.length > boundedLimit;
    const pageItems = hasNextPage ? fetchedEntries.slice(0, boundedLimit) : fetchedEntries;
    const lastItem = pageItems[pageItems.length - 1];

    const nextCursor =
      hasNextPage && lastItem !== undefined
        ? LedgerCursorCodec.encode({
            createdAt: lastItem.createdAt.toISOString(),
            id: lastItem.id,
          })
        : null;

    return {
      items: pageItems.map((entry) => entry.toJSON()),
      nextCursor,
    };
  }
}
