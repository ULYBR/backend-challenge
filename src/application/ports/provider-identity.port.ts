import type {
  AuthenticatedProviderPrincipalDto,
  ProviderAuthenticationInputDto,
} from "@application/dto/provider-identity.dto";

export type { AuthenticatedProviderPrincipalDto, ProviderAuthenticationInputDto };

export interface ProviderIdentityPort {
  authenticate(input: ProviderAuthenticationInputDto): Promise<AuthenticatedProviderPrincipalDto>;
}
