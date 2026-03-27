import fs from "fs";
import os from "os";
import path from "path";
import { WebSocket } from "ws";
import type { HandlerContext } from "../router";
import type { WsEnvelope } from "../../../shared/protocol/envelope";
import type {
  SubagentPayload,
  SubagentType,
  SubagentCli,
  NormalizedEntry,
} from "../../../shared/types";
import { ClaudeSession } from "../../services/claude-session";
import type { SessionOptions } from "../../services/claude-session";
import {
  insertSubagentSession,
  updateSubagentSessionStatus,
  getSubagentSessionsByParent,
  deleteSubagentSession,
  countSubagentsByParent,
  insertSubagentEntry,
  getSubagentEntries,
  clearSubagentEntries,
  updateSubagentResumeData,
  getSubagentSession,
} from "../../db/queries/subagent";
import {
  getAllClaudeSessions,
  updateClaudeSessionQaTargetUrl,
} from "../../db/queries/claude";
import { getSubagentType, type SubagentContext } from "../../services/subagent-registry";
import { detectDevServerUrlDetailed } from "../../services/detect-dev-server";
import { QAService } from "../../services/qa";
import { AndroidQAService, findMaestroPath, findAdbPath } from "../../services/android-qa";
import { Log } from "../../log/log";
import { getQaService, setQaService, getFlowRunner } from "./qa";
import { getAndroidQAService } from "./android";

const log = Log.create({ service: "handler:subagent" });

// ─── Module-level state ───

interface SubagentRecord {
  subagentId: string;
  subagentType: SubagentType;
  cli: SubagentCli;
  parentSessionId: string;
  parentSessionType: "terminal" | "claude";
  name?: string;
  task: string;
  targetUrl?: string;
  workingDir: string;
  session: ClaudeSession | null;
  /** Claude session ID for --resume after process exits */
  claudeSessionId?: string;
  /** Last message ID for resume */
  lastMessageId?: string;
  startedAt: number;
  /** Stored responseId from zeus_qa_run so we can reply when the agent finishes */
  pendingResponseId?: string;
  /** WebSocket that initiated the run — needed to send the final response */
  pendingResponseWs?: WebSocket;
  /** Accumulate text entries for final summary */
  collectedTextEntries: string[];
}

const subagentSessions = new Map<string, SubagentRecord>();

// Track parentSessionId for external subagents (registered via zeus-bridge MCP)
const externalSubagentParentMap = new Map<string, string>();
let subagentIdCounter = 0;

/** Expose the sessions map for other handlers (e.g. qa stop_qa). */
export function getSubagentSessions(): Map<string, SubagentRecord> {
  return subagentSessions;
}

/** Kill all running subagents that belong to a given parent session. */
export function stopSubagentsByParent(parentSessionId: string): void {
  for (const [id, record] of subagentSessions) {
    if (record.parentSessionId === parentSessionId) {
      try {
        if (record.session) record.session.kill();
      } catch {
        /* already dead */
      }
      subagentSessions.delete(id);
    }
  }
}

// ─── Helpers ───

function sendEnvelopeDirect(ws: WebSocket, envelope: WsEnvelope): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(envelope));
  }
}

/** Read the qa_finish file written by the QA agent's MCP server */
function readQaFinishFile(
  qaAgentId: string,
  sessionPid?: number,
): { summary: string; status: string } | null {
  const paths = [
    path.join(os.tmpdir(), `zeus-qa-finish-${qaAgentId}.json`),
    ...(sessionPid
      ? [path.join(os.tmpdir(), `zeus-qa-finish-ppid-${sessionPid}.json`)]
      : []),
  ];
  for (const filePath of paths) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(raw);
        try {
          fs.unlinkSync(filePath);
        } catch {
          /* ignore */
        }
        console.log(`[QA Agent] Read finish file: ${filePath}`);
        return { summary: data.summary ?? "", status: data.status ?? "done" };
      }
    } catch {
      // ignore read errors
    }
  }
  return null;
}

