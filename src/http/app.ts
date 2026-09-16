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

const reservationInputSchema = z
  .object({
    resourceId: z.string().min(1),
    userId: z.string().min(1),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((v) => v.endsAt > v.startsAt, { message: "endsAt must be after startsAt" });

export function createApp(prisma: PrismaClient): Express {
  const service = new ReservationService(new ReservationRepository(prisma));
  const app = express();
  app.use(express.json());

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
