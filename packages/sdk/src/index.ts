import { z } from "zod";
import { Market, ResolutionRecord, Proposal, QuoteRequest, Quote, TransactionPreparation, ProposalBondPreparation, ProposalStatus, MarketSchema, ResolutionRecordSchema, QuoteSchema, TransactionPreparationSchema, ProposalBondPreparationSchema, ProposalStatusSchema } from "@genetia/shared";
export type { Market, Proposal, ProposalBondPreparation, ProposalStatus, Quote, QuoteRequest, TransactionPreparation } from "@genetia/shared";
export type GenetiaClientOptions = { baseUrl: string; fetch?: typeof fetch; headers?: Record<string, string> };
export type ActivityRecord = Record<string, unknown>;
export type MarketPage = { items: Market[]; nextCursor: string | null };
export type Health = { ok: boolean; baseChainId: number; genlayerChainId: number; database: boolean };
const MarketPageSchema = z.object({ items: z.array(MarketSchema), nextCursor: z.string().nullable() });
const HealthSchema = z.object({ ok: z.boolean(), baseChainId: z.number(), genlayerChainId: z.number(), database: z.boolean() });
const RecordsSchema = z.array(z.record(z.unknown()));
export class GenetiaClient {
  private readonly request: typeof fetch;
  constructor(private readonly options: GenetiaClientOptions) { this.request = options.fetch ?? globalThis.fetch.bind(globalThis); }
  private async get<T>(path: string, schema: { parse(value: unknown): T }, extraHeaders: Record<string, string> = {}): Promise<T> {
    const r = await this.request(`${this.options.baseUrl}/api${path}`, { headers: { ...this.options.headers, ...extraHeaders } });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return schema.parse(await r.json());
  }
  private async post<T>(path: string, body: unknown, schema: { parse(value: unknown): T }, extraHeaders: Record<string, string> = {}): Promise<T> {
    const r = await this.request(`${this.options.baseUrl}/api${path}`, { method: "POST", headers: { "content-type": "application/json", ...this.options.headers, ...extraHeaders }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return schema.parse(await r.json());
  }
  async markets(params: { category?: string; engine?: "POOL" | "LMSR"; status?: string; cursor?: string; limit?: number } = {}): Promise<MarketPage> {
    const query = new URLSearchParams(); for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
    return this.get(`/markets${query.size ? `?${query}` : ""}`, MarketPageSchema);
  }
  async market(id:string):Promise<Market>{ return this.get(`/markets/${encodeURIComponent(id)}`, MarketSchema); }
  async prices(id:string):Promise<ActivityRecord>{ return this.get(`/markets/${encodeURIComponent(id)}/prices`, { parse: (v) => z.record(z.unknown()).parse(v) }); }
  async trades(id:string):Promise<ActivityRecord[]>{ return this.get(`/markets/${encodeURIComponent(id)}/trades`, RecordsSchema); }
  async liquidity(id:string):Promise<ActivityRecord[]>{ return this.get(`/markets/${encodeURIComponent(id)}/liquidity`, RecordsSchema); }
  async resolution(id:string):Promise<ResolutionRecord>{return this.get(`/markets/${encodeURIComponent(id)}/resolution`, ResolutionRecordSchema);}
  async evidence(id:string):Promise<ActivityRecord[]>{ return this.get(`/markets/${encodeURIComponent(id)}/evidence`, RecordsSchema); }
  async positions(address:string, headers:Record<string,string> = {}):Promise<ActivityRecord[]>{ return this.get(`/users/${encodeURIComponent(address)}/positions`, RecordsSchema, headers); }
  async history(address:string, headers:Record<string,string> = {}):Promise<ActivityRecord[]>{ return this.get(`/users/${encodeURIComponent(address)}/history`, RecordsSchema, headers); }
  async quote(id:string, request: QuoteRequest):Promise<Quote>{ return this.post(`/markets/${encodeURIComponent(id)}/quote`, request, QuoteSchema); }
  async prepareTrade(id:string, request: QuoteRequest):Promise<TransactionPreparation>{ return this.post(`/markets/${encodeURIComponent(id)}/prepare-trade`, request, TransactionPreparationSchema); }
  async prepareProposalBond(proposal: Proposal, proposer: string): Promise<ProposalBondPreparation> {
    return this.post("/market-proposals/prepare-bond", proposal, { parse: (v) => ProposalBondPreparationSchema.parse(v) }, { "x-wallet-address": proposer });
  }
  async submitProposal(proposal: Proposal, bondTxHash: `0x${string}`, proposer: string):Promise<ProposalStatus>{ return this.post("/market-proposals", { proposal, bondTxHash }, ProposalStatusSchema, { "x-wallet-address": proposer }); }
  async proposal(id:string):Promise<ProposalStatus>{ return this.get(`/market-proposals/${encodeURIComponent(id)}`, ProposalStatusSchema); }
  async health(): Promise<Health> { return this.get("/health", HealthSchema); }
}
