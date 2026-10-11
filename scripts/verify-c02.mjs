// Reproducible verification on a new database; never uses the developer's .env DB.
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(path.join(tmpdir(), "swi-c02-verify-"));
const database = path.join(temporary, "verification.db");
writeFileSync(database, "");
const environment = { ...process.env, DATABASE_URL: `file:${database.replaceAll("\\", "/")}` };
const startedAt = new Date().toISOString();
const steps = [];
function run(label, executable, args) {
  console.log(`\n${label}`);
  const result = spawnSync(executable, args, { cwd: root, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  steps.push({ label, exitCode: result.status });
  if (result.status !== 0) throw new Error(`${label} failed (${result.status})`);
}
function node(label, relative, args = []) {
  run(label, process.execPath, [path.join(root, relative), ...args]);
}
function filesUnder(relative) {
  return readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    const name = `${relative}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(name) : [name];
  });
}
function hash(value) { return createHash("sha256").update(value).digest("hex"); }

try {
  node("Generate PostgreSQL Prisma client", "node_modules/prisma/build/index.js", ["generate", "--schema", "prisma/schema.prisma"]);
  node("Generate SQLite Prisma client", "node_modules/prisma/build/index.js", ["generate", "--schema", "prisma/sqlite/schema.prisma"]);
  node("Migrate new isolated SQLite database", "node_modules/prisma/build/index.js", ["migrate", "deploy", "--schema", "prisma/sqlite/schema.prisma"]);
  node("Seed demo menu", "node_modules/tsx/dist/cli.mjs", ["prisma/seed.ts"]);
  node("TypeScript build", "node_modules/typescript/bin/tsc", ["-p", "tsconfig.json"]);
  node("Typecheck application, PostgreSQL tests and load scenario", "node_modules/typescript/bin/tsc", ["-p", "tsconfig.verify.json"]);
  run("Browser JavaScript syntax", process.execPath, ["--check", path.join(root, "public/app.js")]);
  const reportFile = path.join(temporary, "vitest.json");
  node("Full test suite", "node_modules/vitest/vitest.mjs", [
    "run", "--reporter=default", "--reporter=json", `--outputFile=${reportFile}`,
  ]);
  const result = JSON.parse(readFileSync(reportFile, "utf8"));
  const inputs = [
    ...filesUnder("src"), ...filesUnder("tests"), ...filesUnder("public"),
    ...filesUnder("scripts"), ...filesUnder("prisma/migrations"), ...filesUnder("prisma/sqlite/migrations"),
    ...filesUnder("docs/diagrams"), "prisma/schema.prisma", "prisma/sqlite/schema.prisma", "prisma/seed.ts",
    "package.json", "package-lock.json", "tsconfig.json", "tsconfig.verify.json", "vitest.config.ts",
    "README.md", "docs/specification.md", "docs/c02-requirement-review.md",
    "docs/c02-completion-impact.md", "docs/architecture-and-decisions.md",
  ].sort().map((file) => ({ file, sha256: hash(readFileSync(path.join(root, file))) }));
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  const report = {
    startedAt, completedAt: new Date().toISOString(),
    baseCommit: revision.status === 0 ? revision.stdout.trim() : process.env.C02_BASE_COMMIT ?? null,
    snapshotSha256: hash(JSON.stringify(inputs)),
    note: "Hashes identify the tested working files, including uncommitted changes; baseCommit alone does not.",
    runtime: { node: process.version, platform: process.platform, database: "new isolated SQLite database" },
    steps,
    passed: result.numPassedTests, failed: result.numFailedTests, total: result.numTotalTests, skipped: result.numPendingTests,
    suites: result.testResults.map((suite) => ({
      file: path.relative(root, suite.name).replaceAll("\\", "/"),
      status: suite.status,
      tests: suite.assertionResults.map((test) => ({ name: test.fullName, status: test.status })),
    })),
    inputs,
  };
  const destination = path.join(root, "docs/evidence/c03-sqlite-verification.json");
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nEvidence: ${destination}\nSnapshot: ${report.snapshotSha256}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
