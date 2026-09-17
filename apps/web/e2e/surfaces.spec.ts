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
  category: "tech-ai",
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
  const marketQueries: URL[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/markets" && route.request().method() === "GET") {
      marketQueries.push(url);
      const nextPage = url.searchParams.has("cursor");
      const noSearchMatch = Boolean(url.searchParams.get("search")) && !responseMarket.question.toLowerCase().includes(url.searchParams.get("search")!.toLowerCase());
      await route.fulfill({ json: { items: noSearchMatch ? [] : nextPage ? [{ ...responseMarket, marketId: `0x${"99".repeat(32)}`, id: `0x${"99".repeat(32)}`, question: "Will the second indexed market be visible?" }] : [responseMarket], nextCursor: noSearchMatch || nextPage ? null : "next-page" } });
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
  return marketQueries;
}

test("discovery search filters the indexed market list", async ({ page }) => {
  const queries = await mockReadApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: market.question })).toBeVisible();
  await page.getByPlaceholder("Search markets").fill("not in this result");
  await expect(page.getByText("No markets match your search.")).toBeVisible();
  await expect.poll(() => queries.at(-1)?.searchParams.get("search")).toBe("not in this result");
});

test("discovery sends category and engine filters to the API and appends cursor pages", async ({ page }) => {
  const queries = await mockReadApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: market.question })).toBeVisible();
  await page.getByRole("button", { name: "Tech & AI" }).click();
  await expect.poll(() => queries.at(-1)?.searchParams.get("category")).toBe("tech-ai");
  await page.getByRole("button", { name: "Resolved", exact: true }).click();
  await expect.poll(() => queries.at(-1)?.searchParams.get("status")).toBe("RESOLVED");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect.poll(() => queries.at(-1)?.searchParams.get("status")).toBe("ACTIVE");
  await page.getByRole("button", { name: "LMSR", exact: true }).click();
  await expect.poll(() => queries.at(-1)?.searchParams.get("engine")).toBe("LMSR");
  await page.getByRole("button", { name: "Load more markets" }).click();
  await expect(page.getByRole("heading", { name: "Will the second indexed market be visible?" })).toBeVisible();
  expect(queries.at(-1)?.searchParams.get("cursor")).toBe("next-page");
});

test("Spanish and Portuguese locale choices persist and localize discovery states", async ({ page }) => {
  await page.route("**/api/markets**", async (route) => {
    await route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const language = page.locator("select").first();
  await language.selectOption("es");
  await expect(page.getByRole("link", { name: "Mercados" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No se encontraron mercados." })).toBeVisible();
  await language.selectOption("pt");
  await expect(page.getByRole("link", { name: "Mercados" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nenhum mercado encontrado." })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Nenhum mercado encontrado." })).toBeVisible();
});

test("language choice is curated, persists after reload, and localizes navigation/about UI", async ({ page }) => {
  await mockReadApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("combobox", { name: "Choose language" }).selectOption("fr");
  await expect(page.getByRole("link", { name: "Marchés" })).toBeVisible();
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Comment fonctionne Genetia" })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Comment fonctionne Genetia" })).toBeVisible();
  await page.goto("/wallet", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portefeuille", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Connecter le portefeuille" })).toBeVisible();
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Mon portefeuille" })).toBeVisible();
  await page.goto(`/create/status/${marketId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "État de la proposition" })).toBeVisible();
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
  await expect(page.getByLabel("Market question")).toBeVisible();
  await expect(page.getByLabel("Authoritative source URL")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare bond and submit" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "LMSR" })).toBeVisible();
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
