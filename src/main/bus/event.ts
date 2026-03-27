import type { ZodType } from "zod";

export namespace BusEvent {
  export interface Definition<Type extends string = string, Props extends ZodType = ZodType> {
    type: Type;
    properties: Props;
  }

  const registry = new Map<string, Definition>();

  export function define<Type extends string, Properties extends ZodType>(
    type: Type,
    properties: Properties,
  ): { type: Type; properties: Properties } {
    const result = { type, properties };
    registry.set(type, result);
    return result;
  }

  export function all(): Map<string, Definition> {
    return new Map(registry);
  }
}
