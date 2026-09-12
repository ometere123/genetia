/**
 * Genetia Relayer (HTTP pinger).
 *
 * Resolution + indexer logic both live in the Next.js app. This service
 * just wakes them on a schedule via the cron endpoints:
 *
 *   POST /api/cron/resolve-markets   — drive expired markets through the
 *                                      GenLayer-verdict → Arc-propose flow
 *   POST /api/cron/index-arc         — mirror Arc events (Bought / Sold /
 *                                      Finalized / Redeemed) into Postgres
 *
 * Why this design:
 *   - Single source of truth for both pipelines (no duplicate code, no
 *     schema drift between two Prisma clients).
 *   - The Next.js endpoints can also be hit by Vercel cron or any external
 *     scheduler — this service is one of several equivalent trigger
 *     options, not the only one.
 *
 * Required env:
 *   APP_URL          — base URL of the Genetia Next.js app
 *                      (e.g. https://genetia.app or http://localhost:3000)
 *   CRON_SECRET      — shared secret with the Next.js app's CRON_SECRET
 *   POLL_INTERVAL_MS — milliseconds between resolver ticks (default 60000)
 *   INDEX_INTERVAL_MS — ms between indexer ticks (default 30000 — faster
 *                      so the UI feels live after trades)
 */

import "dotenv/config";

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60_000);
const INDEX_MS = Number(process.env.INDEX_INTERVAL_MS ?? 30_000);

if (!CRON_SECRET) {
  console.error("[relayer] CRON_SECRET is required");
  process.exit(1);
}

async function ping(path: string): Promise<unknown> {
  const res = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CRON_SECRET}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function resolverTick(): Promise<void> {
  const t0 = Date.now();
  try {
    const body = (await ping("/api/cron/resolve-markets")) as {
      scanned: number;
      submittedToGenlayer: number;
      proposedOnArc: number;
      invalidatedOnArc: number;
      errors: { marketId: string; error: string }[];
    };
    const dt = Date.now() - t0;
    const interesting =
      body.submittedToGenlayer + body.proposedOnArc + body.invalidatedOnArc + body.errors.length;
    if (interesting > 0 || body.scanned > 0) {
      console.log(
        `[relayer/resolver] ${dt}ms — scanned=${body.scanned} ` +
          `submitted=${body.submittedToGenlayer} proposed=${body.proposedOnArc} ` +
          `invalidated=${body.invalidatedOnArc} errors=${body.errors.length}`
      );
    }
    for (const e of body.errors) {
      console.warn(`[relayer/resolver]   error[${e.marketId}]: ${e.error}`);
    }
  } catch (err) {
    console.error("[relayer/resolver] tick threw", err);
  }
}

async function indexerTick(): Promise<void> {
  const t0 = Date.now();
  try {
    const body = (await ping("/api/cron/index-arc")) as {
      factoryFromBlock: string;
      factoryToBlock: string;
      newMarkets: number;
      marketsScanned: number;
      tradesInserted: number;
      statusUpdatesApplied: number;
    };
    const dt = Date.now() - t0;
    const interesting =
      body.newMarkets + body.tradesInserted + body.statusUpdatesApplied;
    if (interesting > 0) {
      console.log(
        `[relayer/indexer] ${dt}ms — scanned=${body.marketsScanned} ` +
          `new=${body.newMarkets} trades=${body.tradesInserted} ` +
          `statusUpdates=${body.statusUpdatesApplied}`
      );
    }
  } catch (err) {
    console.error("[relayer/indexer] tick threw", err);
  }
}

async function main() {
  console.log(
    `[relayer] started → ${APP_URL}\n` +
      `  resolver every ${POLL_MS / 1000}s\n` +
      `  indexer  every ${INDEX_MS / 1000}s`
  );
  // Stagger the first ticks so they don't both fire at boot.
  resolverTick();
  setTimeout(() => indexerTick(), 2_000);
  setInterval(resolverTick, POLL_MS);
  setInterval(indexerTick, INDEX_MS);
}

main().catch((err) => {
  console.error("[relayer] fatal", err);
  process.exit(1);
});
