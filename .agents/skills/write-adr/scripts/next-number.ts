import { readdirSync } from "node:fs";
import { join } from "node:path";

type DocKind = "adr" | "rfc";

const PATTERNS: Readonly<Record<DocKind, RegExp>> = {
  adr: /^(\d{4})-/,
  rfc: /^RFC-(\d{4})-/,
};

const FORMATTERS: Readonly<Record<DocKind, (padded: string) => string>> = {
  adr: (padded) => padded,
  rfc: (padded) => `RFC-${padded}`,
};

function parseKind(rawKind: string | undefined): DocKind {
  if (rawKind !== "adr" && rawKind !== "rfc") {
    throw new Error("usage: next-number.ts <adr|rfc>");
  }
  return rawKind;
}

const kind = parseKind(process.argv[2]);
const baseDir = import.meta.dirname ?? import.meta.dir;
const dir = join(baseDir, "../../../../docs", kind);
const pattern = PATTERNS[kind];

const highest = readdirSync(dir)
  .map((file) => pattern.exec(file)?.[1])
  .filter((n): n is string => n !== undefined)
  .map((n) => Number.parseInt(n, 10))
  .reduce((max, n) => Math.max(max, n), 0);

const nextPadded = String(highest + 1).padStart(4, "0");
console.log(FORMATTERS[kind](nextPadded));
