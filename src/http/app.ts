import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { Express, Request, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { ReservationRepository } from "../repositories/reservationRepository.js";
import {
  ReservationService,
  OverlapError,
  NoShowExpiredError,
  NotFoundError,
} from "../services/reservationService.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

const reservationInputSchema = z
  .object({
    resourceId: z.string().min(1),
    userId: z.string().min(1),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((v) => v.endsAt > v.startsAt, { message: "endsAt must be after startsAt" });

const userInputSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

const resourceInputSchema = z.object({
  name: z.string().min(1),
  capacity: z.coerce.number().int().positive(),
});

export function createApp(prisma: PrismaClient): Express {
  const service = new ReservationService(new ReservationRepository(prisma));
  const app = express();
  app.use(express.json());
  app.use(express.static(publicDir));

  // Manual-testing helpers: reservations reference an existing User/Resource
  // (FK constraint), so the demo frontend needs a way to create and list them.
  app.get("/users", async (_req: Request, res: Response) => {
    return res.json(await prisma.user.findMany({ orderBy: { createdAt: "desc" } }));
  });

  app.post("/users", async (req: Request, res: Response) => {
    const parsed = userInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const user = await prisma.user.create({ data: parsed.data });
    return res.status(201).json(user);
  });

  app.get("/resources", async (_req: Request, res: Response) => {
    return res.json(await prisma.resource.findMany({ orderBy: { createdAt: "desc" } }));
  });

  app.post("/resources", async (req: Request, res: Response) => {
    const parsed = resourceInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const resource = await prisma.resource.create({ data: parsed.data });
    return res.status(201).json(resource);
  });

  app.get("/resources/:id/reservations", async (req: Request, res: Response) => {
    const reservations = await prisma.reservation.findMany({
      where: { resourceId: req.params.id },
      orderBy: { startsAt: "asc" },
    });
    return res.json(reservations);
  });

  // CP1 walking skeleton entry point: validate -> persist -> return reservation ID.
  app.post("/reservations", async (req: Request, res: Response) => {
    const parsed = reservationInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const reservation = await service.createReservation(parsed.data);
    return res.status(201).json({ id: reservation.id, state: reservation.state });
  });

  app.post("/reservations/:id/confirm", async (req: Request, res: Response) => {
    try {
      const reservation = await service.confirmReservation(req.params.id);
      return res.json(reservation);
    } catch (err) {
      return handleServiceError(err, res);
    }
  });

  app.post("/reservations/:id/cancel", async (req: Request, res: Response) => {
    try {
      const reservation = await service.cancelReservation(req.params.id);
      return res.json(reservation);
    } catch (err) {
      return handleServiceError(err, res);
    }
  });

  app.get("/resources/:id/availability", async (req: Request, res: Response) => {
    const startsAt = new Date(String(req.query.start));
    const endsAt = new Date(String(req.query.end));
    const available = await service.checkAvailability(req.params.id, startsAt, endsAt);
    return res.json({ available });
  });

  return app;
}

function handleServiceError(err: unknown, res: Response) {
  if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
  if (err instanceof OverlapError) return res.status(409).json({ error: err.message });
  if (err instanceof NoShowExpiredError) return res.status(410).json({ error: err.message });
  throw err;
}
