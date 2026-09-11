import { decodeEventLog, encodeFunctionData, parseAbi } from "viem";
import { canonicalManifestHash, canonicalProposalBody, ProposalSchema, type Proposal, type ProposalBondPreparation } from "@genetia/shared";

const escrowAbi = parseAbi([
  "function lock(bytes32 proposalId, address proposer)",
  "event BondLocked(bytes32 indexed proposalId, address indexed proposer)",
]);
const erc20Abi = parseAbi(["function approve(address spender, uint256 amount)", "event Transfer(address indexed from, address indexed to, uint256 value)"]);
export const PROPOSAL_BOND = 2_000_000n;

export async function canonicalProposalId(proposal: Proposal, proposer: `0x${string}`): Promise<`0x${string}`> {
  ProposalSchema.parse(proposal);
  return canonicalManifestHash(JSON.parse(canonicalProposalBody(proposal, proposer)) as Record<string, unknown>);
}

export async function prepareProposalBond(
  proposalValue: unknown,
  proposer: `0x${string}`,
  escrow: `0x${string}`,
  usdc: `0x${string}`,
): Promise<ProposalBondPreparation> {
  const proposal = ProposalSchema.parse(proposalValue);
  const proposalId = await canonicalProposalId(proposal, proposer);
  return {
    chainId: 84532,
    proposalId,
    proposer,
    bondAmount: "2000000",
    approval: { token: usdc, spender: escrow, amount: "2000000" },
    lock: { to: escrow, data: encodeFunctionData({ abi: escrowAbi, functionName: "lock", args: [proposalId, proposer] }), value: "0" },
  };
}

export type BondReceiptLog = { address: string; topics: readonly `0x${string}`[]; data: `0x${string}` };
export type BondReceipt = { status: "success" | "reverted"; to: string | null; logs: readonly BondReceiptLog[] };

export function verifyBondReceipt(receipt: BondReceipt, expected: { proposalId: `0x${string}`; proposer: `0x${string}`; escrow: `0x${string}`; usdc: `0x${string}` }): void {
  if (receipt.status !== "success") throw new Error("bond transaction failed");
  if (!receipt.to || receipt.to.toLowerCase() !== expected.escrow.toLowerCase()) throw new Error("bond escrow mismatch");
  let locked = false;
  let transferred = false;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === expected.escrow.toLowerCase()) {
      try {
        const decoded = decodeEventLog({ abi: escrowAbi, data: log.data, topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]] });
        if (decoded.eventName === "BondLocked" && decoded.args.proposalId.toLowerCase() === expected.proposalId.toLowerCase() && decoded.args.proposer.toLowerCase() === expected.proposer.toLowerCase()) locked = true;
      } catch { /* unrelated log */ }
    }
    if (log.address.toLowerCase() === expected.usdc.toLowerCase()) {
      try {
        const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]] });
        if (decoded.eventName === "Transfer" && decoded.args.from.toLowerCase() === expected.proposer.toLowerCase() && decoded.args.to.toLowerCase() === expected.escrow.toLowerCase() && decoded.args.value === PROPOSAL_BOND) transferred = true;
      } catch { /* unrelated log */ }
    }
  }
  if (!locked || !transferred) throw new Error("canonical proposal bond event not found");
}
