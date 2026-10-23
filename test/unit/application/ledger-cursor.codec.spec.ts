import { describe, expect, it } from "bun:test";
import { LedgerCursorCodec } from "@application/shared/ledger-cursor.codec";
import { InvalidPaginationCursorError } from "@domain/shared/domain-errors";

describe("LedgerCursorCodec", () => {
  it("encodes and decodes valid cursor payload symmetrically", () => {
    const original = {
      createdAt: "2026-10-22T18:00:00.000Z",
      id: "0195f3a0-0000-7000-8000-000000000001",
    };

    const encoded = LedgerCursorCodec.encode(original);
    const decoded = LedgerCursorCodec.decode(encoded);

    expect(decoded).toEqual(original);
  });

  it("throws InvalidPaginationCursorError on malformed base64 or invalid fields", () => {
    expect(() => LedgerCursorCodec.decode("not-valid-json-base64")).toThrow(
      InvalidPaginationCursorError,
    );

    const invalidPayloadCursor = Buffer.from(
      JSON.stringify({ createdAt: "invalid-date", id: "not-a-uuid" }),
      "utf8",
    ).toString("base64url");

    expect(() => LedgerCursorCodec.decode(invalidPayloadCursor)).toThrow(
      InvalidPaginationCursorError,
    );
  });
});
