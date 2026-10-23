import { FailureCode } from "@domain/shared/failure-code";

export interface DomainErrorInput {
  readonly failureCode: FailureCode;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface DomainErrorOutputDto {
  readonly name: string;
  readonly failureCode: FailureCode;
  readonly message: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}
