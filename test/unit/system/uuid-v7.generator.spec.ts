import { describe, expect, it } from "bun:test";
import { UuidV7Generator } from "@infrastructure/system/uuid-v7.generator";

describe("UuidV7Generator (ADR-0004)", () => {
  const generator = new UuidV7Generator();
  const uuidV7Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("generates RFC 9562 compliant UUIDv7 identifiers", () => {
    const id1 = generator.generate();
    const id2 = generator.generate();

    expect(id1).toMatch(uuidV7Regex);
    expect(id2).toMatch(uuidV7Regex);
    expect(id1).not.toBe(id2);
  });

  it("maintains lexicographical ordering across time", async () => {
    const first = generator.generate();
    await Bun.sleep(5);
    const second = generator.generate();

    expect(first < second).toBe(true);
  });
});
