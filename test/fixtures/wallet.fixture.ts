import type { OpenWalletInputDto } from "@application/dto/open-wallet.dto";
import { faker } from "@faker-js/faker";

export function buildOpenWalletInput(
  overrides: Partial<OpenWalletInputDto> = {},
): OpenWalletInputDto {
  return {
    playerId: overrides.playerId ?? faker.string.uuid(),
    initialBalance: overrides.initialBalance ?? {
      amount: "100.00",
      currency: "BRL",
    },
  };
}
