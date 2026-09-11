import type { Proposal } from "@genetia/shared";
import { canonicalProposalId, type BondReceipt } from "./proposal-adapter";
import { Pool } from "pg";

type Queryable = { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
type HyperdriveLike = { connectionString: string };

/**
 * Persists only rebuildable proposal/workflow state. Bond ownership remains
 * authoritative on Base; this transaction records the verified observation
 * and its durable outbox intent together.
 */
export async function persistVerifiedProposal(
  client: Queryable,
  input: { proposal: Proposal; proposer: `0x${string}`; bondTxHash: `0x${string}`; receipt: BondReceipt },
) {
  const proposalId = await canonicalProposalId(input.proposal, input.proposer);
  const canonicalHash = proposalId;
  await client.query("BEGIN");
  try {
    const user = await client.query(
      `SELECT u."id" FROM "genetia_app"."User" u JOIN "genetia_app"."Wallet" w ON w."userId" = u."id" WHERE w."chainId" = $1 AND lower(w."address") = lower($2) LIMIT 1 FOR UPDATE`,
      [84532, input.proposer],
    );
    if (!user.rows[0]?.id) throw new Error("proposer wallet is not registered");
    const existing = await client.query(`SELECT "canonicalProposalHash", "bondTxHash", "proposalId" FROM "genetia_app"."Proposal" WHERE "proposalKey" = $1 FOR UPDATE`, [input.proposal.idempotencyKey]);
    if (existing.rows[0]) {
      if (existing.rows[0].canonicalProposalHash !== canonicalHash || existing.rows[0].bondTxHash !== input.bondTxHash) throw new Error("idempotency key conflicts with verified bond");
      await client.query("COMMIT");
      return { proposalId: String(existing.rows[0].proposalId ?? proposalId), duplicate: true };
    }
    await client.query(
      `INSERT INTO "genetia_app"."Proposal" ("proposerUserId", "proposalId", "proposalKey", "canonicalTerms", "bondTxHash", "bondAmount", "canonicalProposalHash", "bondStatus", "admissibilityOperationId", "workflowStatus") VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, 'CONFIRMED', $8, 'BOND_CONFIRMED')`,
      [user.rows[0].id, proposalId, input.proposal.idempotencyKey, JSON.stringify(input.proposal), input.bondTxHash, "2000000", canonicalHash, `admissibility:${proposalId}`],
    );
    await client.query(
      `INSERT INTO "genetia_app"."WorkflowState" ("idempotencyKey", "workflowType", "externalId", "state", "payload") VALUES ($1, 'MARKET_ADMISSIBILITY', $2, 'PENDING', $3::jsonb) ON CONFLICT ("idempotencyKey") DO NOTHING`,
      [`admissibility:${proposalId}`, proposalId, JSON.stringify({ proposalId, proposer: input.proposer })],
    );
    await client.query("COMMIT");
    return { proposalId, duplicate: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export function createHyperdriveProposalPersistence(db: HyperdriveLike) {
  return async (input: Parameters<typeof persistVerifiedProposal>[1]) => {
    const pool = new Pool({ connectionString: db.connectionString, max: 1 });
    try { return await persistVerifiedProposal(pool, input); } finally { await pool.end(); }
  };
}
