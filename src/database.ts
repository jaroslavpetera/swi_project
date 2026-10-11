// PostgreSQL is the default provider; the retained SQLite profile supports
// historical C01/C02 verification and an explicit file: DATABASE_URL.
import { PrismaClient as PostgreSQLClient, Prisma } from '@prisma/client';
import { PrismaClient as SQLiteClient, Prisma as SQLitePrisma } from '../node_modules/.prisma/sqlite/index.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const envFile = path.resolve('.env');
if (process.env.DATABASE_URL === undefined && existsSync(envFile)) {
  const line = readFileSync(envFile, 'utf8').split(/\r?\n/).find((value) => /^DATABASE_URL\s*=/.test(value));
  if (line) process.env.DATABASE_URL = line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
}
if (process.env.DATABASE_URL?.startsWith('file:')) {
  const file = process.env.DATABASE_URL.slice(5);
  if (!path.isAbsolute(file)) {
    // Preserve the original file:./dev.db location after moving the schema.
    process.env.DATABASE_URL = `file:${path.resolve('prisma', file).replaceAll('\\', '/')}`;
  }
}

// Both schemas intentionally contain the same models and field types.
export const PrismaClient = (process.env.DATABASE_URL?.startsWith('file:')
  ? SQLiteClient : PostgreSQLClient) as typeof PostgreSQLClient;
export type PrismaClient = PostgreSQLClient;
export { Prisma };

// Custom generated clients have separate runtime error constructors. Recognize
// both actual Prisma error classes so SQLite FK failures retain HTTP 400.
export function isForeignKeyViolation(error: unknown): boolean {
  return (error instanceof Prisma.PrismaClientKnownRequestError
    || error instanceof SQLitePrisma.PrismaClientKnownRequestError) && error.code === 'P2003';
}
