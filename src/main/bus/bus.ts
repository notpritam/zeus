import type { BusEvent } from "./event";
import type z from "zod";
import { Log } from "../log/log";

export namespace Bus {
  const log = Log.create({ service: "bus" });

  type Subscription = (event: { type: string; properties: unknown }) => void | Promise<void>;
  const subscriptions = new Map<string, Subscription[]>();

  export function publish<D extends BusEvent.Definition>(
    def: D,
    properties: z.output<D["properties"]>,
  ): void {
    const payload = { type: def.type, properties };
    for (const key of [def.type, "*"]) {
      const subs = subscriptions.get(key);
      if (!subs) continue;
      for (const sub of [...subs]) {
        try {
          sub(payload);
        } catch (err) {
          log.error("subscriber error", { type: def.type, error: String(err) });
        }
      }
    }
  }

  export function subscribe<D extends BusEvent.Definition>(
    def: D,
    callback: (event: { type: D["type"]; properties: z.infer<D["properties"]> }) => void,
  ): () => void {
    return raw(def.type, callback as Subscription);
  }

  export function subscribeAll(callback: Subscription): () => void {
    return raw("*", callback);
  }

  function raw(type: string, callback: Subscription): () => void {
    let subs = subscriptions.get(type);
    if (!subs) {
      subs = [];
      subscriptions.set(type, subs);
    }
    subs.push(callback);

    return () => {
      const list = subscriptions.get(type);
      if (!list) return;
      const idx = list.indexOf(callback);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  export function reset(): void {
    subscriptions.clear();
  }
}
