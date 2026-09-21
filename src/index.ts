import { PrismaClient } from "@prisma/client";
import { createApp } from "./http/app.js";

const prisma = new PrismaClient();
const app = createApp(prisma);
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`Reservation service listening on port ${port}`);
  console.log(`Index route: http://localhost:${port}/`);
});
