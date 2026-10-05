// C03 L2 — architecture conformance rule from ADR-03 / G2:
// "Only the Reservation Lifecycle (ReservationService) may change Reservation
// state, and only through ReservationTx.transition() inside
// inResourceTransaction()." Reads stay allowed everywhere.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIFECYCLE = "src/services/reservationService.ts";
const PERSISTENCE = "src/repositories/reservationRepository.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(relative);
    return relative.endsWith(".ts") ? [relative] : [];
  });
}

// Every match of `pattern` in src/, reported as "file:line: code".
function occurrences(pattern: RegExp): { file: string; where: string }[] {
  return sourceFiles("src").flatMap((file) =>
    readFileSync(path.join(root, file), "utf8")
      .split("\n")
      .flatMap((line, index) =>
        pattern.test(line) ? [{ file, where: `${file}:${index + 1}: ${line.trim()}` }] : []
      )
  );
}

function outside(allowed: string[], pattern: RegExp): string[] {
  return occurrences(pattern)
    .filter((o) => !allowed.includes(o.file))
    .map((o) => o.where);
}

describe("ADR-03 — Reservation Lifecycle owns every Reservation state change", () => {
  it("only Reservation Persistence writes the Reservation table", () => {
    // Prisma writes and raw SQL writes alike. create() (OP-01) lives there too.
    const writes = /\.reservation\.(update|updateMany|upsert|delete|deleteMany)\s*\(|(UPDATE|DELETE FROM)\s+"?Reservation"?\b/i;
    expect(outside([PERSISTENCE], writes)).toEqual([]);
  });

  it("only the Reservation Lifecycle requests a Reservation state transition", () => {
    // OrderService has its own transition() for OrderState; only calls that
    // target a ReservationState count.
    const reservationTransition = /\.transition\([^)]*ReservationState\./;
    expect(outside([LIFECYCLE], reservationTransition)).toEqual([]);
  });

  it("only the Reservation Lifecycle opens a resource-scoped transaction", () => {
    const opensTransaction = /\.inResourceTransaction\s*\(/;
    expect(outside([LIFECYCLE], opensTransaction)).toEqual([]);
  });

  it("the Lifecycle transitions state only inside inResourceTransaction", () => {
    // Every transition goes through a ReservationTx (`tx`) handed out by
    // inResourceTransaction; a transition on the store itself would bypass
    // the Resource lock.
    const lifecycle = readFileSync(path.join(root, LIFECYCLE), "utf8");
    const allTransitions = lifecycle.match(/\.transition\(/g) ?? [];
    const insideTransaction = lifecycle.match(/\btx\.transition\(/g) ?? [];
    expect(allTransitions.length).toBeGreaterThan(0);
    expect(insideTransaction.length).toBe(allTransitions.length);
  });
});
