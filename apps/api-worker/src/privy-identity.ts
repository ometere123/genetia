import { Pool } from "pg";

type AuthIdentity = { userId: string };

type PrivyWallet = {
  type: string;
  address?: string;
  chain_type?: string;
  wallet_client_type?: string;
  connector_type?: string;
};
type PrivyUser = {
  id: string;
  linked_accounts: PrivyWallet[];
  name?: string | null;
  profile_picture_url?: string | null;
};
type DbClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  release: () => void;
};

export function linkedEthereumWallets(user: PrivyUser): Array<{ address: `0x${string}`; kind: string }> {
  const wallets = new Map<string, { address: `0x${string}`; kind: string }>();
  for (const account of user.linked_accounts) {
    if (account.type !== "wallet" || account.chain_type !== "ethereum" || !/^0x[0-9a-fA-F]{40}$/.test(account.address ?? "")) continue;
    const address = account.address as `0x${string}`;
    wallets.set(address.toLowerCase(), {
      address,
      kind: account.wallet_client_type === "privy" || account.connector_type === "embedded" ? "embedded" : "external",
    });
  }
  return [...wallets.values()];
}

export async function persistPrivyWalletIdentity(
  client: DbClient,
  identity: AuthIdentity,
  user: PrivyUser,
): Promise<void> {
  if (user.id !== identity.userId) throw new Error("Privy user identity mismatch");
  const wallets = linkedEthereumWallets(user);
  const id = crypto.randomUUID();
  await client.query("BEGIN");
  try {
    const upsertedUser = await client.query(
      `INSERT INTO "genetia_app"."User" ("id", "privyUserId", "displayName", "avatarUrl", "updatedAt")
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT ("privyUserId") DO UPDATE SET "displayName" = EXCLUDED."displayName", "avatarUrl" = EXCLUDED."avatarUrl", "updatedAt" = now()
       RETURNING "id"`,
      [id, identity.userId, user.name ?? null, user.profile_picture_url ?? null],
    );
    const userId = String(upsertedUser.rows[0]?.id ?? "");
    if (!userId) throw new Error("Privy user persistence failed");
    for (const wallet of wallets) {
      const inserted = await client.query(
        `INSERT INTO "genetia_app"."Wallet" ("id", "userId", "chainId", "address", "kind")
         VALUES ($1, $2, 84532, $3, $4)
         ON CONFLICT ("chainId", "address") DO UPDATE SET "kind" = EXCLUDED."kind"
         WHERE "genetia_app"."Wallet"."userId" = EXCLUDED."userId"
         RETURNING "userId"`,
        [crypto.randomUUID(), userId, wallet.address, wallet.kind],
      );
      if (String(inserted.rows[0]?.userId ?? "") !== userId) throw new Error("linked wallet is already owned by another Genetia user");
    }
    await client.query(
      `DELETE FROM "genetia_app"."Wallet" WHERE "userId" = $1 AND "chainId" = 84532
       AND NOT (lower("address") = ANY($2::text[]))`,
      [userId, wallets.map(({ address }) => address.toLowerCase())],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function syncPrivyWalletIdentity(
  db: { connectionString: string },
  identity: AuthIdentity,
  getUser: (userId: string) => Promise<PrivyUser>,
): Promise<void> {
  const user = await getUser(identity.userId);
  const pool = new Pool({ connectionString: db.connectionString, max: 1 });
  let client: DbClient | undefined;
  try {
    client = await pool.connect() as unknown as DbClient;
    await persistPrivyWalletIdentity(client, identity, user);
  } finally {
    client?.release();
    await pool.end();
  }
}
