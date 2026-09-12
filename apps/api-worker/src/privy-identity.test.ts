import { describe, expect, it } from "vitest";
import { linkedEthereumWallets, persistPrivyWalletIdentity } from "./privy-identity";

describe("Privy wallet identity synchronization", () => {
  it("keeps only linked Ethereum wallets and distinguishes embedded from external", () => {
    expect(linkedEthereumWallets({ id: "did:privy:u1", linked_accounts: [
      { type: "wallet", chain_type: "ethereum", address: "0x1111111111111111111111111111111111111111", wallet_client_type: "privy" },
      { type: "wallet", chain_type: "ethereum", address: "0x2222222222222222222222222222222222222222", connector_type: "injected" },
      { type: "wallet", chain_type: "solana", address: "So11111111111111111111111111111111111111112" },
      { type: "email", address: "user@example.test" },
    ] })).toEqual([
      { address: "0x1111111111111111111111111111111111111111", kind: "embedded" },
      { address: "0x2222222222222222222222222222222222222222", kind: "external" },
    ]);
  });

  it("persists user and linked wallets in one transaction", async () => {
    const statements: string[] = [];
    const client = { query: async (sql: string) => {
      statements.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
      if (sql.includes('INSERT INTO "genetia_app"."User"')) return { rows: [{ id: "user-uuid" }] };
      if (sql.includes('INSERT INTO "genetia_app"."Wallet"')) return { rows: [{ userId: "user-uuid" }] };
      return { rows: [] };
    }, release() {} };
    await persistPrivyWalletIdentity(client, { userId: "did:privy:u1" }, {
      id: "did:privy:u1",
      name: "Creator",
      linked_accounts: [{ type: "wallet", chain_type: "ethereum", address: "0x1111111111111111111111111111111111111111", wallet_client_type: "privy" }],
    });
    expect(statements).toEqual(expect.arrayContaining(["BEGIN", "COMMIT"]));
    expect(statements.some((statement) => statement.includes("INSERT INTO") && statement.includes('"User"'))).toBe(true);
    expect(statements.some((statement) => statement.includes("INSERT INTO") && statement.includes('"Wallet"'))).toBe(true);
  });

  it("rejects wallet ownership collisions and rolls the transaction back", async () => {
    const statements: string[] = [];
    const client = { query: async (sql: string) => {
      statements.push(sql.trim());
      if (sql.includes('INSERT INTO "genetia_app"."User"')) return { rows: [{ id: "user-uuid" }] };
      if (sql.includes('INSERT INTO "genetia_app"."Wallet"')) return { rows: [] };
      return { rows: [] };
    }, release() {} };
    await expect(persistPrivyWalletIdentity(client, { userId: "did:privy:u1" }, {
      id: "did:privy:u1",
      linked_accounts: [{ type: "wallet", chain_type: "ethereum", address: "0x1111111111111111111111111111111111111111" }],
    })).rejects.toThrow("already owned by another Genetia user");
    expect(statements.at(-1)).toBe("ROLLBACK");
  });
});
