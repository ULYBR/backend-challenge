export interface ProviderAuthenticationInputDto {
  readonly authorizationHeader?: string | undefined;
  readonly providerIdHeader?: string | undefined;
}

export interface AuthenticatedProviderPrincipalDto {
  readonly providerId: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
}
