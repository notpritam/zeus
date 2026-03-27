import z from "zod";
import { BusEvent } from "../event";

export const TerminalEvents = {
  Output: BusEvent.define("terminal.output", z.object({
    sessionId: z.string(),
    data: z.string(),
  })),
  Exit: BusEvent.define("terminal.exit", z.object({
    sessionId: z.string(),
    code: z.number().nullable(),
  })),
  Replay: BusEvent.define("terminal.replay", z.object({
    sessionId: z.string(),
    data: z.string(),
    cursor: z.number(),
  })),
};
