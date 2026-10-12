// C05 DD (N2): the single source of "now" for the Reservation Lifecycle
// (C03 R6). Tests replace it with a fixed time instead of passing dates.
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
