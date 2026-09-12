# Future Alignment — Things we don't do yet

A living list of architectural and operational gaps between what Genetia is today and what Arc's [Institutional-Grade Prediction Markets blueprint](https://www.circle.com/blog/build-institutional-grade-prediction-markets-on-arc) calls out as the full vision. Nothing here is required for launch. Everything here becomes relevant when a specific user demand or growth signal shows up.

Read this when:
- You've validated consumer market-product fit and are thinking about what to build next
- A potential partner / institution asks "do you support X?"
- Considering pivoting toward enterprise / governance use cases
- Re-reading the Arc blueprint and wondering "which of those did we skip and why?"

---

## Roadmap status — what's actually live in this doc

After cross-checking each blueprint item against what **Polymarket actually does** (the dominant prediction-market product, doing >$1B/mo at peak), we narrowed the active "build later" list. Items Polymarket has explicitly chosen NOT to build moved to §8.

**Active (build when the trigger fires):**
- §1  Multi-currency markets / FX  — Arc's unique differentiator vs. Polymarket
- §3  Higher-trust resolution        — needed before high-stakes mainnet markets
- §4  Liquidity model evolution      — natural growth path
- §5  Operational maturity           — pre-mainnet must-haves
- §6  Treasury / protocol economics  — automation + monitoring of what already works
- §7  UX polish (incl. localization) — user-feedback driven
- §9  Globally adaptable UX          — when we have users in non-English regions

