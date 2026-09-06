import { Market, ResolutionEnvelope, Proposal, QuoteRequest, Quote, TransactionPreparation, MarketSchema, ResolutionEnvelopeSchema, QuoteSchema, TransactionPreparationSchema } from "@genetia/shared";
export type GenetiaClientOptions = { baseUrl: string; fetch?: typeof fetch; headers?: Record<string, string> };
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
  async markets(): Promise<Market[]> { return this.get("/markets", { parse: (v) => Array.isArray(v) ? v.map((item) => MarketSchema.parse(item)) : (() => { throw new Error("invalid markets response"); })() }); }
  async market(id:string):Promise<Market>{ return this.get(`/markets/${encodeURIComponent(id)}`, MarketSchema); }
  async prices(id:string):Promise<unknown>{ return this.get(`/markets/${encodeURIComponent(id)}/prices`, { parse: (v) => v }); }
  async trades(id:string):Promise<unknown>{ return this.get(`/markets/${encodeURIComponent(id)}/trades`, { parse: (v) => v }); }
  async liquidity(id:string):Promise<unknown>{ return this.get(`/markets/${encodeURIComponent(id)}/liquidity`, { parse: (v) => v }); }
  async resolution(id:string):Promise<ResolutionEnvelope>{return this.get(`/markets/${encodeURIComponent(id)}/resolution`, ResolutionEnvelopeSchema);}
  async evidence(id:string):Promise<unknown>{ return this.get(`/markets/${encodeURIComponent(id)}/evidence`, { parse: (v) => v }); }
  async positions(address:string):Promise<unknown>{ return this.get(`/users/${address}/positions`, { parse: (v) => v }); }
  async history(address:string):Promise<unknown>{ return this.get(`/users/${address}/history`, { parse: (v) => v }); }
  async quote(id:string, request: QuoteRequest):Promise<Quote>{ return this.post(`/markets/${encodeURIComponent(id)}/quote`, request, QuoteSchema); }
  async prepareTrade(id:string, request: QuoteRequest):Promise<TransactionPreparation>{ return this.post(`/markets/${encodeURIComponent(id)}/prepare-trade`, request, TransactionPreparationSchema); }
  async submitProposal(proposal: Proposal):Promise<unknown>{ return this.post("/market-proposals", proposal, { parse: (v) => v }); }
  async proposal(id:string):Promise<unknown>{ return this.get(`/market-proposals/${encodeURIComponent(id)}`, { parse: (v) => v }); }
}
