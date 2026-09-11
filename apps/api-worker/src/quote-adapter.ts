import { createPublicClient, http, parseAbi, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { MarketSchema, QuoteSchema, type Quote, type QuoteRequest } from "@genetia/shared";

const poolAbi = parseAbi([
  "function yesTotal() view returns (uint256)",
  "function noTotal() view returns (uint256)",
  "function terminal() view returns (bool)",
  "function closeTime() view returns (uint256)",
]);
const lmsrAbi = parseAbi([
  "function qYes() view returns (uint256)",
  "function qNo() view returns (uint256)",
  "function b() view returns (uint256)",
  "function status() view returns (uint8)",
  "function closeTime() view returns (uint256)",
  "function priceYes() view returns (uint256)",
  "function quoteBuy(uint8 side, uint256 shares) view returns (uint256 notional, uint256 fee)",
  "function quoteSell(uint8 side, uint256 shares) view returns (uint256 notional, uint256 fee)",
]);

function liveClient(rpcUrl: string) {
  if (!rpcUrl.trim()) throw new Error("Base RPC is not configured");
  return createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
}

function unixNow(): bigint { return BigInt(Math.floor(Date.now() / 1000)); }

export async function liveQuote(marketValue: unknown, request: QuoteRequest, rpcUrl: string): Promise<Quote> {
  const market = MarketSchema.parse(marketValue);
  const amount = BigInt(request.amount);
  if (amount <= 0n) throw new Error("amount must be positive");
  const client = liveClient(rpcUrl);
  const address = market.baseAddress as Address;
  const quoteAt = unixNow().toString();

  if (market.engine === "POOL") {
    if (request.action !== "BUY") throw new Error("Pool markets do not support selling");
    const [yesTotal, noTotal, terminal, closeTime] = await client.multicall({
      allowFailure: false,
      contracts: [
        { address, abi: poolAbi, functionName: "yesTotal" },
        { address, abi: poolAbi, functionName: "noTotal" },
        { address, abi: poolAbi, functionName: "terminal" },
        { address, abi: poolAbi, functionName: "closeTime" },
      ],
    });
    if (terminal) throw new Error("market is terminal");
    if (unixNow() >= closeTime) throw new Error("market is closed");
    const nextYes = request.side === "YES" ? yesTotal + amount : yesTotal;
    const nextNo = request.side === "NO" ? noTotal + amount : noTotal;
    return QuoteSchema.parse({
      marketId: market.marketId, engine: "POOL", action: "BUY", side: request.side,
      shares: request.amount, notional: request.amount, fee: "0", total: request.amount,
      priceAfter: "0", yesTotal: yesTotal.toString(), noTotal: noTotal.toString(),
      nextYesTotal: nextYes.toString(), nextNoTotal: nextNo.toString(), feeRateBps: 150,
      quoteAt, chainId: 84532, contract: address,
    });
  }

  const [qYes, qNo, b, status, closeTime, priceYes] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address, abi: lmsrAbi, functionName: "qYes" },
      { address, abi: lmsrAbi, functionName: "qNo" },
      { address, abi: lmsrAbi, functionName: "b" },
      { address, abi: lmsrAbi, functionName: "status" },
      { address, abi: lmsrAbi, functionName: "closeTime" },
      { address, abi: lmsrAbi, functionName: "priceYes" },
    ],
  });
  if (status !== 1) throw new Error(status === 2 ? "market is terminal" : "LMSR market is not active");
  if (unixNow() >= closeTime) throw new Error("market is closed");
  const side = request.side === "YES" ? 1 : 0;
  const [notional, fee] = request.action === "BUY"
    ? await client.readContract({ address, abi: lmsrAbi, functionName: "quoteBuy", args: [side, amount] })
    : await client.readContract({ address, abi: lmsrAbi, functionName: "quoteSell", args: [side, amount] });
  const total = request.action === "BUY" ? notional + fee : notional - fee;
  if (total <= 0n) throw new Error("quote has no payable value");
  if (request.action === "BUY" && request.maxTotal !== undefined && total > BigInt(request.maxTotal)) throw new Error("maxTotal is below live quote");
  if (request.action === "SELL" && request.minNet !== undefined && total < BigInt(request.minNet)) throw new Error("minNet is above live quote");
  return QuoteSchema.parse({
    marketId: market.marketId, engine: "LMSR", action: request.action, side: request.side,
    shares: request.amount, notional: notional.toString(), fee: fee.toString(), total: total.toString(),
    priceAfter: priceYes.toString(), qYes: qYes.toString(), qNo: qNo.toString(), b: b.toString(),
    feeRateBps: 100, quoteAt, chainId: 84532, contract: address,
  });
}
