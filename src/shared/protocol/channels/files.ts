import z from "zod";

// ─── Client → Server ───

export const FilesStartWatching = z.object({
  type: z.literal("start_watching"),
  workingDir: z.string(),
});

export const FilesStopWatching = z.object({
  type: z.literal("stop_watching"),
});

export const FilesListDirectory = z.object({
  type: z.literal("list_directory"),
  dirPath: z.string(),
});

export const FilesReadFile = z.object({
  type: z.literal("read_file"),
  filePath: z.string(),
});

export const FilesSearchFiles = z.object({
  type: z.literal("search_files"),
  query: z.string(),
});

export const FilesScanByExtension = z.object({
  type: z.literal("scan_by_extension"),
  ext: z.string(),
});

export const FilesSaveFile = z.object({
  type: z.literal("save_file"),
  filePath: z.string(),
  content: z.string(),
});

export const FilesIncoming = z.discriminatedUnion("type", [
  FilesStartWatching,
  FilesStopWatching,
  FilesListDirectory,
  FilesReadFile,
  FilesSearchFiles,
  FilesScanByExtension,
  FilesSaveFile,
]);
export type FilesIncoming = z.infer<typeof FilesIncoming>;

// ─── Server → Client ───

export const FilesConnected = z.object({
  type: z.literal("files_connected"),
});

export const FilesChanged = z.object({
  type: z.literal("files_changed"),
  directories: z.array(z.string()),
});

export const FilesError = z.object({
  type: z.literal("files_error"),
  message: z.string(),
});

export const FilesDirectoryListing = z.object({
  type: z.literal("directory_listing"),
  dirPath: z.string(),
  entries: z.unknown(),
});

export const FilesReadFileResult = z.object({
  type: z.literal("read_file_result"),
  filePath: z.string(),
  content: z.string().nullable(),
  language: z.string().optional(),
});

export const FilesReadFileError = z.object({
  type: z.literal("read_file_error"),
  filePath: z.string(),
  error: z.string(),
});

export const FilesSearchFilesResult = z.object({
  type: z.literal("search_files_result"),
  query: z.string(),
  results: z.unknown(),
});

export const FilesScanByExtensionResult = z.object({
  type: z.literal("scan_by_extension_result"),
  ext: z.string(),
  results: z.unknown(),
});

export const FilesSaveFileResult = z.object({
  type: z.literal("save_file_result"),
  filePath: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
});

export const FilesOutgoing = z.discriminatedUnion("type", [
  FilesConnected,
  FilesChanged,
  FilesError,
  FilesDirectoryListing,
  FilesReadFileResult,
  FilesReadFileError,
  FilesSearchFilesResult,
  FilesScanByExtensionResult,
  FilesSaveFileResult,
]);
export type FilesOutgoing = z.infer<typeof FilesOutgoing>;
