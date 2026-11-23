// C11 — testovací data pro uživatelskou validaci (C12). Spouští je jen scripts/validation-env.mjs
// nad oddělenou databází `validation`; vývojovou DB ani testy nepoužívá.
// Pevná ID rezervací (c11-seed-*) slouží jen internímu readbacku týmu; účastník je v UI nevidí.
import { PrismaClient } from "../src/database.js";

const prisma = new PrismaClient();
const minutes = (n: number) => n * 60_000;
const now = Date.now();

async function main() {
  const users = {
    petr: await prisma.user.create({ data: { name: "Petr Malý", email: "petr.maly@example.cz" } }),
    jana: await prisma.user.create({ data: { name: "Jana Dvořáková", email: "jana.dvorakova@example.cz" } }),
    tomas: await prisma.user.create({ data: { name: "Tomáš Beneš", email: "tomas.benes@example.cz" } }),
    eva: await prisma.user.create({ data: { name: "Eva Králová (Kovo Ostrava s.r.o.)", email: "eva.kralova@example.cz" } }),
    lucie: await prisma.user.create({ data: { name: "Lucie Horáková", email: "lucie.horakova@example.cz" } }),
  };
  const tables = {
    t1: await prisma.resource.create({ data: { name: "Stůl 1 · u okna", capacity: 2 } }),
    t2: await prisma.resource.create({ data: { name: "Stůl 2", capacity: 4 } }),
    t3: await prisma.resource.create({ data: { name: "Stůl 3", capacity: 6 } }),
    salonek: await prisma.resource.create({ data: { name: "Salonek", capacity: 14, requiresApproval: true } }),
  };
  // Časy v UTC; v UI (Europe/Prague, zima = UTC+1) se zobrazí o hodinu později.
  await prisma.reservation.createMany({
    data: [
      // Blokuje Stůl 2 v termínu úlohy A1 (pátek 15. 1. 2027 18:00–20:00 místního času).
      { id: "c11-seed-01", resourceId: tables.t2.id, userId: users.jana.id, state: "CONFIRMED",
        startsAt: new Date("2027-01-15T17:00:00Z"), endsAt: new Date("2027-01-15T19:00:00Z") },
      // Rezervace ke zrušení v úloze A2 (sobota 16. 1. 2027 19:00–21:00).
      { id: "c11-seed-02", resourceId: tables.t1.id, userId: users.tomas.id, state: "CONFIRMED",
        startsAt: new Date("2027-01-16T18:00:00Z"), endsAt: new Date("2027-01-16T20:00:00Z") },
      // Probíhající návštěva u Stolu 3 (pro objednávky v pilotu D): začala před 30 min, končí za 90 min.
      { id: "c11-seed-03", resourceId: tables.t3.id, userId: users.lucie.id, state: "CONFIRMED",
        startsAt: new Date(now - minutes(30)), endsAt: new Date(now + minutes(90)) },
    ],
  });
  console.log("Validační data připravena: 5 hostů, 4 stoly, 3 rezervace (c11-seed-01…03).");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
