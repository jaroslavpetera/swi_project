import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { Prisma, PrismaClient } from "@prisma/client";
import { ReservationRepository } from "../repositories/reservationRepository.js";
import {
  ReservationService,
  InvalidStateError,
  OverlapError,
  NoShowExpiredError,
  ApprovalExpiredError,
  NotCancellableError,
  CancellationWindowError,
  NotFoundError,
} from "../services/reservationService.js";
import { ReservationState } from "../domain/types.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

const reservationInputSchema = z
  .object({
    resourceId: z.string().min(1),
    userId: z.string().min(1),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((v) => v.endsAt > v.startsAt, { message: "endsAt must be after startsAt" });

const availabilityQuerySchema = z
  .object({
    start: z.coerce.date(),
    end: z.coerce.date(),
  })
  .refine((v) => v.end > v.start, { message: "end must be after start" });

const userInputSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

const resourceInputSchema = z.object({
  name: z.string().min(1),
  capacity: z.coerce.number().int().positive(),
  // BR-05: whether Confirm routes this Resource's reservations through the
  // approval workflow (PENDING_APPROVAL) instead of straight to CONFIRMED.
  requiresApproval: z.coerce.boolean().optional().default(false),
});

// Express 4 nezachytává odmítnuté promisy z async handlerů — bez tohoto obalu
// shodí jediný chybný požadavek (např. FK violation) celý proces.
function asyncRoute(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export function createApp(prisma: PrismaClient): Express {
  const service = new ReservationService(new ReservationRepository(prisma));
  const app = express();
  app.use(express.json());
  app.use(express.static(publicDir));

  // Manual-testing helpers: reservations reference an existing User/Resource
  // (FK constraint), so the demo frontend needs a way to create and list them.
  app.get(
    "/users",
    asyncRoute(async (_req, res) => {
      return res.json(await prisma.user.findMany({ orderBy: { createdAt: "desc" } }));
    })
  );

  app.post(
    "/users",
    asyncRoute(async (req, res) => {
      const parsed = userInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const user = await prisma.user.create({ data: parsed.data });
      return res.status(201).json(user);
    })
  );

  app.get(
    "/resources",
    asyncRoute(async (_req, res) => {
      return res.json(await prisma.resource.findMany({ orderBy: { createdAt: "desc" } }));
    })
  );

  app.post(
    "/resources",
    asyncRoute(async (req, res) => {
      const parsed = resourceInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const resource = await prisma.resource.create({ data: parsed.data });
      return res.status(201).json(resource);
    })
  );

  app.get(
    "/resources/:id/reservations",
    asyncRoute(async (req, res) => {
      const reservations = await prisma.reservation.findMany({
        where: { resourceId: req.params.id },
        orderBy: { startsAt: "asc" },
      });
      return res.json(reservations);
    })
  );

  // CP1 walking skeleton entry point: validate -> persist -> return reservation ID.
  app.post(
    "/reservations",
    asyncRoute(async (req, res) => {
      const parsed = reservationInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const reservation = await service.createReservation(parsed.data);
      return res.status(201).json({ id: reservation.id, state: reservation.state });
    })
  );

  app.post(
    "/reservations/:id/confirm",
    asyncRoute(async (req, res) => {
      const reservation = await service.confirmReservation(req.params.id);
      // 202: a Resource requiring approval only *accepted* the request —
      // it isn't CONFIRMED yet, that's OP-05 approve's job.
      const status = reservation.state === ReservationState.PENDING_APPROVAL ? 202 : 200;
      return res.status(status).json(reservation);
    })
  );

  app.post(
    "/reservations/:id/approve",
    asyncRoute(async (req, res) => {
      const reservation = await service.approveReservation(req.params.id);
      return res.json(reservation);
    })
  );

  app.post(
    "/reservations/:id/reject",
    asyncRoute(async (req, res) => {
      const reservation = await service.rejectReservation(req.params.id);
      return res.json(reservation);
    })
  );

  app.post(
    "/reservations/:id/cancel",
    asyncRoute(async (req, res) => {
      const reservation = await service.cancelReservation(req.params.id);
      return res.json(reservation);
    })
  );

  app.get(
    "/resources/:id/availability",
    asyncRoute(async (req, res) => {
      const parsed = availabilityQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const available = await service.checkAvailability(
        req.params.id,
        parsed.data.start,
        parsed.data.end
      );
      return res.json({ available });
    })
  );

  app.use(errorMiddleware);

  return app;
}

// Jediné místo, kde se doménové a DB chyby překládají na HTTP status kódy.
function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
  if (err instanceof OverlapError) return res.status(409).json({ error: err.message });
  if (err instanceof InvalidStateError) return res.status(409).json({ error: err.message });
  if (err instanceof NotCancellableError) return res.status(409).json({ error: err.message });
  if (err instanceof CancellationWindowError) return res.status(409).json({ error: err.message });
  if (err instanceof NoShowExpiredError) return res.status(410).json({ error: err.message });
  if (err instanceof ApprovalExpiredError) return res.status(410).json({ error: err.message });

  // P2003 = foreign key constraint: rezervace odkazuje na neexistující stůl nebo hosta.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
    return res.status(400).json({ error: "Unknown resourceId or userId" });
  }

  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
}
