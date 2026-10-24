import type { AuthenticatedProviderPrincipalDto } from "@application/dto/provider-identity.dto";
import type { Request } from "express";

export interface AuthenticatedHttpRequest extends Request {
  providerPrincipal?: AuthenticatedProviderPrincipalDto | undefined;
}
