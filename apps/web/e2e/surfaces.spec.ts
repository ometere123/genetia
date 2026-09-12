import { expect, test } from "@playwright/test";

const marketId = `0x${"11".repeat(32)}`;
const market = {
  id: marketId,
  marketId,
  engine: "POOL",
  title: "Will the controlled example source remain available?",
  question: "Will the controlled example source remain available?",
  description: "A read-only UI fixture; this test does not assert protocol lifecycle state.",
  yesDefinition: "The locked source remains available at the resolution time.",
  noDefinition: "The locked source is unavailable at the resolution time.",
  category: "technology",
  status: "ACTIVE",
  creatorAddress: `0x${"22".repeat(20)}`,
  baseAddress: `0x${"33".repeat(20)}`,
  financialReleaseId: `0x${"44".repeat(32)}`,
  resolverAddress: `0x${"55".repeat(20)}`,
  resolverReleaseId: `0x${"66".repeat(32)}`,
  manifestHash: `0x${"77".repeat(32)}`,
  closeTime: "2027-01-01T00:00:00.000Z",
  resolutionAvailableTime: "2027-01-01T00:05:00.000Z",
  terminalDeadline: "2027-01-05T00:05:00.000Z",
  pool: { yesTotal: "4000000", noTotal: "4000000" },
};

async function mockReadApi(page: import("@playwright/test").Page, engine: "POOL" | "LMSR" = "POOL") {
  const responseMarket = { ...market, engine };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/markets" && route.request().method() === "GET") {
      await route.fulfill({ json: { items: [responseMarket], nextCursor: null } });
      return;
    }
    if (url.pathname === `/api/markets/${marketId}`) {
      await route.fulfill({ json: responseMarket });
      return;
    }
    if (url.pathname === `/api/markets/${marketId}/prices`) {
      await route.fulfill({ json: { yesPrice: "500000000000000000", noPrice: "500000000000000000" } });
      return;
    }
    if (url.pathname === `/api/markets/${marketId}/resolution`) {
      await route.fulfill({ json: { resolverAddress: market.resolverAddress, manifestHash: market.manifestHash, genlayerTxId: `0x${"88".repeat(32)}`, lifecycle: "PENDING", executionStatus: "UNKNOWN", attempt: 0, submittedAt: "2026-09-12T00:00:00.000Z" } });
      return;
    }
    if (["trades", "liquidity", "evidence"].some((suffix) => url.pathname === `/api/markets/${marketId}/${suffix}`)) {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ status: 503, json: { error: "unconfigured test API route" } });
  });
}

test("discovery search filters the indexed market list", async ({ page }) => {
  await mockReadApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: market.question })).toBeVisible();
  await page.getByPlaceholder("Search markets").fill("not in this result");
  await expect(page.getByText("No active markets match this filter.")).toBeVisible();
});

test("market detail renders rules, resolution, evidence and live action surface", async ({ page }) => {
  await mockReadApi(page);
  await page.goto(`/markets/${marketId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: market.question })).toBeVisible();
  await expect(page.getByText(market.yesDefinition)).toBeVisible();
  await expect(page.getByText("PENDING", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Privy wallet" })).toBeVisible();
});

test("creator form exposes the fixed bond terms without implying a payment", async ({ page }) => {
  page.setDefaultNavigationTimeout(10_000);
  page.setDefaultTimeout(5_000);
  await page.goto("/create", { waitUntil: "commit", timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Create a market" })).toBeVisible();
  await expect(page.getByText(/fixed 2 USDC proposal bond/)).toBeVisible();
  await expect(page.getByLabel("Question")).toBeVisible();
  await expect(page.getByLabel("Authoritative source URL")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare bond and submit proposal" })).toBeVisible();
});

test("disconnected wallet cannot submit a Pool trade", async ({ page }) => {
  await mockReadApi(page);
  await page.goto(`/markets/${marketId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Connect Privy wallet" }).click();
  await expect(page.getByText("Connect an embedded or external wallet with Privy first.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Get quote and stake" })).toHaveCount(0);
});

test("LMSR detail identifies the engine and fails closed without a connected wallet", async ({ page }) => {
  await mockReadApi(page, "LMSR");
  await page.goto(`/markets/${marketId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: market.question })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live Price market" })).toBeVisible();
  await page.getByRole("button", { name: "Connect Privy wallet" }).click();
  await expect(page.getByText("Connect an embedded or external wallet with Privy first.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Get quote and buy" })).toHaveCount(0);
});

test("portfolio requires authenticated Privy identity before reading a wallet portfolio", async ({ page }) => {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in to view portfolio" })).toBeVisible();
  await expect(page.getByText("No indexed positions for this wallet yet.")).toHaveCount(0);
});