function wireSubagent(
  record: SubagentRecord,
  broadcast: (envelope: WsEnvelope) => void,
): void {
  const { subagentId, parentSessionId } = record;
  const session = record.session!; // guaranteed non-null when wiring

  // Accumulate streaming text/thinking — only emit once finalized
  let pendingTextId: string | null = null;
  let pendingTextEntry: NormalizedEntry | null = null;
  let pendingThinkingId: string | null = null;
  let pendingThinkingEntry: NormalizedEntry | null = null;

  const emit = (entry: NormalizedEntry): void => {
    broadcast({
      channel: "subagent",
      sessionId: "",
      auth: "",
      payload: { type: "subagent_entry", subagentId, parentSessionId, entry },
    });
    insertSubagentEntry(subagentId, entry.entryType.type, JSON.stringify(entry), Date.now());
  };

  const flushPendingText = (): void => {
    if (pendingTextEntry && pendingTextEntry.content.trim()) {
      emit(pendingTextEntry);
      record.collectedTextEntries.push(pendingTextEntry.content.trim());
    }
    pendingTextId = null;
    pendingTextEntry = null;
  };

  const flushPendingThinking = (): void => {
    if (pendingThinkingEntry && pendingThinkingEntry.content.trim()) {
      emit(pendingThinkingEntry);
    }
    pendingThinkingId = null;
    pendingThinkingEntry = null;
  };

  session.on("entry", async (entry: NormalizedEntry) => {
    // Accumulate assistant_message streaming
    if (entry.entryType.type === "assistant_message") {
      if (entry.id !== pendingTextId) {
        flushPendingText();
        pendingTextId = entry.id;
      }
      pendingTextEntry = entry;
      return;
    }
    flushPendingText();

    // Accumulate thinking streaming
    if (entry.entryType.type === "thinking") {
      if (entry.id !== pendingThinkingId) {
        flushPendingThinking();
        pendingThinkingId = entry.id;
      }
      pendingThinkingEntry = entry;
      return;
    }
    flushPendingThinking();

    // For screenshot tool results, attach captured image as metadata
    if (entry.entryType.type === "tool_use") {
      const { toolName, status } = entry.entryType;
      const isScreenshot = /screenshot/i.test(toolName);
      if (isScreenshot && status === "success") {
        const qaService = getQaService();
        if (qaService?.isRunning()) {
          try {
            const imageData = await qaService.screenshot();
            if (imageData) {
              const meta = (entry.metadata ?? {}) as Record<string, unknown>;
              meta.images = [imageData];
              entry = { ...entry, metadata: meta };
            }
          } catch {
            /* non-critical */
          }
        } else if (record.subagentType === "android_qa") {
          const androidService = getAndroidQAService();
          if (androidService.isRunning()) {
            try {
              const imageData = await androidService.screenshot();
              if (imageData) {
                const meta = (entry.metadata ?? {}) as Record<string, unknown>;
                meta.images = [imageData];
                entry = { ...entry, metadata: meta };
              }
            } catch {
              /* non-critical */
            }
          }
        }
      }
    }

    // Pass through all other entry types as-is
    emit(entry);
  });

  session.on("approval_needed", (approval) => {
    if (approval.toolName === "AskUserQuestion") {
      session.approveTool(approval.approvalId);
    }
  });

  // Turn ended (process still alive) — send deferred response and kill
  session.on("result", () => {
    console.log(
      `[Subagent] result event fired for ${subagentId} (pendingResponseId=${record.pendingResponseId ?? "NONE"}, wsState=${record.pendingResponseWs?.readyState ?? "NO_WS"}, pid=${session.pid}, isRunning=${session.isRunning})`,
    );
    flushPendingText();
    flushPendingThinking();

    record.claudeSessionId = session.sessionId ?? undefined;
    record.lastMessageId = session.lastMessageId ?? undefined;
    updateSubagentResumeData(
      subagentId,
      record.claudeSessionId ?? null,
      record.lastMessageId ?? null,
    );

    updateSubagentSessionStatus(subagentId, "stopped", Date.now());
    broadcast({
      channel: "subagent",
      sessionId: "",
      auth: "",
      payload: { type: "subagent_stopped", subagentId, parentSessionId },
    });

    if (record.pendingResponseId && record.pendingResponseWs) {
      const finishData = readQaFinishFile(subagentId, session.pid);
      let summary: string;
      let status: string;

      if (finishData) {
        summary = finishData.summary;
        status = finishData.status;
      } else {
        const lastEntries = record.collectedTextEntries;
        summary =
          lastEntries.length > 0
            ? lastEntries[lastEntries.length - 1]
            : "Subagent completed (no qa_finish called).";
        status = "done";
      }

      try {
        sendEnvelopeDirect(record.pendingResponseWs, {
          channel: "subagent",
          sessionId: "",
          auth: "",
          payload: {
            type: "start_subagent_response",
            responseId: record.pendingResponseId,
            subagentId,
            status,
            summary,
          },
        });
      } catch (err) {
        console.error(
          `[Subagent] result: failed to send deferred response for ${subagentId}:`,
          (err as Error).message,
        );
      }
      record.pendingResponseId = undefined;
      record.pendingResponseWs = undefined;

      if (record.session && record.session.isRunning) {
        record.session.kill();
      }
    }
  });

  session.on("done", () => {
    console.log(
      `[Subagent] done event fired for ${subagentId} (pendingResponseId=${record.pendingResponseId ?? "NONE"})`,
    );
    flushPendingText();
    flushPendingThinking();
    updateSubagentSessionStatus(subagentId, "stopped", Date.now());

    record.claudeSessionId = session.sessionId ?? undefined;
    record.lastMessageId = session.lastMessageId ?? undefined;
    record.session = null;
    updateSubagentResumeData(
      subagentId,
      record.claudeSessionId ?? null,
      record.lastMessageId ?? null,
    );

    if (record.pendingResponseId && record.pendingResponseWs) {
      const finishData = readQaFinishFile(subagentId, session.pid);
      let summary: string;
      let status: string;

      if (finishData) {
        summary = finishData.summary;
        status = finishData.status;
      } else {
        const lastEntries = record.collectedTextEntries;
        summary =
          lastEntries.length > 0
            ? lastEntries[lastEntries.length - 1]
            : "Subagent completed without a summary.";
        status = "done";
      }

      try {
        sendEnvelopeDirect(record.pendingResponseWs, {
          channel: "subagent",
          sessionId: "",
          auth: "",
          payload: {
            type: "start_subagent_response",
            responseId: record.pendingResponseId,
            subagentId,
            status,
            summary,
          },
        });
      } catch (err) {
        console.error(
          `[Subagent] done: failed to send deferred response for ${subagentId}:`,
          (err as Error).message,
        );
      }
      record.pendingResponseId = undefined;
      record.pendingResponseWs = undefined;
    }

    broadcast({
      channel: "subagent",
      sessionId: "",
      auth: "",
      payload: { type: "subagent_stopped", subagentId, parentSessionId },
    });
  });

  session.on("error", (err) => {
    console.error(
      `[Subagent] error event fired for ${subagentId}: ${err.message}`,
    );
    flushPendingText();
    flushPendingThinking();
    const crashEntry = {
      kind: "error" as const,
      message: `Agent crashed: ${err.message}`,
      timestamp: Date.now(),
    };
    insertSubagentEntry(
      subagentId,
      crashEntry.kind,
      JSON.stringify(crashEntry),
      crashEntry.timestamp,
    );
    updateSubagentSessionStatus(subagentId, "error", Date.now());

    record.claudeSessionId = session.sessionId ?? undefined;
    record.lastMessageId = session.lastMessageId ?? undefined;
    record.session = null;
    updateSubagentResumeData(
      subagentId,
      record.claudeSessionId ?? null,
      record.lastMessageId ?? null,
    );

    if (record.pendingResponseId && record.pendingResponseWs) {
      try {
        sendEnvelopeDirect(record.pendingResponseWs, {
          channel: "subagent",
          sessionId: "",
          auth: "",
          payload: {
            type: "start_subagent_response",
            responseId: record.pendingResponseId,
            subagentId,
            status: "error",
            summary: `Agent crashed: ${err.message}`,
          },
        });
      } catch {
        // WebSocket may have closed — non-critical
      }
    }

    broadcast({
      channel: "subagent",
      sessionId: "",
      auth: "",
      payload: {
        type: "subagent_entry",
        subagentId,
        parentSessionId,
        entry: crashEntry,
      },
    });
    broadcast({
      channel: "subagent",
      sessionId: "",
      auth: "",
      payload: { type: "subagent_stopped", subagentId, parentSessionId },
    });
  });
}

