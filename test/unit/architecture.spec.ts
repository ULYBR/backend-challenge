import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function listTypeScriptFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...listTypeScriptFiles(fullPath));
    } else if (entry.endsWith(".ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("Hexagonal Architecture & Code Style Guardrails", () => {
  const srcDir = join(import.meta.dirname, "../../src");
  const testDir = join(import.meta.dirname, "../../test");
  const domainDir = join(srcDir, "domain");
  const forbiddenPackages = [
    "@nestjs/",
    "@mikro-orm/",
    "@aws-sdk/",
    "zod",
    "nestjs-pino",
    "pino",
    "prom-client",
    "pg",
    "express",
    "@infrastructure/",
    "@interfaces/",
    "@application/",
  ];

  it("ensures src/domain has zero imports from frameworks, ORM, AWS SDK, Zod, or outer layers", () => {
    const files = listTypeScriptFiles(domainDir);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const forbidden of forbiddenPackages) {
        const importPattern = new RegExp(
          `(?:from\\s+["']|import\\s*\\(\\s*["'])${forbidden.replace("/", "\\/")}`,
        );
        expect(importPattern.test(content)).toBe(false);
      }
    }
  });

  it("ensures src/application has zero imports from infrastructure, interfaces, ORM, or AWS SDK", () => {
    const applicationDir = join(srcDir, "application");
    const files = listTypeScriptFiles(applicationDir);
    const forbiddenInApplication = ["@infrastructure/", "@interfaces/", "@mikro-orm/", "@aws-sdk/"];

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const forbidden of forbiddenInApplication) {
        const importPattern = new RegExp(
          `(?:from\\s+["']|import\\s*\\(\\s*["'])${forbidden.replace("/", "\\/")}`,
        );
        expect(importPattern.test(content)).toBe(false);
      }
    }
  });

  it("ensures src/ and test/ files contain zero inline or block comments", () => {
    const files = [...listTypeScriptFiles(srcDir), ...listTypeScriptFiles(testDir)];
    const commentLineRegex = /^\s*(\/\/|\/\*|\*)/m;

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(commentLineRegex.test(content)).toBe(false);
    }
  });

  it("ensures all imports in src/ and test/ use @ path aliases instead of relative paths", () => {
    const files = [...listTypeScriptFiles(srcDir), ...listTypeScriptFiles(testDir)];
    const relativeImportRegex = /(?:from|export\s+\*\s+from)\s+["']\.\.?\//m;

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(relativeImportRegex.test(content)).toBe(false);
    }
  });

  it("ensures production code in src/ contains zero chained else if statements", () => {
    const files = listTypeScriptFiles(srcDir);
    const chainedElseIfRegex = /\belse\s+if\b/;

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(chainedElseIfRegex.test(content)).toBe(false);
    }
  });

  it("ensures production code in src/ contains zero any types", () => {
    const files = listTypeScriptFiles(srcDir);
    const anyTypeRegex = /:\s*any\b|<any>|\bas\s+any\b|\bArray<any>/;

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(anyTypeRegex.test(content)).toBe(false);
    }
  });
});
