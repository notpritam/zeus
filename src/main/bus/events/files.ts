import z from "zod";
import { BusEvent } from "../event";

export const FilesEvents = {
  Connected: BusEvent.define("files.connected", z.object({ sessionId: z.string() })),
  DirectoryListing: BusEvent.define("files.directory_listing", z.object({
    sessionId: z.string(), dirPath: z.string(), entries: z.unknown(),
  })),
  ReadFileResult: BusEvent.define("files.read_file_result", z.object({
    sessionId: z.string(), filePath: z.string(), content: z.string(), language: z.string(),
  })),
  ReadFileError: BusEvent.define("files.read_file_error", z.object({
    sessionId: z.string(), filePath: z.string(), error: z.string(),
  })),
  SaveFileResult: BusEvent.define("files.save_file_result", z.object({
    sessionId: z.string(), filePath: z.string(), success: z.boolean(), error: z.string().optional(),
  })),
  FilesChanged: BusEvent.define("files.changed", z.object({
    sessionId: z.string(), directories: z.array(z.string()),
  })),
  SearchResult: BusEvent.define("files.search_result", z.object({
    sessionId: z.string(), query: z.string(), results: z.unknown(),
  })),
  ScanResult: BusEvent.define("files.scan_result", z.object({
    sessionId: z.string(), ext: z.string(), results: z.unknown(),
  })),
  Error: BusEvent.define("files.error", z.object({ sessionId: z.string(), message: z.string() })),
};
