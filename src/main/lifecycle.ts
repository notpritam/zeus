import { Log } from "./log/log";

const log = Log.create({ service: "lifecycle" });

interface Service {
  name: string;
  deps: string[];
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const services: Service[] = [];

export function registerService(service: Service): void {
  services.push(service);
}

function topologicalSort(items: Service[]): Service[] {
  const sorted: Service[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const byName = new Map(items.map((s) => [s.name, s]));

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`Circular dependency: ${name}`);
    visiting.add(name);
    const service = byName.get(name);
    if (!service) throw new Error(`Unknown service: ${name}`);
    for (const dep of service.deps) {
      visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    sorted.push(service);
  }

  for (const item of items) {
    visit(item.name);
  }
  return sorted;
}

export async function bootAll(): Promise<void> {
  const sorted = topologicalSort(services);
  for (const service of sorted) {
    const timer = log.time(`boot ${service.name}`);
    try {
      await service.start();
      timer.stop();
    } catch (err) {
      log.error("service boot failed", { name: service.name, error: String(err) });
      throw err;
    }
  }
}

export async function shutdownAll(): Promise<void> {
  const sorted = topologicalSort(services).reverse();
  for (const service of sorted) {
    try {
      await service.stop();
      log.info("service stopped", { name: service.name });
    } catch (err) {
      log.error("service stop failed", { name: service.name, error: String(err) });
    }
  }
}
