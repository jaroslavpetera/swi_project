import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { startPostgres } from "./lib/postgres.mjs";
import { prisma as migrate, root, node, report } from "./lib/runtime.mjs";

const directory = mkdtempSync(path.join(tmpdir(), "swi-frontend-"));
const artifacts = path.join(root, "docs/evidence/frontend");
mkdirSync(artifacts, { recursive: true });
const checks = [];
let database, client, server, browser;
const errors = [];
try {
  database = await startPostgres(path.join(directory, "cluster"));
  process.env.DATABASE_URL = await database.createDatabase("frontend");
  await migrate(["migrate", "deploy", "--schema", "prisma/schema.prisma"]);
  await node("node_modules/tsx/dist/cli.mjs", ["prisma/seed.ts"]);
  const { PrismaClient } = await import("../src/database.ts");
  const { createApp } = await import("../src/http/app.ts");
  client = new PrismaClient();
  server = createApp(client).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.FRONTEND_BROWSER_EXECUTABLE
      ? { executablePath: process.env.FRONTEND_BROWSER_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    locale: "cs-CZ",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  async function check(name, task) {
    await task();
    checks.push(name);
    console.log(`PASS ${name}`);
  }
  async function post(url, body) {
    const response = await fetch(base + url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, `${url}: ${response.status}`);
    return response.json();
  }
  async function createReservation(table, user, start, end) {
    const form = page.locator("#reservation-form");
    await form.locator("[name=resourceId]").selectOption(table.id);
    await form.locator("[name=userId]").selectOption(user.id);
    const local = (value) =>
      new Date(value.getTime() - value.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    await form.locator("[name=startsAt]").fill(local(start));
    await form.locator("[name=endsAt]").fill(local(end));
    await form.getByRole("button", { name: "Vytvořit rezervaci" }).click();
    await expect(page.locator("#notice")).toContainText(
      "Rezervace byla vytvořena",
    );
  }
  await check(
    "Empty database, disabled actions, navigation and deep links",
    async () => {
      await page.goto(base);
      await expect(page.locator("#reservation-table")).toContainText(
        "Nejprve připravte",
      );
      await expect(page.locator("#reservation-form button")).toBeDisabled();
      await page
        .locator("nav")
        .getByRole("link", { name: "Objednávky a účet" })
        .click();
      await expect(page.locator("#place-order")).toBeDisabled();
      await expect(page.locator("#tab-table")).toContainText(
        "Vyberte rezervaci",
      );
      await page.goto(`${base}/#manage`);
      await expect(page.locator("#manage")).toBeVisible();
      await expect(page.locator('a[href="#manage"]').first()).toHaveAttribute(
        "aria-current",
        "page",
      );
    },
  );
  let host, table, vip;
  await check(
    "Initial network failure recovers using the data refresh button",
    async () => {
      await page.route("**/users", (route) => route.abort());
      await page.reload();
      await expect(page.locator("#notice")).toContainText(
        "Spojení se serverem",
      );
      await page.unroute("**/users");
      await page.locator("#refresh-data").click();
      await expect(page.locator("#notice")).toContainText(
        "Data byla aktualizována",
      );
      await expect(page.locator("#refresh-data")).toBeEnabled();
    },
  );
  await check(
    "Create guests and tables through the UI; safely render user input",
    async () => {
      await page.locator("#user-form [name=name]").fill("Jan Novák");
      await page.locator("#user-form [name=email]").fill("jan@example.cz");
      await page.locator("#user-form button").click();
      await expect(page.locator("#user-list")).toContainText("Jan Novák");
      await page.locator("#resource-form [name=name]").fill("Stůl u okna");
      await page.locator("#resource-form [name=capacity]").fill("4");
      await page.locator("#resource-form button").click();
      await expect(page.locator("#resource-list")).toContainText("Stůl u okna");
      host = (await (await fetch(base + "/users")).json())[0];
      table = (await (await fetch(base + "/resources")).json())[0];
      vip = await post("/resources", {
        name: "Salonek",
        capacity: 8,
        requiresApproval: true,
      });
      await post("/users", {
        name: '<img src=x onerror="window.injected=true">',
        email: "literal@example.cz",
      });
      await page.reload();
      await expect(page.locator("#user-list")).toContainText("<img src=x");
      assert.equal(await page.locator("#user-list img").count(), 0);
      assert.equal(await page.evaluate(() => window.injected), undefined);
    },
  );
  const future = new Date(Date.now() + 3 * 3600000),
    end = new Date(future.getTime() + 2 * 3600000);
  await check(
    "Create and confirm reservation, validate interval, filter, and check availability",
    async () => {
      await page
        .locator("nav")
        .getByRole("link", { name: "Rezervace", exact: true })
        .click();
      await createReservation(table, host, future, end);
      await page
        .locator("#reservation-table")
        .getByRole("button", { name: "Potvrdit", exact: true })
        .click();
      await expect(page.locator("#reservation-table .badge")).toHaveText(
        "Potvrzená",
      );
      await expect(page.locator("#stat-confirmed")).toHaveText("1");
      await page.locator("#reservation-search").fill("nenalezený host");
      await expect(page.locator("#reservation-table")).toContainText(
        "neodpovídá",
      );
      await page.locator("#reservation-search").fill("jan");
      await expect(page.locator("#reservation-table")).toContainText(
        "Jan Novák",
      );
      await page.locator("#reservation-filter").selectOption("CANCELLED");
      await expect(page.locator("#reservation-table")).toContainText(
        "neodpovídá",
      );
      await page.locator("#reservation-filter").selectOption("");
      await page.locator("#availability-resource").selectOption(table.id);
      for (const [source, target] of [
        ["startsAt", "start"],
        ["endsAt", "end"],
      ]) {
        await page
          .locator(`#availability-form [name=${target}]`)
          .fill(
            await page
              .locator(`#reservation-form [name=${source}]`)
              .inputValue(),
          );
      }
      await page.locator("#availability-form button").click();
      await expect(page.locator("#availability-result")).toContainText(
        "obsazený",
      );
      const form = page.locator("#reservation-form");
      await form
        .locator("[name=endsAt]")
        .fill(await form.locator("[name=startsAt]").inputValue());
      await form.locator("button").click();
      await expect(page.locator("#notice")).toContainText(
        "Konec návštěvy musí být později",
      );
      await expect(page.locator("#stat-total")).toHaveText("1");
    },
  );
  await check(
    "Approval, rejection, cancellation and conflict responses",
    async () => {
      await createReservation(vip, host, future, end);
      await page
        .locator("#reservation-table")
        .getByRole("button", { name: "Potvrdit", exact: true })
        .click();
      await expect(page.locator("#reservation-table .badge")).toHaveText(
        "Čeká na schválení",
      );
      await page
        .locator("#reservation-table")
        .getByRole("button", { name: "Schválit", exact: true })
        .click();
      await expect(page.locator("#reservation-table .badge")).toHaveText(
        "Potvrzená",
      );
      await createReservation(vip, host, future, end);
      await page
        .locator("#reservation-table")
        .getByRole("button", { name: "Potvrdit", exact: true })
        .click();
      await page
        .locator("#reservation-table")
        .getByRole("button", { name: "Schválit", exact: true })
        .click();
      await expect(page.locator("#notice")).toHaveAttribute(
        "data-tone",
        "error",
      );
      await page
        .locator("#reservation-table")
        .getByRole("button", { name: "Zamítnout", exact: true })
        .click();
      await expect(page.locator("#reservation-table")).toContainText(
        "Zamítnutá",
      );
      await page
        .locator("#reservation-table")
        .getByRole("button", { name: "Zrušit", exact: true })
        .click();
      await expect(page.locator("#reservation-table")).toContainText("Zrušená");
    },
  );
  let active;
  await check(
    "Order totals, unavailable items, serving, payment and bill reset",
    async () => {
      active = await client.reservation.create({
        data: {
          resourceId: table.id,
          userId: host.id,
          state: "CONFIRMED",
          startsAt: new Date(Date.now() - 3600000),
          endsAt: new Date(Date.now() + 3600000),
        },
      });
      await client.menuItem.create({
        data: {
          name: "Vyprodáno",
          category: "FOOD",
          priceCents: 10000,
          available: false,
        },
      });
      await page.reload();
      await page
        .locator("nav")
        .getByRole("link", { name: "Objednávky a účet" })
        .click();
      await page.locator("#orders-resource").selectOption(table.id);
      await expect(page.locator("#order-reservation")).toContainText(
        "Jan Novák",
      );
      await page.locator("#order-reservation").selectOption(active.id);
      await expect(page.locator("#tab-unpaid")).toContainText("0");
      await expect(
        page.getByRole("spinbutton", { name: "Počet: Vyprodáno", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("spinbutton", {
          name: "Počet: Guláš s knedlíkem",
          exact: true,
        })
        .fill("2");
      await expect(page.locator("#cart-total")).toContainText("438");
      await expect(page.locator("#place-order")).toBeEnabled();
      await page.locator("#place-order").click();
      await expect(page.locator("#tab-unpaid")).toContainText("438");
      await expect(page.locator("#cart-total")).toContainText("0");
      await page
        .getByRole("button", { name: "Označit jako podané", exact: true })
        .click();
      await expect(page.locator("#tab-table .badge")).toHaveText("Podáno");
      await page
        .getByRole("button", { name: "Označit jako zaplacené", exact: true })
        .click();
      await expect(page.locator("#tab-table .badge")).toHaveText("Zaplaceno");
      await expect(page.locator("#tab-paid")).toContainText("438");
      await expect(page.locator("#tab-unpaid")).toContainText("0");
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: path.join(artifacts, "orders-desktop.png"),
        fullPage: true,
      });
      await page.locator("#orders-resource").selectOption(vip.id);
      await expect(page.locator("#tab-paid")).toContainText("0");
      await expect(page.locator("#place-order")).toBeDisabled();
    },
  );
  await check(
    "Failed requests recover with inline feedback; stale bill responses are ignored",
    async () => {
      await page.route("**/reservations/*/tab", async (route) => {
        if (route.request().url().includes(active.id))
          await new Promise((resolve) => setTimeout(resolve, 500));
        await route.continue();
      });
      await page.locator("#orders-resource").selectOption(table.id);
      await expect(page.locator("#order-reservation")).toContainText(
        "Jan Novák",
      );
      await page.locator("#order-reservation").selectOption(active.id);
      await page.locator("#orders-resource").selectOption(vip.id);
      await expect(page.locator("#tab-paid")).toContainText("0");
      await page.waitForTimeout(700);
      await expect(page.locator("#tab-paid")).toContainText("0");
      await page.unroute("**/reservations/*/tab");
      await page
        .locator("nav")
        .getByRole("link", { name: "Rezervace", exact: true })
        .click();
      await page.route("**/resources/*/reservations", (route) => route.abort());
      await page.locator("#refresh-reservations").click();
      await expect(page.locator("#notice")).toContainText(
        "Spojení se serverem",
      );
      await expect(page.locator("#refresh-reservations")).toBeEnabled();
      await page.unroute("**/resources/*/reservations");
      await page.locator("#reservations-resource").selectOption(table.id);
      await expect(page.locator("#reservation-table")).toContainText(
        "Jan Novák",
      );
    },
  );
  await check(
    "Desktop and mobile layouts, accessible form labels and keyboard focus",
    async () => {
      await page.reload();
      await page.locator("#reservations-resource").selectOption(table.id);
      await expect(page.locator("#stat-total")).toHaveText("2");
      await page.locator("#reservation-user").selectOption(host.id);
      await page.locator("#reservation-resource").selectOption(table.id);
      await page.locator("#availability-resource").selectOption(table.id);
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: path.join(artifacts, "reservations-desktop.png"),
        fullPage: true,
      });
      for (const width of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        for (const view of ["reservations", "orders", "manage"]) {
          await page.locator(`nav a[href="#${view}"]`).click();
          await expect(page.locator(`#${view}`)).toBeVisible();
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            `${view} overflows at ${width}px`,
          );
        }
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('nav a[href="#reservations"]').click();
      await expect(page.locator("#reservations")).toBeVisible();
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: path.join(artifacts, "reservations-mobile.png"),
        fullPage: true,
      });
      assert.ok(
        await page
          .locator("input, select")
          .evaluateAll((elements) =>
            elements.every(
              (element) =>
                element.closest("label") || element.getAttribute("aria-label"),
            ),
          ),
        "Every form control must have a label",
      );
      await page.keyboard.press("Control+Home");
      await page.locator(".skip-link").focus();
      await expect(page.locator(".skip-link")).toBeInViewport();
    },
  );
  assert.deepEqual(errors, [], "Unexpected browser errors");
  report("docs/evidence/frontend-verification.json", {
    completedAt: new Date().toISOString(),
    status: "passed",
    provider: "postgresql",
    browser: browser.version(),
    checks,
    browserErrors: errors,
    screenshots: [
      "frontend/reservations-desktop.png",
      "frontend/orders-desktop.png",
      "frontend/reservations-mobile.png",
    ],
  });
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (client) await client.$disconnect();
  if (database) await database.stop();
}
