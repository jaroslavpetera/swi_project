// C10 — provozní log: technická chyba dává jeden bezpečný diagnostický řádek.
import { describe, it, expect, vi, afterEach } from "vitest";
import { describeError, logEvent } from "../src/logging.js";

afterEach(() => vi.restoreAllMocks());

describe("C10 logging", () => {
  it("describeError vezme typ, kód a skutečnou příčinu (poslední řádek zprávy Prismy)", () => {
    const err = Object.assign(new Error("\nInvalid `prisma.reservation.create()` invocation in\nfoo.ts:1\n\nServer has closed the connection."), {
      name: "PrismaClientKnownRequestError",
      code: "P1017",
    });
    expect(describeError(err)).toMatchObject({
      errorType: "PrismaClientKnownRequestError",
      code: "P1017",
      cause: "Server has closed the connection.",
    });
  });

  it("logEvent zapíše jeden JSON řádek s časem, úrovní, komponentou a událostí", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logEvent("error", "http", "request_failed", { operation: "POST /reservations", status: 500 });
    expect(spy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry).toMatchObject({ level: "error", component: "http", event: "request_failed", operation: "POST /reservations", status: 500 });
    expect(new Date(entry.time).toISOString()).toBe(entry.time);
  });
});
