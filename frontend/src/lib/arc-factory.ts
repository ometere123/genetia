/**
 * Arc LMSRMarketFactory bridge — server-only.
 *
 * Mirrors approved DB markets onto an on-chain LMSRMarket by calling
 * `LMSRMarketFactory.createMarket(b, expiry)`. Returns the new market's
 * Arc address + on-chain market id so the caller can stamp them onto the
 * Market row.
 *
 * Auth model: only the factory `admin` key may call `createMarket`. On
 * testnet, set `ARC_ADMIN_PRIVATE_KEY` (or fall back to the operator key).
 * The treasury wallet must have an active USDC allowance for the factory
 * so it can pull `b` USDC of seed liquidity per market.
 */

import "server-only";

import { decodeEventLog } from "viem";
import { LMSR_FACTORY_ABI } from "./lmsr-abi";

interface MirrorResult {
  arcAddress: `0x${string}` | null;
  arcTxHash: `0x${string}` | null;
  marketIdOnChain: string | null;
  b: string | null;
  error?: string;
}

/**
 * Deploy an LMSRMarket on Arc and return its address + on-chain id.
 *
 * Never throws — returns `{ error }` on failure so the caller can still
 * approve the DB market and retry the Arc mirror later from the admin
 * dashboard.
 */
export async function createMarketOnArc(args: {
  question: string;
  category: string;
  expiry: Date;
  /** LMSR liquidity parameter b, in 6-dec USDC. Defaults to 100 USDC. */
  bMicros?: bigint;
}): Promise<MirrorResult> {
  void args.question;
  void args.category;
  // (question/category are off-chain only on LMSR v2 — they live in the DB,
  //  not in the contract. We still accept them in the signature so callers
  //  don't have to change.)

  const factoryAddress = (process.env.NEXT_PUBLIC_LMSR_FACTORY_ADDRESS ?? "") as `0x${string}`;
  const adminKey = (
    process.env.ARC_ADMIN_PRIVATE_KEY ??
    process.env.ARC_OPERATOR_PRIVATE_KEY ??
    ""
  ) as `0x${string}`;
  const rpcUrl = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
  const chainId = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");

  if (!factoryAddress || !adminKey) {
    return {
      arcAddress: null,
      arcTxHash: null,
      marketIdOnChain: null,
      b: null,
      error:
        "Arc mirror skipped — set NEXT_PUBLIC_LMSR_FACTORY_ADDRESS and ARC_ADMIN_PRIVATE_KEY",
    };
  }

  const b = args.bMicros ?? 100n * 1_000_000n; // default 100 USDC seed

  try {
    const viem = require("viem");
    const { privateKeyToAccount } = require("viem/accounts");

    const chain = {
      id: chainId,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    } as const;

    const keyNorm = adminKey.startsWith("0x") ? adminKey : (`0x${adminKey}` as `0x${string}`);
    const account = privateKeyToAccount(keyNorm);
    const wallet = viem.createWalletClient({ account, chain, transport: viem.http(rpcUrl) });
    const pub = viem.createPublicClient({ chain, transport: viem.http(rpcUrl) });

    const expirySeconds = BigInt(Math.floor(args.expiry.getTime() / 1000));

    // Simulate first for a clean revert reason (e.g. treasury not approved).
    const { request } = await pub.simulateContract({
      account,
      address: factoryAddress,
      abi: LMSR_FACTORY_ABI,
      functionName: "createMarket",
      args: [b, expirySeconds],
    });

    const hash = (await wallet.writeContract(request)) as `0x${string}`;
    const receipt = await pub.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") {
      return {
        arcAddress: null,
        arcTxHash: hash,
        marketIdOnChain: null,
        b: b.toString(),
        error: "Arc tx reverted",
      };
    }

    // Pull the new Market address + id out of the MarketCreated event.
    let arcAddress: `0x${string}` | null = null;
    let marketIdOnChain: string | null = null;
    for (const log of receipt.logs as { address: string; topics: string[]; data: string }[]) {
      if (log.address.toLowerCase() !== factoryAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: LMSR_FACTORY_ABI,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        if (decoded.eventName === "MarketCreated") {
          const a = decoded.args as { marketId: bigint; market: `0x${string}` };
          arcAddress = a.market;
          marketIdOnChain = a.marketId.toString();
          break;
        }
      } catch {
        /* fall through */
      }
    }

    return {
      arcAddress,
      arcTxHash: hash,
      marketIdOnChain,
      b: b.toString(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return {
      arcAddress: null,
      arcTxHash: null,
      marketIdOnChain: null,
      b: b.toString(),
      error: msg,
    };
  }
}
