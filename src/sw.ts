/// <reference lib="webworker" />

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Routes that must NEVER be served from the SW cache.
 *
 *   - /api/me/*     — DSAR export ZIP, account delete confirmation. Caching
 *                      a personal export across logout is a privacy bug.
 *   - /api/logout    — must always hit the server to actually clear cookies.
 *   - /api/cron/*    — server-only, never useful from cache.
 *   - household pages — dashboard, settings, investment, report, /. Caching
 *                      RSC/HTML payloads means the *next user* on a shared
 *                      device can see the *previous user's* transactions
 *                      after sign-out. Static assets stay cacheable; only
 *                      authenticated views drop through to network.
 */
const SENSITIVE_PATH_RE =
  /^\/(?:api\/(?:me|logout|cron)|dashboard|settings|investment|report|reconcile)(?:\/|$)/;

const sensitiveCache: RuntimeCaching = {
  matcher: ({ url: { pathname }, sameOrigin }) =>
    sameOrigin && SENSITIVE_PATH_RE.test(pathname),
  handler: new NetworkOnly(),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [sensitiveCache, ...defaultCache],
});

serwist.addEventListeners();
