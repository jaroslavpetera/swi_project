import { Clock } from "../../src/domain/clock.js";

// Replaces the system clock in Lifecycle tests: set the time the next
// decision should see, then call the service.
export class TestClock implements Clock {
  constructor(private current: Date = new Date()) {}

  now(): Date {
    return this.current;
  }

  set(at: Date): this {
    this.current = at;
    return this;
  }
}
