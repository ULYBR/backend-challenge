import {
  GetWagerTransactionUseCase,
  GetWalletUseCase,
  ListWalletLedgerUseCase,
  OpenWalletUseCase,
  ProcessWagerTransactionUseCase,
  ReconcileWalletUseCase,
} from "@application/use-cases";
import { Global, Module } from "@nestjs/common";

const USE_CASES = [
  OpenWalletUseCase,
  ProcessWagerTransactionUseCase,
  ReconcileWalletUseCase,
  GetWalletUseCase,
  ListWalletLedgerUseCase,
  GetWagerTransactionUseCase,
];

@Global()
@Module({
  providers: [...USE_CASES],
  exports: [...USE_CASES],
})
export class ApplicationModule {}
