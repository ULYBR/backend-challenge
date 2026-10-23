import { IdGeneratorPort } from "@application/ports/id-generator.port";
import { Injectable } from "@nestjs/common";

@Injectable()
export class UuidV7Generator implements IdGeneratorPort {
  generate(): string {
    return Bun.randomUUIDv7();
  }
}
