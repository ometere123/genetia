import { encodeFunctionData, parseAbi } from "viem";
import { MarketSchema, type QuoteRequest, type TransactionPreparation } from "@genetia/shared";

const poolAbi = parseAbi(["function stake(bool yes, uint256 amount)"]);
const lmsrAbi = parseAbi([
  "function buy(uint8 side, uint256 shares, uint256 maxTotal)",
  "function sell(uint8 side, uint256 shares, uint256 minNet)",
]);

export function prepareTrade(marketValue: unknown, request: QuoteRequest): TransactionPreparation {
  const market = MarketSchema.parse(marketValue);
  const amount = BigInt(request.amount);
  if (amount <= 0n) throw new Error("amount must be positive");
  if (market.status !== "ACTIVE") throw new Error("market is not active");
  const side = request.side === "YES" ? 1 : 0;
  let data: `0x${string}`;
  if (market.engine === "POOL") {
    if (request.action !== "BUY") throw new Error("Pool markets do not support selling");
    data = encodeFunctionData({ abi: poolAbi, functionName: "stake", args: [request.side === "YES", amount] });
  } else if (request.action === "BUY") {
    if (!request.maxTotal) throw new Error("maxTotal is required for LMSR buys");
    data = encodeFunctionData({ abi: lmsrAbi, functionName: "buy", args: [side, amount, BigInt(request.maxTotal)] });
  } else {
    if (!request.minNet) throw new Error("minNet is required for LMSR sells");
    data = encodeFunctionData({ abi: lmsrAbi, functionName: "sell", args: [side, amount, BigInt(request.minNet)] });
  }
  const collateral = (marketValue as { collateralAddress?: unknown }).collateralAddress;
  return {
    chainId: 84532,
    to: market.baseAddress as `0x${string}`,
    data,
    value: "0",
    marketId: market.marketId,
    engine: market.engine,
    action: request.action,
    side: request.side,
    amount: request.amount,
    approval: typeof collateral === "string" && /^0x[a-f-fA-F0-9]{40}$/.test(collateral)
      ? { token: collateral as `0x${string}`, spender: market.baseAddress as `0x${string}`, amount: request.action === "BUY" ? request.maxTotal ?? request.amount : "0" }
      : null,
  };
}
