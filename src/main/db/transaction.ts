import { AsyncLocalStorage } from "async_hooks";
import { getClient } from "./client";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "./schema";

type TxOrDb = BetterSQLite3Database<typeof schema>;

const txContext = new AsyncLocalStorage<{ tx: TxOrDb }>();

/**
 * Run `callback` inside a transaction. Nested calls reuse the outer transaction.
 */
export function transaction<T>(callback: (tx: TxOrDb) => T): T {
  const existing = txContext.getStore();
  if (existing) return callback(existing.tx);

  return getClient().transaction((tx) =>
    txContext.run({ tx: tx as unknown as TxOrDb }, () =>
      callback(tx as unknown as TxOrDb),
    ),
  ) as T;
}

/**
 * Run `callback` with the current transaction (if any) or the root Drizzle client.
 * Use this in query modules so they automatically participate in transactions.
 */
export function use<T>(callback: (db: TxOrDb) => T): T {
  const store = txContext.getStore();
  return callback((store?.tx ?? getClient()) as TxOrDb);
}
