import { PrismaClient } from "./database.js";
import { createApp } from "./http/app.js";
import { logEvent } from "./logging.js";

const prisma = new PrismaClient();
const app = createApp(prisma);
const port = Number(process.env.PORT ?? 3000);

const server = app.listen(port, () => {
  logEvent("info", "process", "startup", { port, pid: process.pid });
  console.log(`Reservation service listening on port ${port}`);
  console.log(`Index route: http://localhost:${port}/`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logEvent("info", "process", "shutdown_requested", { signal });
    server.close(() => {
      void prisma.$disconnect().then(() => logEvent("info", "process", "shutdown_complete"));
    });
  });
}
