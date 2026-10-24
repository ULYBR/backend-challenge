export interface RateLimitRule {
  readonly maxRequests: number;
  readonly windowMs: number;
}

export interface ClientRateLimitState {
  readonly timestamps: number[];
}
