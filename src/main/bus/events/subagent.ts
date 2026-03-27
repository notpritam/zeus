import z from "zod";
import { BusEvent } from "../event";

export const SubagentEvents = {
  Started: BusEvent.define("subagent.started", z.object({ parentSessionId: z.string(), info: z.unknown() })),
  Stopped: BusEvent.define("subagent.stopped", z.object({ parentSessionId: z.string(), subagentId: z.string() })),
  Entry: BusEvent.define("subagent.entry", z.object({ parentSessionId: z.string(), subagentId: z.string(), entry: z.unknown() })),
  Activity: BusEvent.define("subagent.activity", z.object({ parentSessionId: z.string(), subagentId: z.string(), activity: z.unknown() })),
  List: BusEvent.define("subagent.list", z.object({ parentSessionId: z.string(), agents: z.unknown() })),
  EntriesList: BusEvent.define("subagent.entries_list", z.object({ subagentId: z.string(), entries: z.unknown() })),
  Deleted: BusEvent.define("subagent.deleted", z.object({ parentSessionId: z.string(), subagentId: z.string() })),
  Cleared: BusEvent.define("subagent.cleared", z.object({ subagentId: z.string() })),
  QaFlowsList: BusEvent.define("subagent.qa_flows_list", z.object({ flows: z.unknown() })),
  MarkdownFilesList: BusEvent.define("subagent.markdown_files_list", z.object({ sessionId: z.string(), files: z.unknown() })),
};
