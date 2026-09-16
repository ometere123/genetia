import { z } from "zod";

export const NETWORK = {
  base: { chainId: 84532, name: "Base Sepolia" },
  genlayer: { chainId: 61997, rpc: "https://studio-dev.genlayer.com/api", sdkChain: "studioDevnet" },
} as const;
export const CHAIN = { base: NETWORK.base.chainId, genlayer: NETWORK.genlayer.chainId } as const;
export const USDC_DECIMALS = 6;
export const MARKET_CATEGORIES = [
  "crypto", "sports", "politics", "macro", "tech-ai", "science", "business",
  "entertainment", "culture", "geopolitics", "internet-social", "other",
] as const;
export const MarketCategorySchema = z.enum(MARKET_CATEGORIES);
export type MarketCategory = z.infer<typeof MarketCategorySchema>;
export const marketCategoryLabel: Record<MarketCategory, string> = {
  crypto: "Crypto", sports: "Sports", politics: "Politics", macro: "Macro",
  "tech-ai": "Tech & AI", science: "Science", business: "Business",
  entertainment: "Entertainment", culture: "Culture", geopolitics: "Geopolitics",
  "internet-social": "Internet & Social", other: "Other",
};
function marketCategorySlug(value: string): string {
  return value.trim().toLowerCase().replace(/[\/&]+/g, "-").replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
const categoryAliases: Record<string, MarketCategory> = {
  technology: "tech-ai", tech: "tech-ai", ai: "tech-ai", "technology-ai": "tech-ai",
  internet: "internet-social", social: "internet-social", "internet-and-social": "internet-social", "internet-social-media": "internet-social",
};
export function isKnownMarketCategory(value: string): boolean {
  const slug = marketCategorySlug(value);
  return (MARKET_CATEGORIES as readonly string[]).includes(slug) || slug in categoryAliases;
}
export function normalizeMarketCategory(value: string): string {
  const slug = marketCategorySlug(value);
  return categoryAliases[slug] ?? ((MARKET_CATEGORIES as readonly string[]).includes(slug) ? slug : "other");
}
export const EngineSchema = z.enum(["POOL", "LMSR"]);
export const OutcomeSchema = z.enum(["YES", "NO", "VOID"]);
export const ResolutionStateSchema = z.enum(["SUBMITTED", "PENDING", "ACCEPTED", "FINALIZED"]);
export const ExecutionStateSchema = z.enum(["FINISHED_WITH_RETURN", "FAILED", "UNKNOWN"]);
export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const HashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
export const AmountSchema = z.string().regex(/^\d+$/);

export const EvidenceSourceSchema = z.object({
  identity: z.string().min(1), exact_url: z.string().url().optional(), allowed_domain: z.string().min(1).optional(),
  allowed_path: z.string().optional(), source_type: z.string().min(1), priority: z.number().int().nonnegative(), required: z.boolean(),
}).refine((source) => Boolean(source.exact_url || source.allowed_domain), "source requires an exact URL or locked domain")
  .refine((source) => !source.allowed_domain || Boolean(source.allowed_path), "future source requires a locked path");

const ResolutionManifestBase = z.object({
  market_id: z.string().min(1), base_chain_id: z.literal(84532), base_market_address: AddressSchema,
  genlayer_chain_id: z.literal(61997), question: z.string().min(8), yes_definition: z.string().min(8), no_definition: z.string().min(8),
  close_time: z.number().int().nonnegative(), resolution_available_time: z.number().int().nonnegative(), absolute_terminal_deadline: z.number().int().nonnegative(),
  evidence_attempt_schedule_seconds: z.tuple([z.literal(0), z.literal(1800), z.literal(14400), z.literal(86400), z.literal(259200)]),
  void_conditions: z.array(z.string().min(1)).min(1), resolution_profile: z.enum(["STRUCTURED", "MULTI_SOURCE", "SEMANTIC", "COMPOSITE"]),
  authoritative_sources: z.array(EvidenceSourceSchema).min(1), fallback_sources: z.array(EvidenceSourceSchema),
  corroboration_rule: z.string().min(1), minimum_corroborating_sources: z.number().int().positive(),
  freshness_rule: z.string().min(1), discovery_rule: z.string().min(1), official_source_required: z.boolean(),
  arbitrary_caller_urls_forbidden: z.literal(true), prompt_release_id: z.string().min(1), manifest_release_id: z.string().min(1),
  resolver_release_id: z.string().min(1), manifest_hash: HashSchema,
});
export const ResolutionManifestSchema = ResolutionManifestBase.refine((manifest) => manifest.absolute_terminal_deadline === manifest.resolution_available_time + 345600, "terminal deadline must be resolution availability plus 96 hours");

export const MarketSchema = z.object({
  id: z.string(), marketId: z.string(), engine: EngineSchema, title: z.string(), question: z.string(), description: z.string(),
  yesDefinition: z.string().optional(), noDefinition: z.string().optional(),
  category: MarketCategorySchema, status: z.string(), creatorAddress: AddressSchema, baseAddress: AddressSchema,
  financialReleaseId: z.string(), resolverAddress: AddressSchema, resolverReleaseId: z.string(), manifestHash: HashSchema,
  closeTime: z.string().datetime(), resolutionAvailableTime: z.string().datetime(), terminalDeadline: z.string().datetime(),
  pool: z.object({ yesTotal: AmountSchema, noTotal: AmountSchema }).optional(),
  lmsr: z.object({ b: AmountSchema, fundingTarget: AmountSchema, funded: AmountSchema, yesPrice: AmountSchema, noPrice: AmountSchema }).optional(),
  terminalOutcome: OutcomeSchema.nullable().optional(),
});

export const ResolutionEnvelopeSchema = z.object({
  marketId: HashSchema, baseMarket: AddressSchema, baseChainId: z.literal(84532), resolver: AddressSchema,
  genlayerChainId: z.literal(61997), genlayerTxId: HashSchema, manifestHash: HashSchema, resolverReleaseId: HashSchema,
  attempt: z.number().int().min(0).max(4), outcome: z.number().int().min(0).max(2), evidenceCommitment: HashSchema, resultCommitment: HashSchema,
});
export const ResolutionRecordSchema = z.object({
  resolverAddress: AddressSchema, manifestHash: HashSchema, genlayerTxId: HashSchema,
  lifecycle: ResolutionStateSchema, executionStatus: ExecutionStateSchema, outcome: OutcomeSchema.optional(),
  resultCommitment: HashSchema.optional(), attempt: z.number().int().min(0).max(4), submittedAt: z.string().datetime(), finalizedAt: z.string().datetime().optional(),
});
export const QuoteRequestSchema = z.object({ side: z.enum(["YES", "NO"]), action: z.enum(["BUY", "SELL"]), amount: AmountSchema, maxTotal: AmountSchema.optional(), minNet: AmountSchema.optional() });
export const QuoteSchema = z.object({
  shares: AmountSchema, notional: AmountSchema, fee: AmountSchema, total: AmountSchema, priceAfter: AmountSchema,
  marketId: z.string().min(1).optional(), engine: EngineSchema.optional(), action: z.enum(["BUY", "SELL"]).optional(), side: z.enum(["YES", "NO"]).optional(),
  chainId: z.literal(84532).optional(), contract: AddressSchema.optional(), yesTotal: AmountSchema.optional(), noTotal: AmountSchema.optional(),
  nextYesTotal: AmountSchema.optional(), nextNoTotal: AmountSchema.optional(), qYes: AmountSchema.optional(), qNo: AmountSchema.optional(), b: AmountSchema.optional(),
  feeRateBps: z.number().int().nonnegative().optional(), quoteAt: AmountSchema.optional(),
});
export const TransactionPreparationSchema = z.object({ chainId: z.literal(84532), to: AddressSchema, data: z.string().regex(/^0x[a-fA-F0-9]*$/), value: z.literal("0"), marketId: z.string().min(1), engine: EngineSchema, action: z.enum(["BUY", "SELL"]), side: z.enum(["YES", "NO"]), amount: AmountSchema, approval: z.object({ token: AddressSchema, spender: AddressSchema, amount: AmountSchema }).nullable() });
export const ProposalSchema = ResolutionManifestBase.omit({ base_market_address: true, manifest_hash: true }).extend({ idempotencyKey: z.string().min(16), engine: EngineSchema, category: MarketCategorySchema.optional(), lmsrB: AmountSchema.optional() });
export const ProposalBondPreparationSchema = z.object({
  chainId: z.literal(84532),
  proposalId: HashSchema,
  proposer: AddressSchema,
  bondAmount: z.literal("2000000"),
  approval: z.object({ token: AddressSchema, spender: AddressSchema, amount: z.literal("2000000") }),
  lock: z.object({ to: AddressSchema, data: z.string().regex(/^0x[a-fA-F0-9]+$/), value: z.literal("0") }),
});
export const ProposalSubmissionSchema = z.object({
  proposal: ProposalSchema,
  proposer: AddressSchema,
  bondTxHash: HashSchema,
});
export const ProposalStatusSchema = z.object({
  proposalId: HashSchema,
  proposer: AddressSchema,
  status: z.enum(["PENDING_BOND", "ADMISSIBILITY_SUBMITTED", "NEEDS_REVISION", "APPROVED", "REJECTED"]),
  bondStatus: z.enum(["UNCONFIRMED", "CONFIRMED", "REFUNDED", "DISPOSED", "TIMEOUT_REFUNDED"]),
  revisionCount: z.number().int().min(0).max(2),
  workflowStatus: z.enum(["NOT_STARTED", "RUNNING", "WAITING_FINALITY", "COMPLETE", "FAILED"]),
  issues: z.array(z.string()).optional(),
  manifestHash: HashSchema.optional(),
  resolver: AddressSchema.optional(),
  baseMarket: AddressSchema.optional(),
  updatedAt: z.string().datetime().optional(),
});

export type Engine = z.infer<typeof EngineSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type Market = z.infer<typeof MarketSchema>;
export type ResolutionManifest = z.infer<typeof ResolutionManifestSchema>;
export type ResolutionEnvelope = z.infer<typeof ResolutionEnvelopeSchema>;
export type ResolutionRecord = z.infer<typeof ResolutionRecordSchema>;
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type TransactionPreparation = z.infer<typeof TransactionPreparationSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalBondPreparation = z.infer<typeof ProposalBondPreparationSchema>;
export type ProposalSubmission = z.infer<typeof ProposalSubmissionSchema>;
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "manifest_hash").sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  if (typeof value === "number" && (!Number.isSafeInteger(value) || !Number.isFinite(value))) throw new Error("canonical manifest numbers must be safe integers");
  return JSON.stringify(value);
}

