import path from "path";
import { app } from "electron";
import type { HandlerContext } from "../router";
import type { QaBrowserPayload } from "../../../shared/types";
import { QAService } from "../../services/qa";
import { FlowRunner } from "../../services/flow-runner";
import { Log } from "../../log/log";

const log = Log.create({ service: "handler:qa" });

// QA service (singleton PinchTab server)
let qaService: QAService | null = null;

// QA flow runner — loads structured flow definitions from qa-flows/
const flowRunner = new FlowRunner(path.join(app.getAppPath(), "qa-flows"));

export function getQaService(): QAService | null {
  return qaService;
}

export function setQaService(service: QAService | null): void {
  qaService = service;
}

export function getFlowRunner(): FlowRunner {
  return flowRunner;
}

export async function handleQa(ctx: HandlerContext): Promise<void> {
  const { ws, envelope } = ctx;
  const payload = envelope.payload as QaBrowserPayload & { responseId?: string };

  if (payload.type === "start_qa") {
    try {
      if (qaService?.isRunning()) {
        ctx.send({
          channel: "qa",
          sessionId: "",
          payload: { type: "qa_started", responseId: payload.responseId },
          auth: "",
        });
        return;
      }
      qaService = new QAService();
      await qaService.start();
      ctx.broadcast({
        channel: "qa",
        sessionId: "",
        payload: { type: "qa_started", responseId: payload.responseId },
        auth: "",
      });
    } catch (err) {
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: {
          type: "qa_error",
          message: (err as Error).message,
          responseId: payload.responseId,
        },
        auth: "",
      });
    }
  } else if (payload.type === "stop_qa") {
    // Kill all subagents that use PinchTab (they depend on it)
    // Import dynamically to avoid circular deps — subagent handler owns the sessions map
    const { getSubagentSessions } = await import("./subagent");
    for (const [id, record] of getSubagentSessions()) {
      if (record.subagentType === "qa" && record.session) record.session.kill();
    }

    if (qaService) {
      await qaService.stop();
      qaService = null;
    }
    ctx.broadcast({
      channel: "qa",
      sessionId: "",
      payload: { type: "qa_stopped" },
      auth: "",
    });
  } else if (payload.type === "get_qa_status") {
    const running = qaService?.isRunning() ?? false;
    const instances = running && qaService ? await qaService.listInstances() : [];
    ctx.send({
      channel: "qa",
      sessionId: "",
      payload: {
        type: "qa_status",
        running,
        instances,
        responseId: payload.responseId,
      },
      auth: "",
    });
  } else if (payload.type === "launch_instance") {
    if (!qaService?.isRunning()) {
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: { type: "qa_error", message: "QA service not running" },
        auth: "",
      });
      return;
    }
    try {
      const instance = await qaService.launchInstance(payload.headless);
      ctx.broadcast({
        channel: "qa",
        sessionId: "",
        payload: { type: "instance_launched", instance, responseId: payload.responseId },
        auth: "",
      });

      // Wire CDP events to frontend
      const cdp = qaService!.getCdpClient();
      if (cdp) {
        cdp.on("console", (entry) => {
          ctx.broadcast({
            channel: "qa",
            sessionId: "",
            payload: { type: "cdp_console", logs: [entry] },
            auth: "",
          });
        });
        cdp.on("network", (entry) => {
          ctx.broadcast({
            channel: "qa",
            sessionId: "",
            payload: { type: "cdp_network", requests: [entry] },
            auth: "",
          });
        });
        cdp.on("js_error", (entry) => {
          ctx.broadcast({
            channel: "qa",
            sessionId: "",
            payload: { type: "cdp_error", errors: [entry] },
            auth: "",
          });
        });
        cdp.on("navigated", ({ url, title }: { url: string; title: string }) => {
          ctx.broadcast({
            channel: "qa",
            sessionId: "",
            payload: { type: "navigate_result", url, title },
            auth: "",
          });
        });
      }
    } catch (err) {
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: { type: "qa_error", message: (err as Error).message },
        auth: "",
      });
    }
  } else if (payload.type === "stop_instance") {
    if (!qaService?.isRunning()) return;
    try {
      await qaService.stopInstance(payload.instanceId);
      ctx.broadcast({
        channel: "qa",
        sessionId: "",
        payload: { type: "instance_stopped", instanceId: payload.instanceId },
        auth: "",
      });
    } catch (err) {
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: { type: "qa_error", message: (err as Error).message },
        auth: "",
      });
    }
  } else if (payload.type === "navigate") {
    if (!qaService?.isRunning()) return;
    try {
      const result = await qaService.navigate(payload.url);
      ctx.broadcast({
        channel: "qa",
        sessionId: "",
        payload: { type: "navigate_result", url: result.url, title: result.title },
        auth: "",
      });
    } catch (err) {
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: { type: "qa_error", message: (err as Error).message },
        auth: "",
      });
    }
  } else if (payload.type === "snapshot") {
    if (!qaService?.isRunning()) return;
    try {
      const result = await qaService.snapshot(payload.filter);
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: { type: "snapshot_result", nodes: result.nodes, raw: result.raw },
        auth: "",
      });
    } catch (err) {
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: { type: "qa_error", message: (err as Error).message },
        auth: "",
      });
    }
  } else if (payload.type === "screenshot") {
    if (!qaService?.isRunning()) return;
    try {
      const dataUrl = await qaService.screenshot();
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: { type: "screenshot_result", dataUrl },
        auth: "",
      });
    } catch (err) {
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: { type: "qa_error", message: (err as Error).message },
        auth: "",
      });
    }
  } else if (payload.type === "action") {
    if (!qaService?.isRunning()) return;
    try {
      const result = await qaService.action(
        payload.kind,
        payload.ref,
        payload.value,
        payload.key,
      );
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: { type: "action_result", success: result.success, message: result.message },
        auth: "",
      });
    } catch (err) {
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: { type: "qa_error", message: (err as Error).message },
        auth: "",
      });
    }
  } else if (payload.type === "text") {
    if (!qaService?.isRunning()) return;
    try {
      const text = await qaService.text();
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: { type: "text_result", text },
        auth: "",
      });
    } catch (err) {
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: { type: "qa_error", message: (err as Error).message },
        auth: "",
      });
    }
  } else if (payload.type === "list_tabs") {
    if (!qaService?.isRunning()) return;
    try {
      const tabs = await qaService.listTabs();
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: { type: "tabs_list", tabs },
        auth: "",
      });
    } catch (err) {
      ctx.send({
        channel: "qa",
        sessionId: "",
        payload: { type: "qa_error", message: (err as Error).message },
        auth: "",
      });
    }
  } else if (payload.type === "list_qa_flows") {
    // Reload flows from disk in case they changed, then send summaries
    flowRunner.loadFlows();
    ctx.send({
      channel: "qa",
      sessionId: "",
      auth: "",
      payload: { type: "qa_flows_list", flows: flowRunner.listFlows() },
    });
  } else {
    ctx.send({
      channel: "qa",
      sessionId: "",
      payload: {
        type: "qa_error",
        message: `Unknown QA type: ${(payload as { type: string }).type}`,
      },
      auth: "",
    });
  }
}
