import z from "zod";
import { BusEvent } from "../event";

export const GitEvents = {
  Connected: BusEvent.define("git.connected", z.object({ sessionId: z.string() })),
  Disconnected: BusEvent.define("git.disconnected", z.object({ sessionId: z.string() })),
  Status: BusEvent.define("git.status", z.object({ sessionId: z.string(), data: z.unknown() })),
  Error: BusEvent.define("git.error", z.object({ sessionId: z.string(), message: z.string() })),
  NotARepo: BusEvent.define("git.not_a_repo", z.object({ sessionId: z.string() })),
  FileContentsResult: BusEvent.define("git.file_contents_result", z.object({
    sessionId: z.string(), file: z.string(), staged: z.boolean(),
    original: z.string(), modified: z.string(), language: z.string(),
  })),
  FileContentsError: BusEvent.define("git.file_contents_error", z.object({
    sessionId: z.string(), file: z.string(), error: z.string(),
  })),
  CommitResult: BusEvent.define("git.commit_result", z.object({
    sessionId: z.string(), success: z.boolean(), error: z.string().optional(), commitHash: z.string().optional(),
  })),
  SaveFileResult: BusEvent.define("git.save_file_result", z.object({
    sessionId: z.string(), file: z.string(), success: z.boolean(), error: z.string().optional(),
  })),
  BranchesResult: BusEvent.define("git.branches_result", z.object({ sessionId: z.string(), branches: z.unknown() })),
  CheckoutResult: BusEvent.define("git.checkout_result", z.object({
    sessionId: z.string(), success: z.boolean(), branch: z.string().optional(), error: z.string().optional(),
  })),
  CreateBranchResult: BusEvent.define("git.create_branch_result", z.object({
    sessionId: z.string(), success: z.boolean(), branch: z.string().optional(), error: z.string().optional(),
  })),
  DeleteBranchResult: BusEvent.define("git.delete_branch_result", z.object({
    sessionId: z.string(), success: z.boolean(), error: z.string().optional(),
  })),
  PushResult: BusEvent.define("git.push_result", z.object({
    sessionId: z.string(), success: z.boolean(), error: z.string().optional(),
  })),
  PullResult: BusEvent.define("git.pull_result", z.object({
    sessionId: z.string(), success: z.boolean(), error: z.string().optional(),
  })),
  FetchResult: BusEvent.define("git.fetch_result", z.object({
    sessionId: z.string(), success: z.boolean(), error: z.string().optional(),
  })),
  InitResult: BusEvent.define("git.init_result", z.object({
    sessionId: z.string(), success: z.boolean(), error: z.string().optional(),
  })),
};