**Deferred indefinitely (Polymarket doesn't do these either):**
- §2  Compliance hooks / KYC / identity gating  → Polymarket geoblocks the US, no KYC for the rest
- Programmable policy controls / transfer restrictions  → Polymarket's CTF is permissionless

These move to §8 ("Things we should explicitly NOT build (yet)") so we don't accidentally let them creep into a sprint.

---

## Today's architecture, briefly

- **Settlement:** USDC on Arc Testnet, real on-chain transfers per buy/sell/redeem
- **Wallets:** Circle Developer-Controlled SCAs (ERC-4337), email-only onboarding via Privy
- **Gas:** Sponsored via Circle Gas Station Paymaster (testnet free, mainnet billed)
- **Market mechanism:** LMSR (Hanson), bounded LP loss `b × ln(2)`, one ERC-1155 outcome-tokens contract for all markets
- **Resolution:** GenLayer intelligent contract returns AI verdict → relayer pushes `proposeResolution` to Arc → 24h challenge window → finalize
- **Override:** Single admin key can `adminResolve(outcome)` from any non-finalized state
- **Custody model:** Non-custodial — user wallets hold both USDC and outcome tokens directly. Protocol treasury holds only seed liquidity and accumulated fees.

That's the foundation. Everything below is upward-composable on it.

---

## 1. Multi-currency markets (EURC, USDP, custom stablecoins)

**What's missing:**
The current `LMSRMarketFactory` and `LMSRMarket` contracts hardcode the USDC address as the only collateral asset. Every market settles in USDC, regardless of region.

**What the blueprint wants:**
A European inflation market settling in EURC; a Latin American election market settling in a Brazilian-real stablecoin; institutional markets with custom whitelisted collateral. Multi-stablecoin settlement on a single chain.

**Why we don't need it now:**
- 100% of testnet users are us. No real geographic spread to optimize for.
- Adding currency dimensions before validating product is over-engineering.

**Trigger to build:**
> "I want to bet on this in [non-USDC stablecoin] because that's what I hold."
> — from at least 3 different users with money in those stablecoins.

**Rough scope:**
- Parameterise `LMSRMarket` constructor with `IERC20 collateralToken`
- Update `LMSRMarketFactory.createMarket()` to accept a collateral token argument
- Treasury holds per-currency balances; seed liquidity comes from the matching pool
- UI: currency picker on market creation, currency label on every price/balance display
- Wallet page: separate "balance per currency" view
- ~1 week dev

**Optional follow-on:** Native FX routing between currency pools so a EURC bettor can buy into a USDC-collateralised market. Arc's planned onchain FX primitive would handle this; without it we'd need a USDC ↔ EURC AMM.

---

## 2. ~~Compliance hooks~~ → moved to §8

The Arc blueprint pitches KYC, identity gating, transfer controls. Polymarket — the dominant prediction-market product — does **none of these**:

- Geoblocks the US (since 2022 CFTC settlement) — blanket regional ban, not per-user KYC
- Wallet + email login for the rest of the world, no government-ID upload
- CTF outcome tokens are vanilla ERC-1155s with no transfer hooks
- Push real identity into fiat on-ramps (Moonpay etc.) which they don't control anyway

Their compliance posture isn't aspirational — it's the practical baseline. Building more compliance than Polymarket before we have Polymarket's users is the textbook over-engineering trap.

**See §8 for the full "don't build this" entry, including specific triggers that would change the call.**

---

## 3. Higher-trust resolution

**What's missing:**
Today, resolution is:
1. GenLayer (single AI judge) returns a verdict
2. 24-hour challenge window with one disputer slot
3. Admin (single key) can override at any time

That's fine for "Will Bitcoin be above $100k tonight?" — the question is unambiguous and the AI is reliable.

It's NOT fine for high-stakes nuanced markets where the resolution itself is contested.

**What the blueprint implies:**
Institutional users need credibly neutral resolution they can point to a regulator and say "this is provably fair."

**Why we don't need it now:**
- Consumer markets with $5-100 stakes don't care about nuanced resolution
- AI judge with admin override is faster + cheaper than UMA-style optimistic resolution
- Until disputes actually happen in production, more elaborate resolution is hypothetical

**Trigger to build:**
- A user disputes a resolution and we have no good answer
- Larger markets ($1000+ stakes) where unilateral admin override becomes a reputational risk
- A partner explicitly requests decentralised resolution

**Rough scope (in priority order):**
1. **Multi-sig admin** — replace single admin key with a 2-of-3 or 3-of-5 Safe. Half-day of work, big trust upgrade.
2. **Longer challenge windows** — make `CHALLENGE_WINDOW` per-market, configurable at creation (24h for retail, 7d for high-stakes).
3. **Multiple GenLayer runs** — N independent verdicts, require majority agreement before propose. Requires changes to the resolver pipeline + GenLayer contract.
4. **Tiered disputers** — first disputer's bond gets returned + reward if admin agrees; multiple disputers per market with bond accumulation.
5. **Optional UMA fallback** — high-stakes markets can configure UMA-style optimistic oracle as the dispute escalation path instead of admin.

Total: 1-2 weeks for the easy wins (1+2), 4-6 weeks for the full thing.

---

## 4. Liquidity model — LMSR → AMM → CLOB

**What's missing:**
LMSR is the right mechanism for our scale: bounded LP loss, smooth pricing, works from trade #1. But it has a built-in ~2% spread baked into the curve, which becomes expensive at trade sizes >$100.

**What the blueprint wants:**
Markets that can absorb $10k+ trades with tight spreads. That's CLOB territory — real market makers, tight bid/ask, deep books.

**Why we don't need it now:**
- Consumer trades are $5-50, 2% spread is fine
- CLOB requires market makers running bots — solo dev can't bootstrap that
- LMSR's "always a counterparty" property is critical at low volume

**Migration path (when needed):**

| Stage | Mechanism | When |
|---|---|---|
| Now | LMSR with `b = 100` seed per market | Validating consumer product |
| Stage 2 | LMSR with `b = 1000`+ seed per market | Average trade size hits $50+, treasury can fund deeper books |
| Stage 3 | FPMM (constant product on outcome tokens) | Polymarket's old model. Better for medium-volume markets where LMSR's b·ln(2) loss becomes meaningful |
| Stage 4 | CLOB (off-chain matching, on-chain settlement) | Real market makers signed up, average market depth >$5k |

The mechanism is per-market — old LMSR markets continue running while new high-volume markets use a different curve. We don't need a forced migration.

**Rough scope:** Stage 2 is a config change. Stage 3 is ~1 week (new contract). Stage 4 is 1-2 months (CLOB service + market maker outreach + contracts).

---

## 5. Operational maturity

**What's missing for "institutional-grade":**

- **Monitoring** — no Prometheus / Datadog / Sentry / etc. We have console.log.
- **Alerting** — if the resolver pipeline starts erroring, nobody knows until a user complains.
- **Status page** — no public "is Genetia up right now?" page.
- **Indexer reliability** — single instance, no failover. If the relayer crashes, events stop being mirrored to DB.
- **Treasury monitoring** — no alerts when treasury USDC dips below a threshold for seeding new markets.
- **Multiple RPC providers** — single Arc RPC endpoint. If it goes down (or load-balances to a wedge node), we have no fallback.
- **DB high-availability** — single Supabase instance. The recent Supabase pause was a real outage.
- **Disaster recovery** — no defined procedure for "Circle is down for 4 hours, what do we do."

**Why we don't need it now:**
Testnet, no users, no SLAs to maintain.

**Trigger to build:**
- First real outage that loses user trust
- First time the product needs to be up overnight without active monitoring
- First paying user

**Rough scope:**
- Sentry / similar for error tracking: 1 day
- Prometheus + Grafana basic dashboard: 2 days
- Multi-RPC fallback in viem clients: half-day
- Indexer dead-man-switch (heartbeat to monitoring): 1 day
- Status page (statuspage.io or self-hosted): 1 day
- DB HA / replication: Supabase Pro tier, ~no code
- ~1 week of focused ops work

**Supabase security hardening (pre-mainnet):**
Supabase's default project ships with a handful of `SECURITY DEFINER` helper functions (e.g. `public.rls_auto_enable()`) that are publicly executable. Harmless on testnet, but the Security Advisor flags them and a real audit would too. Lock down with:

```sql
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
```

Also enable RLS on every table that contains user-scoped data (`users`, `wallet_balances`, `wallet_transactions`, `circle_wallets`, `linked_wallets`, `bets`, `positions`, `arc_trades`, `market_suggestions`) with policies that gate by `auth.uid()` matching the row's user. Our backend uses the service role and bypasses RLS anyway, but enabling it means a stolen anon key can't drain the DB through PostgREST. Half a day of policy writing.

---

## 6. Treasury / protocol economics

**What's missing:**
- ~~No `sweepCollateral()` function on `LMSRMarket`~~ — **fixed in v2.1** (factory `0x1212c53D…bc74c`). Reserves outstanding-redemption obligation; sweeps the rest to admin-supplied address after a 1-day grace.
- No automated `sweepFees()` cron — fees accumulate in each Market contract until admin manually sweeps
- No on-chain treasury accounting — we don't have a clear view of "what is the protocol worth right now"
- No revenue dashboard
- No payout/fees breakdown report

**Known accounting hole:**
- ~$200 of treasury seed is permanently locked in the v2.0 factory's markets (`0x05EB43E2…1A190`), since those `LMSRMarket` instances pre-date `sweepCollateral`. Treated as a write-off cost of catching the bug post-launch.

**Trigger to build:**
- First time treasury runs out of seed money
- First financial / fundraising conversation where someone asks for unit economics

**Rough scope:**
- Add `sweepCollateral()` to `LMSRMarket` (admin-only, after market is finalized + X day grace period for unclaimed winners): half-day
- Automated fee-sweep cron in relayer: 1 day
- Treasury balance + revenue dashboard in admin: 1-2 days
- ~3-4 days total

---

## 7. UX polish for prediction-market specifics

**What's missing:**
- **Sell-back math is opaque** — TradingPanel shows "you'll get X USDC" but doesn't explain the LMSR sell curve. Users will be confused why they can't sell back at exactly the buy price.
- **No probability history chart for LMSR markets** — currently reads from old `bets` table, shows "History begins after first trade" forever. Should index `ArcTrade` events.
- **Mini-charts on homepage are stale** — pulling from the same dead `bets` table.
- **Position P&L isn't displayed** — wallet Positions tab shows shares but not "you're up $X / down $X".
- **No notification when a market you've bet on resolves** — user has to manually check.
- **No history of YES/NO probability over time visible to user.**
- **No "all markets you've traded in" view, separate from active positions.**

**Why we don't need it now:**
- Most aren't blockers; just polish.
- Some (P&L, probability history) ARE blockers for a good user experience.

**Trigger to build:**
- The few real users we get for early testing each say "where's my P&L?" or "where's the chart?"

**Rough scope:**
- Probability history endpoint reading from `ArcTrade`: 1 day
- Live probability chart with proper LMSR-aware historical reconstruction: 2 days
- P&L per position (mark-to-market): 1 day
- Resolution notifications via email (next-intl + Resend or similar): 1-2 days
- ~1 week of polish work

---

## 8. Things we should explicitly NOT build (yet)

To be clear about what's NOT on this list:

- **Native mobile app** — web works fine for now. Mobile-first PWA is the right next step before native.
- **Token (governance / utility)** — no protocol token. Adds legal complexity for zero immediate benefit.
- **Liquidity mining / yield** — would just attract mercenary capital. Treasury seeding is sufficient until real users exist.
- **Cross-chain bridging to other L2s** — Arc-only is fine. Adding chains multiplies the attack surface for no current benefit.
- **Concurrent multiple AI judges** — pre-mature. Pick GenLayer, ship, see if AI resolution actually wins user trust before adding redundancy.
- **Decentralised governance** — solo dev, no users. No one to govern with yet.

### Compliance hooks, KYC, identity gating, transfer controls

**Polymarket reference:** They do **none** of this and operate at >$1B/mo on certain markets. Specifically:
- Geoblocks the US (single regional ban after CFTC 2022 settlement, $1.4M fine)
- Magic.link / email login elsewhere — no government-ID upload
- CTF outcome tokens are permissionless ERC-1155s
- Real KYC pushed to fiat on-ramps (Moonpay etc.) outside Polymarket's stack

**Triggers that would flip this back to active:**
- Legal counsel says "we need KYC to launch in jurisdiction X"
- A partner (regulated entity, governance org, enterprise customer) says "we need verified-users-only markets"
- A regulator actually contacts us with a specific ask

Until one of those triggers, every hour spent building KYC is an hour not spent validating with real users.

### Programmable policy controls / transfer restrictions

Same logic. Polymarket's outcome tokens have no transfer hooks, no allowlists, no role-based gating. Their CTF is permissionless. We mirror that posture.

**Triggers that would flip this back to active:**
- Partner ask for verified-users-only or jurisdiction-restricted markets
- A specific high-stakes market design that requires per-user limits

---

If we build any of these before we have product-market fit, we're building shiny tech instead of a useful product.

---

## 9. Globally adaptable UX (localization)

**What's missing:**
- `next-intl` is wired into the Next.js app, but strings are English-only
- No locale picker (the "GB" flag in the navbar is decorative — doesn't change anything)
- No localized number / currency / date formatting
- No regional market curation (a UK user sees the same homepage as a US user)
- No per-jurisdiction blocklist (we don't even block the US yet — pre-mainnet that's fine)

**What the blueprint wants:**
"Globally adaptable global UX with support for localized market design and participation." Multi-language, multi-region, country-tailored market discovery.

**Why we don't need it now:**
- Polymarket doesn't do localization either — English-only, US geoblocked, rest of world the same UI
- 100% of testnet users speak English

**Trigger to build:**
- A non-English-speaking partner / community asks for localized markets
- Enough non-English users that translation effort pays back in retention
- Mainnet launch requires a geoblock list (different from full localization, but related)

**Rough scope:**
- Translation file scaffolding (we have `next-intl`, just need en.json / es.json / etc.)
- Locale picker in navbar that actually changes the language
- `Intl.NumberFormat` / `Intl.DateTimeFormat` for all $, %, dates throughout the app
- Per-locale market discovery (regional trending) — bigger, defer
- Geoblock list driven by CDN-level IP detection (mainnet hardening) — separate work
- ~1 week for the basic translation pipeline + locale picker, more for per-region content curation

---

## How to use this doc

When considering "what's next" after the current MVP is stable:

1. Re-read this file.
2. Look at which items have **triggers that have actually been hit** (user demand, partner ask, real-world incident).
3. Pick the one with the highest "trigger met × ROI / effort" ratio.
4. Build only that.
5. Repeat.

Building any of these without the trigger being hit is over-engineering. Building the right one when the trigger fires is what makes a product actually grow.
