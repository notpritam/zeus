import type { HandlerContext } from "../router";
import type { PermissionsPayload } from "../../../shared/permission-types";
import {
  getPermissionRules,
  setPermissionRules,
  clearPermissionRules,
  getAuditLog,
} from "../../db/queries/permissions";
import { PERMISSION_TEMPLATES } from "../../services/permission-evaluator";
import { Log } from "../../log/log";

const log = Log.create({ service: "handler:permissions" });

export async function handlePermissions(ctx: HandlerContext): Promise<void> {
  const { envelope } = ctx;
  const payload = envelope.payload as PermissionsPayload;

  if (payload.type === "get_rules") {
    const rules = getPermissionRules(payload.projectId);
    ctx.broadcast({
      channel: "permissions",
      sessionId: envelope.sessionId,
      payload: { type: "rules_updated", projectId: payload.projectId, rules },
      auth: "",
    });
  } else if (payload.type === "set_rules") {
    setPermissionRules(payload.projectId, payload.rules);
    ctx.broadcast({
      channel: "permissions",
      sessionId: envelope.sessionId,
      payload: { type: "rules_updated", projectId: payload.projectId, rules: payload.rules },
      auth: "",
    });
  } else if (payload.type === "apply_template") {
    const template = PERMISSION_TEMPLATES.find((t) => t.id === payload.templateId);
    if (!template) {
      ctx.broadcast({
        channel: "permissions",
        sessionId: envelope.sessionId,
        payload: {
          type: "permissions_error",
          message: `Template not found: ${payload.templateId}`,
        },
        auth: "",
      });
      return;
    }
    setPermissionRules(payload.projectId, template.rules, template.name, true);
    ctx.broadcast({
      channel: "permissions",
      sessionId: envelope.sessionId,
      payload: { type: "rules_updated", projectId: payload.projectId, rules: template.rules },
      auth: "",
    });
  } else if (payload.type === "get_templates") {
    ctx.broadcast({
      channel: "permissions",
      sessionId: envelope.sessionId,
      payload: { type: "templates_list", templates: PERMISSION_TEMPLATES },
      auth: "",
    });
  } else if (payload.type === "get_audit_log") {
    const { entries, total } = getAuditLog(payload.sessionId, payload.limit, payload.offset);
    ctx.broadcast({
      channel: "permissions",
      sessionId: envelope.sessionId,
      payload: {
        type: "audit_log",
        sessionId: payload.sessionId,
        entries,
        total,
      },
      auth: "",
    });
  } else if (payload.type === "clear_rules") {
    clearPermissionRules(payload.projectId);
    ctx.broadcast({
      channel: "permissions",
      sessionId: envelope.sessionId,
      payload: { type: "rules_updated", projectId: payload.projectId, rules: [] },
      auth: "",
    });
  }
}
