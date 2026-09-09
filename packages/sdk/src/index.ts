import { z } from "zod";
import { Market, ResolutionEnvelope, Proposal, QuoteRequest, Quote, TransactionPreparation, MarketSchema, ResolutionEnvelopeSchema, QuoteSchema, TransactionPreparationSchema } from "@genetia/shared";
export type GenetiaClientOptions = { baseUrl: string; fetch?: typeof fetch; headers?: Record<string, string> };
export type ActivityRecord = Record<string, unknown>;
export type MarketPage = { items: Market[]; nextCursor: string | null };
export type Health = { ok: boolean; baseChainId: number; genlayerChainId: number; database: boolean };
const MarketPageSchema = z.object({ items: z.array(MarketSchema), nextCursor: z.string().nullable() });
const HealthSchema = z.object({ ok: z.boolean(), baseChainId: z.number(), genlayerChainId: z.number(), database: z.boolean() });
const RecordsSchema = z.array(z.record(z.unknown()));
export class GenetiaClient {
  private readonly request: typeof fetch;
  constructor(private readonly options: GenetiaClientOptions) { this.request = options.fetch ?? fetch; }
  private async get<T>(path: string, schema: { parse(value: unknown): T }): Promise<T> {
    const r = await this.request(`${this.options.baseUrl}/api${path}`, { headers: this.options.headers });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return schema.parse(await r.json());
  }
  private async post<T>(path: string, body: unknown, schema: { parse(value: unknown): T }): Promise<T> {
    const r = await this.request(`${this.options.baseUrl}/api${path}`, { method: "POST", headers: { "content-type": "application/json", ...this.options.headers }, body: JSON.stringify(body) });
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
  async resolution(id:string):Promise<ResolutionEnvelope>{return this.get(`/markets/${encodeURIComponent(id)}/resolution`, ResolutionEnvelopeSchema);}
  async evidence(id:string):Promise<ActivityRecord[]>{ return this.get(`/markets/${encodeURIComponent(id)}/evidence`, RecordsSchema); }
  async positions(address:string):Promise<ActivityRecord[]>{ return this.get(`/users/${address}/positions`, RecordsSchema); }
  async history(address:string):Promise<ActivityRecord[]>{ return this.get(`/users/${address}/history`, RecordsSchema); }
  async quote(id:string, request: QuoteRequest):Promise<Quote>{ return this.post(`/markets/${encodeURIComponent(id)}/quote`, request, QuoteSchema); }
  async prepareTrade(id:string, request: QuoteRequest):Promise<TransactionPreparation>{ return this.post(`/markets/${encodeURIComponent(id)}/prepare-trade`, request, TransactionPreparationSchema); }
  async submitProposal(proposal: Proposal):Promise<unknown>{ return this.post("/market-proposals", proposal, { parse: (v) => v }); }
  async proposal(id:string):Promise<ActivityRecord>{ return this.get(`/market-proposals/${encodeURIComponent(id)}`, { parse: (v) => z.record(z.unknown()).parse(v) }); }
  async health(): Promise<Health> { return this.get("/health", HealthSchema); }
}
