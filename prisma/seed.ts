// Naplní jídelní lístek, aby šlo objednávání rovnou vyzkoušet.
// Spuštění: npm run seed
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const menu = [
  { name: "Radegast 12° (0,5 l)", category: "DRINK", priceCents: 5200 },
  { name: "Kozel 10° - světlý (0,5 l)", category: "DRINK", priceCents: 4700 },
  { name: "Kozel 10° - černý (0,5 l)", category: "DRINK", priceCents: 5100 },
  { name: "Pilsner Urquell (0,5 l)", category: "DRINK", priceCents: 6200 },
  { name: "Nealko pivo (0,5 l)", category: "DRINK", priceCents: 4500 },
  { name: "Kofola (0,4 l)", category: "DRINK", priceCents: 5900 },
  { name: "Guláš s knedlíkem", category: "FOOD", priceCents: 21900 },
  { name: "Smažený sýr s hranolky", category: "FOOD", priceCents: 19900 },
  { name: "Utopenec", category: "FOOD", priceCents: 8900 },
];

async function main() {
  for (const item of menu) {
    const existing = await prisma.menuItem.findFirst({ where: { name: item.name } });
    if (!existing) {
      await prisma.menuItem.create({ data: item });
      console.log(`+ ${item.name}`);
    }
  }
  const total = await prisma.menuItem.count();
  console.log(`Jídelní lístek má ${total} položek.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
