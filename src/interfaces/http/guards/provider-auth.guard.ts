import type { ProviderIdentityPort } from "@application/ports/provider-identity.port";
import { TOKENS } from "@application/ports/tokens";
import type { AuthenticatedHttpRequest } from "@interfaces/http/http.types";
import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";

export type { AuthenticatedHttpRequest };

const PUBLIC_PATH_PREFIXES = ["/health", "/metrics", "/docs"] as const;

@Injectable()
export class ProviderAuthGuard implements CanActivate {
  constructor(
    @Inject(TOKENS.PROVIDER_IDENTITY_PORT)
    private readonly providerIdentityPort: ProviderIdentityPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedHttpRequest>();
    const path = request.path ?? request.url ?? "";

    if (PUBLIC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return true;
    }

    const authHeader = request.headers.authorization;
    const providerHeader = request.headers["x-provider-id"];
    const providerIdHeader = Array.isArray(providerHeader) ? providerHeader[0] : providerHeader;

    request.providerPrincipal = await this.providerIdentityPort.authenticate({
      authorizationHeader: authHeader,
      providerIdHeader,
    });

    return true;
  }
}
