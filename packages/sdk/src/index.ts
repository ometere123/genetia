import { Market, ResolutionEnvelope } from "@genetia/shared";
export type GenetiaClientOptions = { baseUrl: string; fetch?: typeof fetch };
export class GenetiaClient {
  private readonly request: typeof fetch;
  constructor(private readonly options: GenetiaClientOptions) { this.request = options.fetch ?? fetch; }
  async markets(): Promise<Market[]> { const r=await this.request(`${this.options.baseUrl}/api/v1/markets`); if(!r.ok) throw new Error(`markets ${r.status}`); return (await r.json()) as Market[]; }
  async market(id:string):Promise<Market>{const r=await this.request(`${this.options.baseUrl}/api/v1/markets/${encodeURIComponent(id)}`);if(!r.ok)throw new Error(`market ${r.status}`);return (await r.json()) as Market;}
  async resolution(id:string):Promise<ResolutionEnvelope>{const r=await this.request(`${this.options.baseUrl}/api/v1/markets/${encodeURIComponent(id)}/resolution`);if(!r.ok)throw new Error(`resolution ${r.status}`);return (await r.json()) as ResolutionEnvelope;}
}
