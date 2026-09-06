import { describe, expect, it } from "vitest";
import app from "./index";

const env = { BASE_CHAIN_ID: "84532", GENLAYER_CHAIN_ID: "61997", GENLAYER_RPC: "https://studio-dev.genlayer.com/api" };

describe("canonical API contract", () => {
  it("reports the locked chains and database health", async () => {
    const response = await app.request("http://localhost/api/health", {}, env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, baseChainId: 84532, genlayerChainId: 61997, database: false });
  });

  it("returns an explicit unavailable state when no indexed DB is bound", async () => {
    const response = await app.request("http://localhost/api/markets", {}, env);
    expect(response.status).toBe(503);
  });

  it("requires authentication for protected trade preparation", async () => {
    const response = await app.request("http://localhost/api/markets/m1/prepare-trade", { method: "POST" }, env);
    expect(response.status).toBe(401);
  });
});
