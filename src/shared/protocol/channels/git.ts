import z from "zod";

// ─── Client → Server ───

export const GitStartWatching = z.object({
  type: z.literal("start_watching"),
  workingDir: z.string(),
});

export const GitStopWatching = z.object({
  type: z.literal("stop_watching"),
});

export const GitRefresh = z.object({
  type: z.literal("refresh"),
});

export const GitStage = z.object({
  type: z.literal("git_stage"),
  files: z.array(z.string()),
});

export const GitUnstage = z.object({
  type: z.literal("git_unstage"),
  files: z.array(z.string()),
});

export const GitStageAll = z.object({
  type: z.literal("git_stage_all"),
});

export const GitUnstageAll = z.object({
  type: z.literal("git_unstage_all"),
});

export const GitDiscard = z.object({
  type: z.literal("git_discard"),
  files: z.array(z.string()),
});

export const GitFileContents = z.object({
  type: z.literal("git_file_contents"),
  file: z.string(),
  staged: z.boolean(),
});

export const GitSaveFile = z.object({
  type: z.literal("git_save_file"),
  file: z.string(),
  content: z.string(),
});

export const GitCommit = z.object({
  type: z.literal("git_commit"),
  message: z.string(),
});

export const GitListBranches = z.object({
  type: z.literal("git_list_branches"),
});

export const GitCheckout = z.object({
  type: z.literal("git_checkout"),
  branch: z.string(),
});

export const GitCreateBranch = z.object({
  type: z.literal("git_create_branch"),
  branch: z.string(),
  checkout: z.boolean().optional(),
});

export const GitDeleteBranch = z.object({
  type: z.literal("git_delete_branch"),
  branch: z.string(),
  force: z.boolean().optional(),
});

export const GitPush = z.object({
  type: z.literal("git_push"),
  force: z.boolean().optional(),
});

export const GitPull = z.object({
  type: z.literal("git_pull"),
});

export const GitFetch = z.object({
  type: z.literal("git_fetch"),
});

export const GitInit = z.object({
  type: z.literal("git_init"),
  workingDir: z.string(),
});

export const GitIncoming = z.discriminatedUnion("type", [
  GitStartWatching,
  GitStopWatching,
  GitRefresh,
  GitStage,
  GitUnstage,
  GitStageAll,
  GitUnstageAll,
  GitDiscard,
  GitFileContents,
  GitSaveFile,
  GitCommit,
  GitListBranches,
  GitCheckout,
  GitCreateBranch,
  GitDeleteBranch,
  GitPush,
  GitPull,
  GitFetch,
  GitInit,
]);
export type GitIncoming = z.infer<typeof GitIncoming>;

// ─── Server → Client ───

export const GitConnected = z.object({
  type: z.literal("git_connected"),
});

export const GitDisconnected = z.object({
  type: z.literal("git_disconnected"),
});

export const GitHeartbeat = z.object({
  type: z.literal("git_heartbeat"),
});

export const GitStatus = z.object({
  type: z.literal("git_status"),
  data: z.unknown(),
});

export const GitNotARepo = z.object({
  type: z.literal("not_a_repo"),
});

export const GitError = z.object({
  type: z.literal("git_error"),
  message: z.string(),
});

export const GitFileContentsResult = z.object({
  type: z.literal("git_file_contents_result"),
  file: z.string(),
  staged: z.boolean(),
  original: z.string().nullable(),
  modified: z.string().nullable(),
  language: z.string().optional(),
});

export const GitFileContentsError = z.object({
  type: z.literal("git_file_contents_error"),
  file: z.string(),
  error: z.string(),
});

export const GitSaveFileResult = z.object({
  type: z.literal("git_save_file_result"),
  file: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
});

export const GitCommitResult = z.object({
  type: z.literal("git_commit_result"),
  success: z.boolean(),
  error: z.string().optional(),
  hash: z.string().optional(),
});

export const GitBranchesResult = z.object({
  type: z.literal("git_branches_result"),
  branches: z.unknown(),
});

export const GitCheckoutResult = z.object({
  type: z.literal("git_checkout_result"),
  success: z.boolean(),
  error: z.string().optional(),
  branch: z.string().optional(),
});

export const GitCreateBranchResult = z.object({
  type: z.literal("git_create_branch_result"),
  success: z.boolean(),
  error: z.string().optional(),
  branch: z.string().optional(),
});

export const GitDeleteBranchResult = z.object({
  type: z.literal("git_delete_branch_result"),
  success: z.boolean(),
  error: z.string().optional(),
});

export const GitPushResult = z.object({
  type: z.literal("git_push_result"),
  success: z.boolean(),
  error: z.string().optional(),
});

export const GitPullResult = z.object({
  type: z.literal("git_pull_result"),
  success: z.boolean(),
  error: z.string().optional(),
});

export const GitFetchResult = z.object({
  type: z.literal("git_fetch_result"),
  success: z.boolean(),
  error: z.string().optional(),
});

export const GitInitResult = z.object({
  type: z.literal("git_init_result"),
  success: z.boolean(),
  error: z.string().optional(),
});

export const GitOutgoing = z.discriminatedUnion("type", [
  GitConnected,
  GitDisconnected,
  GitHeartbeat,
  GitStatus,
  GitNotARepo,
  GitError,
  GitFileContentsResult,
  GitFileContentsError,
  GitSaveFileResult,
  GitCommitResult,
  GitBranchesResult,
  GitCheckoutResult,
  GitCreateBranchResult,
  GitDeleteBranchResult,
  GitPushResult,
  GitPullResult,
  GitFetchResult,
  GitInitResult,
]);
export type GitOutgoing = z.infer<typeof GitOutgoing>;
