import z from "zod";

// ─── Client → Server ───

export const TerminalInput = z.object({
  type: z.literal("input"),
  data: z.string(),
});

export const TerminalResize = z.object({
  type: z.literal("resize"),
  cols: z.number(),
  rows: z.number(),
});

export const TerminalIncoming = z.discriminatedUnion("type", [
  TerminalInput,
  TerminalResize,
]);
export type TerminalIncoming = z.infer<typeof TerminalIncoming>;

// ─── Server → Client ───

export const TerminalOutput = z.object({
  type: z.literal("output"),
  data: z.string(),
});

export const TerminalExit = z.object({
  type: z.literal("exit"),
  code: z.number().nullable(),
});

export const TerminalOutgoing = z.discriminatedUnion("type", [
  TerminalOutput,
  TerminalExit,
]);
export type TerminalOutgoing = z.infer<typeof TerminalOutgoing>;