// ─── Main handler ───

export async function handleSubagent(ctx: HandlerContext): Promise<void> {
  const { ws, envelope } = ctx;
  const payload = envelope.payload as SubagentPayload;

  if (payload.type === "start_subagent") {
    const subagentType: SubagentType = payload.subagentType ?? "qa";
    const cli: SubagentCli = payload.cli ?? "claude";
    const inputs = payload.inputs ?? {};
    const task = inputs.task ?? "";
    const workingDir = payload.workingDir;
    const parentSessionId = payload.parentSessionId;
    const parentSessionType = payload.parentSessionType;
    const definition = getSubagentType(subagentType);

    console.log(`[Subagent] start_subagent received:`, {
      subagentType,
      cli,
      task,
      parentSessionId,
      parentSessionType,
      workingDir,
    });

    try {
      // QA-specific setup: ensure PinchTab is running
      if (subagentType === "qa") {
        let qaService = getQaService();
        if (!qaService?.isRunning()) {
          qaService = new QAService();
          setQaService(qaService);
          await qaService.start();
          ctx.broadcast({
            channel: "qa",
            sessionId: "",
            auth: "",
            payload: { type: "qa_started" },
          });
        }
        const instances = await qaService!.listInstances();
        if (instances.length === 0) {
          const instance = await qaService!.launchInstance(true);
          ctx.broadcast({
            channel: "qa",
            sessionId: "",
            auth: "",
            payload: { type: "instance_launched", instance },
          });
          const cdp = qaService!.getCdpClient();
          if (cdp) {
            cdp.on("console", (entry) => {
              ctx.broadcast({
                channel: "qa",
                sessionId: "",
                auth: "",
                payload: { type: "cdp_console", logs: [entry] },
              });
            });
            cdp.on("network", (entry) => {
              ctx.broadcast({
                channel: "qa",
                sessionId: "",
                auth: "",
                payload: { type: "cdp_network", requests: [entry] },
              });
            });
            cdp.on("js_error", (entry) => {
              ctx.broadcast({
                channel: "qa",
                sessionId: "",
                auth: "",
                payload: { type: "cdp_error", errors: [entry] },
              });
            });
            cdp.on("navigated", ({ url, title }: { url: string; title: string }) => {
              ctx.broadcast({
                channel: "qa",
                sessionId: "",
                auth: "",
                payload: { type: "navigate_result", url, title },
              });
            });
          }
        }
      }

      // Android QA-specific setup
      if (subagentType === "android_qa") {
        const androidService = getAndroidQAService();

        let device = await androidService.detectRunning();
        if (!device) {
          device = await androidService.start(inputs.avdName);
        }

        androidService.removeAllListeners("logcat");
        androidService.on("logcat", (entries) => {
          ctx.broadcast({
            channel: "android",
            sessionId: "",
            auth: "",
            payload: { type: "logcat_entries", entries },
          });
        });

        if (inputs.appId) {
          await androidService.launchApp(inputs.appId);
        }

        inputs.deviceId = device.deviceId;
      }

      // Resolve target URL
      let targetUrl: string | undefined = inputs.targetUrl;
      if (subagentType === "qa") {
        if (!targetUrl) {
          const parentSessions = getAllClaudeSessions();
          const parentSession = parentSessions.find((s) => s.id === parentSessionId);
          targetUrl =
            parentSession?.qaTargetUrl || process.env.ZEUS_QA_DEFAULT_URL || undefined;
        }
        if (!targetUrl) {
          const detected = await detectDevServerUrlDetailed(workingDir);
          if (detected.url) {
            targetUrl = detected.url;
            console.log(
              `[Subagent] Auto-detected target URL: ${detected.url} (${detected.detail})`,
            );
            if (parentSessionId) {
              updateClaudeSessionQaTargetUrl(parentSessionId, detected.url);
            }
          } else {
            console.warn(
              `[Subagent] No target URL detected — agent will start without a URL. Detail: ${detected.detail}`,
            );
          }
        }
      }

      // Build context for prompt generation
      const context: SubagentContext = {
        workingDir,
        parentSessionId,
        parentSessionType,
        targetUrl,
      };

      if (subagentType !== "qa" && inputs.filePath) {
        try {
          context.fileContent = fs.readFileSync(
            path.resolve(workingDir, inputs.filePath),
            "utf-8",
          );
        } catch {
          /* ignore */
        }
      }

      // Flow Resolution (QA-specific)
      const flowRunner = getFlowRunner();
      if (subagentType === "qa") {
        const resolved = flowRunner.resolve(task, {
          flowId: inputs.flowId,
          personas: inputs.personas
            ? inputs.personas.split(",").map((p: string) => p.trim())
            : undefined,
        });

        if (resolved) {
          context.resolvedFlow = resolved;

          const personaPromises = resolved.personas.map(async (persona) => {
            const sid = `subagent-${++subagentIdCounter}-${Date.now()}-${persona.id}`;
            const agentName = payload.name
              ? `${payload.name} (${persona.id})`
              : `${resolved.flow.name} — ${persona.id}`;

            const sessionOpts: SessionOptions = {
              workingDir,
              permissionMode: definition?.permissionMode ?? "bypassPermissions",
              enableQA: true,
              qaTargetUrl: targetUrl,
              zeusSessionId: parentSessionId,
              subagentId: sid,
            };
            if (definition?.mcpServers?.length) {
              sessionOpts.mcpServers = definition.mcpServers;
            }
            const sessionInstance = new ClaudeSession(sessionOpts);

            const rec: SubagentRecord = {
              subagentId: sid,
              subagentType,
              cli,
              parentSessionId,
              parentSessionType,
              name: agentName,
              task: `[Flow: ${resolved.flow.id}] ${persona.id}`,
              targetUrl,
              workingDir,
              session: sessionInstance,
              startedAt: Date.now(),
              pendingResponseId: payload.responseId,
              pendingResponseWs: ws,
              collectedTextEntries: [],
            };

            subagentSessions.set(sid, rec);
            wireSubagent(rec, ctx.broadcast);

            insertSubagentSession({
              id: sid,
              parentSessionId,
              parentSessionType,
              name: agentName ?? null,
              task: rec.task,
              targetUrl: targetUrl ?? null,
              status: "running",
              startedAt: rec.startedAt,
              endedAt: null,
              workingDir,
              subagentType,
              cli,
            });

            ctx.broadcast({
              channel: "subagent",
              sessionId: "",
              auth: "",
              payload: {
                type: "subagent_started",
                subagentId: sid,
                subagentType,
                cli,
                parentSessionId,
                parentSessionType,
                name: agentName,
                task: rec.task,
                targetUrl,
              },
            });

            const effectiveUrl = targetUrl || "http://localhost:5173";
            const flowSection = flowRunner.buildAgentPrompt(
              resolved.flow,
              persona,
              effectiveUrl,
            );
            const flowPrompt = definition
              ? definition.buildPrompt(
                  { ...inputs, task: flowSection },
                  { ...context, targetUrl: effectiveUrl },
                )
              : flowSection;

            const initialMsgEntry: NormalizedEntry = {
              id: `subagent-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              timestamp: new Date().toISOString(),
              entryType: { type: "user_message" },
              content: flowSection,
            };
            ctx.broadcast({
              channel: "subagent",
              sessionId: "",
              auth: "",
              payload: {
                type: "subagent_entry",
                subagentId: sid,
                parentSessionId,
                entry: initialMsgEntry,
              },
            });
            insertSubagentEntry(
              sid,
              "user_message",
              JSON.stringify(initialMsgEntry),
              Date.now(),
            );

            await sessionInstance.start(flowPrompt);
          });

          await Promise.all(personaPromises);
          return; // Skip the free-form path below
        }
      }

      // Free-form / non-QA fallback
      const subagentId = `subagent-${++subagentIdCounter}-${Date.now()}`;

      const sessionOpts: SessionOptions = {
        workingDir,
        permissionMode: definition?.permissionMode ?? "bypassPermissions",
        enableQA: subagentType === "qa",
        qaTargetUrl: targetUrl,
        zeusSessionId: parentSessionId,
        subagentId,
      };
      if (definition?.mcpServers?.length) {
        sessionOpts.mcpServers = definition.mcpServers;
      }

      // Android QA: clone registry mcpServers and resolve maestro path at spawn time
      if (subagentType === "android_qa" && definition?.mcpServers?.length) {
        const clonedServers = definition.mcpServers.map((s) => ({
          ...s,
          args: s.args ? [...s.args] : undefined,
          env: s.env ? { ...s.env } : undefined,
        }));

        const maestroServer = clonedServers.find((s) => s.name === "maestro");
        if (maestroServer) {
          maestroServer.command = findMaestroPath();
        }

        const extrasServer = clonedServers.find((s) => s.name === "android-qa-extras");
        if (extrasServer) {
          let adbPathResolved = "adb";
          try {
            adbPathResolved = findAdbPath();
          } catch {
            /* fallback to bare adb */
          }
          extrasServer.env = {
            ...(extrasServer.env ?? {}),
            ZEUS_ANDROID_DEVICE_ID: inputs.deviceId ?? "",
            ZEUS_ANDROID_ADB_PATH: adbPathResolved,
          };
        }

        sessionOpts.mcpServers = clonedServers;
      }

      const session = new ClaudeSession(sessionOpts);

      const agentName = payload.name || undefined;
      const record: SubagentRecord = {
        subagentId,
        subagentType,
        cli,
        parentSessionId,
        parentSessionType,
        name: agentName,
        task,
        targetUrl,
        workingDir,
        session,
        startedAt: Date.now(),
        pendingResponseId: payload.responseId,
        pendingResponseWs: ws,
        collectedTextEntries: [],
      };

      subagentSessions.set(subagentId, record);
      wireSubagent(record, ctx.broadcast);

      insertSubagentSession({
        id: subagentId,
        parentSessionId,
        parentSessionType,
        name: agentName ?? null,
        task,
        targetUrl: targetUrl ?? null,
        status: "running",
        startedAt: record.startedAt,
        endedAt: null,
        workingDir,
        subagentType,
        cli,
      });

      console.log("[Subagent] Agent started successfully:", subagentId);
      ctx.broadcast({
        channel: "subagent",
        sessionId: "",
        auth: "",
        payload: {
          type: "subagent_started",
          subagentId,
          subagentType,
          cli,
          parentSessionId,
          parentSessionType,
          name: agentName,
          task,
          targetUrl,
        },
      });

      const initialMsgEntry: NormalizedEntry = {
        id: `subagent-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        entryType: { type: "user_message" },
        content: task,
      };
      ctx.broadcast({
        channel: "subagent",
        sessionId: "",
        auth: "",
        payload: {
          type: "subagent_entry",
          subagentId,
          parentSessionId,
          entry: initialMsgEntry,
        },
      });
      insertSubagentEntry(
        subagentId,
        "user_message",
        JSON.stringify(initialMsgEntry),
        Date.now(),
      );

      const prompt = definition ? definition.buildPrompt(inputs, context) : task;
      await session.start(prompt);
    } catch (err) {
      console.error(
        "[Subagent] Failed to start:",
        (err as Error).message,
        (err as Error).stack,
      );
      ctx.send({
        channel: "subagent",
        sessionId: "",
        auth: "",
        payload: {
          type: "subagent_error",
          message: `Failed to start subagent: ${(err as Error).message}`,
        },
      });
    }
  } else if (payload.type === "stop_subagent") {
    const record = subagentSessions.get(payload.subagentId);
    if (record && record.session && record.session.isRunning) {
      try {
        await record.session.interrupt();

        const interruptEntry: NormalizedEntry = {
          id: `subagent-interrupt-${Date.now()}`,
          timestamp: new Date().toISOString(),
          entryType: { type: "system_message" },
          content: "Agent interrupted — you can send a new message.",
        };
        ctx.broadcast({
          channel: "subagent",
          sessionId: "",
          auth: "",
          payload: {
            type: "subagent_entry",
            subagentId: payload.subagentId,
            parentSessionId: record.parentSessionId,
            entry: interruptEntry,
          },
        });
        insertSubagentEntry(
          payload.subagentId,
          "system_message",
          JSON.stringify(interruptEntry),
          Date.now(),
        );
      } catch {
        // interrupt() failed — process is likely already dead
      }
      updateSubagentSessionStatus(payload.subagentId, "stopped");
      ctx.broadcast({
        channel: "subagent",
        sessionId: "",
        auth: "",
        payload: {
          type: "subagent_stopped",
          subagentId: payload.subagentId,
          parentSessionId: record.parentSessionId,
        },
      });
    } else if (record) {
      ctx.broadcast({
        channel: "subagent",
        sessionId: "",
        auth: "",
        payload: {
          type: "subagent_stopped",
          subagentId: payload.subagentId,
          parentSessionId: record.parentSessionId,
        },
      });
    } else {
      ctx.broadcast({
        channel: "subagent",
        sessionId: "",
        auth: "",
        payload: {
          type: "subagent_stopped",
          subagentId: payload.subagentId,
          parentSessionId: "",
        },
      });
    }
  } else if (payload.type === "delete_subagent") {
    const record = subagentSessions.get(payload.subagentId);
    if (record) {
      if (record.session && record.session.isRunning) {
        record.session.kill();
      }
      subagentSessions.delete(payload.subagentId);
    }
    deleteSubagentSession(payload.subagentId);
    ctx.broadcast({
      channel: "subagent",
      sessionId: "",
      auth: "",
      payload: {
        type: "subagent_deleted",
        subagentId: payload.subagentId,
        parentSessionId: payload.parentSessionId,
      },
    });
  } else if (payload.type === "list_subagents") {
    const inMemoryIds = new Set<string>();
    const inMemoryAgents = Array.from(subagentSessions.values())
      .filter((r) => r.parentSessionId === payload.parentSessionId)
      .map((r) => {
        inMemoryIds.add(r.subagentId);
        const isAlive = r.session !== null && r.session.isRunning;
        return {
          subagentId: r.subagentId,
          subagentType: r.subagentType,
          cli: r.cli,
          parentSessionId: r.parentSessionId,
          parentSessionType: r.parentSessionType,
          name: r.name,
          task: r.task,
          targetUrl: r.targetUrl,
          status: isAlive ? ("running" as const) : ("stopped" as const),
          startedAt: r.startedAt,
        };
      });

    const dbAgents = getSubagentSessionsByParent(payload.parentSessionId)
      .filter((r) => !inMemoryIds.has(r.id))
      .map((r) => ({
        subagentId: r.id,
        subagentType: (r.subagentType ?? "qa") as SubagentType,
        cli: (r.cli ?? "claude") as SubagentCli,
        parentSessionId: r.parentSessionId,
        parentSessionType: r.parentSessionType,
        name: r.name ?? undefined,
        task: r.task,
        targetUrl: r.targetUrl ?? undefined,
        status: r.status as "stopped" | "error",
        startedAt: r.startedAt,
      }));

    const agents = [...inMemoryAgents, ...dbAgents];
    ctx.send({
      channel: "subagent",
      sessionId: "",
      auth: "",
      payload: {
        type: "subagent_list",
        parentSessionId: payload.parentSessionId,
        agents,
      },
    });
  } else if (payload.type === "subagent_message") {
    let record = subagentSessions.get(payload.subagentId);

    if (!record) {
      const dbRow = getSubagentSession(payload.subagentId);
      if (dbRow) {
        record = {
          subagentId: dbRow.id,
          subagentType: (dbRow.subagentType ?? "qa") as SubagentType,
          cli: (dbRow.cli ?? "claude") as SubagentCli,
          parentSessionId: dbRow.parentSessionId,
          parentSessionType: dbRow.parentSessionType,
          name: dbRow.name ?? undefined,
          task: dbRow.task,
          targetUrl: dbRow.targetUrl ?? undefined,
          workingDir: dbRow.workingDir || process.cwd(),
          session: null,
          claudeSessionId: dbRow.claudeSessionId ?? undefined,
          lastMessageId: dbRow.lastMessageId ?? undefined,
          startedAt: dbRow.startedAt,
          collectedTextEntries: [],
        };
        subagentSessions.set(dbRow.id, record);
      }
    }

    if (!record) {
      ctx.send({
        channel: "subagent",
        sessionId: "",
        auth: "",
        payload: { type: "subagent_error", message: "No subagent found with that ID" },
      });
      return;
    }

    const userMsgEntry: NormalizedEntry = {
      id: `subagent-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      entryType: { type: "user_message" },
      content: payload.text,
    };
    ctx.broadcast({
      channel: "subagent",
      sessionId: "",
      auth: "",
      payload: {
        type: "subagent_entry",
        subagentId: payload.subagentId,
        parentSessionId: record.parentSessionId,
        entry: userMsgEntry,
      },
    });
    insertSubagentEntry(
      payload.subagentId,
      "user_message",
      JSON.stringify(userMsgEntry),
      Date.now(),
    );

    try {
      updateSubagentSessionStatus(record.subagentId, "running");
      ctx.broadcast({
        channel: "subagent",
        sessionId: "",
        auth: "",
        payload: {
          type: "subagent_started",
          subagentId: record.subagentId,
          subagentType: record.subagentType,
          cli: record.cli,
          parentSessionId: record.parentSessionId,
          parentSessionType: record.parentSessionType,
          name: record.name,
          task: record.task,
          targetUrl: record.targetUrl,
        },
      });

      if (record.session && record.session.isRunning) {
        console.log(
          `[Subagent] Sending follow-up to alive session ${record.subagentId}`,
        );
        await record.session.sendMessage(payload.text);
      } else {
        console.log(
          `[Subagent] Starting new session for agent ${record.subagentId} (resume=${!!record.claudeSessionId})`,
        );
        const definition = getSubagentType(record.subagentType);
        const resolvedTargetUrl =
          record.targetUrl ||
          process.env.ZEUS_QA_DEFAULT_URL ||
          "http://localhost:5173";
        const sessionOpts: SessionOptions = {
          workingDir: record.workingDir,
          permissionMode: definition?.permissionMode ?? "bypassPermissions",
          enableQA: record.subagentType === "qa",
          qaTargetUrl: resolvedTargetUrl,
          zeusSessionId: record.parentSessionId,
          subagentId: record.subagentId,
        };
        if (definition?.mcpServers?.length) {
          sessionOpts.mcpServers = definition.mcpServers;
        }
        if (record.claudeSessionId) {
          sessionOpts.resumeSessionId = record.claudeSessionId;
          sessionOpts.resumeAtMessageId = record.lastMessageId ?? undefined;
        }
        const newSession = new ClaudeSession(sessionOpts);
        record.session = newSession;
        record.collectedTextEntries = [];
        wireSubagent(record, ctx.broadcast);

        const prompt = record.claudeSessionId
          ? payload.text
          : definition
            ? definition.buildPrompt(
                { task: payload.text },
                {
                  workingDir: record.workingDir,
                  parentSessionId: record.parentSessionId,
                  parentSessionType: record.parentSessionType,
                  targetUrl: resolvedTargetUrl,
                },
              )
            : payload.text;
        await newSession.start(prompt);
      }
    } catch (err) {
      console.error(
        `[Subagent] Failed to send message to agent ${record.subagentId}:`,
        (err as Error).message,
      );
      updateSubagentSessionStatus(record.subagentId, "stopped");
      ctx.broadcast({
        channel: "subagent",
        sessionId: "",
        auth: "",
        payload: {
          type: "subagent_stopped",
          subagentId: record.subagentId,
          parentSessionId: record.parentSessionId,
        },
      });
      const errorEntry: NormalizedEntry = {
        id: `subagent-error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        entryType: { type: "error_message", errorType: "other" },
        content: `Failed to send message: ${(err as Error).message}`,
      };
      ctx.broadcast({
        channel: "subagent",
        sessionId: "",
        auth: "",
        payload: {
          type: "subagent_entry",
          subagentId: record.subagentId,
          parentSessionId: record.parentSessionId,
          entry: errorEntry,
        },
      });
      insertSubagentEntry(
        record.subagentId,
        "error_message",
        JSON.stringify(errorEntry),
        Date.now(),
      );
    }
  } else if (payload.type === "clear_subagent_entries") {
    clearSubagentEntries(payload.subagentId);
    const record = subagentSessions.get(payload.subagentId);
    if (record) {
      record.collectedTextEntries = [];
    }
  } else if (payload.type === "get_subagent_entries") {
    const dbEntries = getSubagentEntries(payload.subagentId);
    const entries = dbEntries
      .map((row) => JSON.parse(row.data) as NormalizedEntry)
      .filter((e) => e.entryType);
    ctx.send({
      channel: "subagent",
      sessionId: "",
      auth: "",
      payload: {
        type: "subagent_entries",
        subagentId: payload.subagentId,
        entries,
      },
    });
  } else if (payload.type === "register_external_subagent") {
    const subagentId = `subagent-ext-${++subagentIdCounter}-${Date.now()}`;
    const parentSessionId = payload.parentSessionId || "external";
    const parentSessionType = payload.parentSessionType || "claude";
    const subagentType: SubagentType = payload.subagentType ?? "qa";
    const task = payload.task || "External subagent task";
    const resolvedTargetUrl =
      payload.targetUrl || process.env.ZEUS_QA_DEFAULT_URL || "http://localhost:5173";
    const agentName = payload.name || undefined;

    insertSubagentSession({
      id: subagentId,
      parentSessionId,
      parentSessionType,
      name: agentName ?? null,
      task,
      targetUrl: resolvedTargetUrl,
      status: "running",
      startedAt: Date.now(),
      endedAt: null,
      subagentType,
      cli: "claude",
    });

    ctx.broadcast({
      channel: "subagent",
      sessionId: "",
      auth: "",
      payload: {
        type: "subagent_started",
        subagentId,
        subagentType,
        cli: "claude" as SubagentCli,
        parentSessionId,
        parentSessionType,
        name: agentName,
        task,
        targetUrl: resolvedTargetUrl,
      },
    });

    ctx.send({
      channel: "subagent",
      sessionId: "",
      auth: "",
      payload: {
        type: "register_external_subagent_response",
        subagentId,
        responseId: payload.responseId,
      },
    });

    externalSubagentParentMap.set(subagentId, parentSessionId);
    console.log(
      `[Subagent] External agent registered: ${subagentId} (parent: ${parentSessionId})`,
    );
  } else if (payload.type === "external_subagent_entry") {
    const { subagentId, entry: rawEntry } = payload as {
      subagentId: string;
      entry: { kind: string; timestamp: number; [key: string]: unknown };
    };
    if (!subagentId || !rawEntry) return;

    const normalizedEntry = rawEntry as unknown as NormalizedEntry;

    insertSubagentEntry(
      subagentId,
      normalizedEntry.entryType.type,
      JSON.stringify(normalizedEntry),
      Date.now(),
    );
    const parentSessionId =
      externalSubagentParentMap.get(subagentId) ?? "external";
    ctx.broadcast({
      channel: "subagent",
      sessionId: "",
      auth: "",
      payload: {
        type: "subagent_entry",
        subagentId,
        parentSessionId,
        entry: normalizedEntry,
      },
    });
  } else if (payload.type === "external_subagent_done") {
    const { subagentId, status } = payload as {
      subagentId: string;
      status: string;
    };
    if (!subagentId) return;

    updateSubagentSessionStatus(subagentId, status || "stopped", Date.now());
    const parentSessionId =
      externalSubagentParentMap.get(subagentId) ?? "external";
    ctx.broadcast({
      channel: "subagent",
      sessionId: "",
      auth: "",
      payload: { type: "subagent_stopped", subagentId, parentSessionId },
    });
    externalSubagentParentMap.delete(subagentId);

    console.log(`[Subagent] External agent stopped: ${subagentId} (${status})`);
  } else {
    ctx.send({
      channel: "subagent",
      sessionId: "",
      payload: {
        type: "subagent_error",
        message: `Unknown subagent type: ${(payload as { type: string }).type}`,
      },
      auth: "",
    });
  }
}