export function canonicalProposalBody(proposal: Proposal, proposer: string): string {
  return stableJson({ proposer: proposer.toLowerCase(), proposal: { ...proposal, idempotencyKey: proposal.idempotencyKey } });
}

export function canonicalManifestBody(manifest: Record<string, unknown>): string { return stableJson(manifest); }
export function canonicalManifestBytes(manifest: Record<string, unknown>): Uint8Array { return new TextEncoder().encode(canonicalManifestBody(manifest)); }
export async function canonicalManifestHash(manifest: Record<string, unknown>): Promise<`0x${string}`> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", canonicalManifestBytes(manifest));
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
}

export function lmsrFundingTarget(bMicro: bigint): bigint {
  const numerator = bMicro * 693147180559945309n * 110n;
  const target = (numerator + 100n * 10n ** 18n - 1n) / (100n * 10n ** 18n);
  return target > 100_000_000n ? target : 100_000_000n;
}

export function resolutionRetryAt(availableAtMs: number, evidenceAttempt: number): number {
  const schedule = [0, 30 * 60, 4 * 3600, 24 * 3600, 72 * 3600] as const;
  if (!Number.isInteger(evidenceAttempt) || evidenceAttempt < 0 || evidenceAttempt >= schedule.length) throw new Error("invalid evidence attempt");
  return availableAtMs + schedule[evidenceAttempt] * 1000;
}

export function technicalRetryDelaySeconds(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error("invalid technical attempt");
  return [60, 300, 900, 3600, 21600][attempt] ?? 21600;
}
