import z from "zod";
import { BusEvent } from "../event";

export const TaskEvents = {
  List: BusEvent.define("task.list", z.object({ tasks: z.unknown() })),
  Created: BusEvent.define("task.created", z.object({ task: z.unknown() })),
  Updated: BusEvent.define("task.updated", z.object({ task: z.unknown() })),
  Deleted: BusEvent.define("task.deleted", z.object({ taskId: z.string() })),
  DiffResult: BusEvent.define("task.diff_result", z.object({ taskId: z.string(), diff: z.string() })),
  Error: BusEvent.define("task.error", z.object({ message: z.string() })),
};
