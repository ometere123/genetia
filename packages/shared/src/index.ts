import { z } from "zod";
export const CHAIN = { base: 84532, genlayer: 61997 } as const;
export const Engine = z.enum(["POOL", "LMSR"]);
export const Outcome = z.enum(["YES", "NO", "VOID"]);
export const Market = z.object({ id:z.string(), marketId:z.string(), engine:Engine, question:z.string(), status:z.string(), baseAddress:z.string(), resolverAddress:z.string(), manifestHash:z.string(), closeTime:z.string(), terminalDeadline:z.string() });
export const ResolutionEnvelope = z.object({ marketId:z.string(), baseMarket:z.string(), baseChainId:z.literal(84532), resolver:z.string(), genlayerChainId:z.literal(61997), genlayerTxId:z.string(), manifestHash:z.string(), resolverReleaseId:z.string(), attempt:z.number().int().positive(), outcome:z.number().int().min(0).max(2), resultCommitment:z.string(), deadline:z.string() });
export type Market = z.infer<typeof Market>; export type ResolutionEnvelope = z.infer<typeof ResolutionEnvelope>;
export function lmsrFundingTarget(bMicro: bigint): bigint { const ln2Numerator=693147180559945309n; const target=(bMicro*ln2Numerator*110n)/(100n*10n**18n); return target>100_000_000n?target:100_000_000n; }
