import { unstable_cache } from "next/cache";

type AnyFn = (...args: any[]) => Promise<any>;

export function withTagCache<T extends AnyFn>(
  fn: T,
  keyParts: string[],
  options?: { tags?: string[]; revalidate?: number | false },
): T {
  return unstable_cache(fn, keyParts, options) as T;
}
