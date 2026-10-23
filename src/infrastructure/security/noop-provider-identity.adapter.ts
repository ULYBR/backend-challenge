import type {
  AuthenticatedProviderPrincipalDto,
  ProviderAuthenticationInputDto,
  ProviderIdentityPort,
} from "@application/ports/provider-identity.port";
import { Injectable } from "@nestjs/common";

@Injectable()
export class NoopProviderIdentityAdapter implements ProviderIdentityPort {
  async authenticate(
    input: ProviderAuthenticationInputDto,
  ): Promise<AuthenticatedProviderPrincipalDto> {
    const providerId =
      input.providerIdHeader !== undefined && input.providerIdHeader.trim().length > 0
        ? input.providerIdHeader.trim()
        : "anonymous-noop-provider";

    return {
      providerId,
      clientId: `noop-client:${providerId}`,
      scopes: ["wagering:write", "wagering:read", "wallets:write", "wallets:read"],
    };
  }
}
