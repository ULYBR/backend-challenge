import { ClockPort } from "@application/ports/clock.port";
import { Injectable } from "@nestjs/common";

@Injectable()
export class SystemClockAdapter implements ClockPort {
  now(): Date {
    return new Date();
  }
}
