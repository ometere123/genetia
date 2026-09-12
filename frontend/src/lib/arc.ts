import { type Chain } from "viem";

// Arc Testnet chain definition for wagmi/viem.
export const arcTestnet: Chain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18, // native interface is 18 dec
  },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
    public:  { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
};

// USDC ERC-20 address on Arc (6 decimals for ERC-20 transfers).
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const USDC_DECIMALS = 6;

// Deployed contract addresses — populated after deployment.
export const MARKET_FACTORY_ADDRESS =
  (process.env.NEXT_PUBLIC_MARKET_FACTORY_ADDRESS ?? "") as `0x${string}`;

export const MARKET_FACTORY_ABI = [
  {
    name: "createMarket",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "question", type: "string" },
      { name: "category", type: "string" },
      { name: "endDate",  type: "uint256" },
    ],
    outputs: [{ name: "market", type: "address" }],
  },
  {
    name: "suggestMarket",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "question",  type: "string"  },
      { name: "category",  type: "string"  },
      { name: "endDate",   type: "uint256" },
      { name: "criteria",  type: "string"  },
    ],
    outputs: [],
  },
  {
    name: "adminResolveMarket",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "market",  type: "address" },
      { name: "outcome", type: "bool"    },
    ],
    outputs: [],
  },
  {
    name: "operators",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getMarkets",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    name: "getMarketsCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "MarketCreated",
    type: "event",
    inputs: [
      { name: "market",   type: "address", indexed: true  },
      { name: "creator",  type: "address", indexed: true  },
      { name: "question", type: "string",  indexed: false },
      { name: "category", type: "string",  indexed: false },
      { name: "endDate",  type: "uint256", indexed: false },
    ],
  },
  {
    name: "MarketSuggested",
    type: "event",
    inputs: [
      { name: "from",     type: "address", indexed: true  },
      { name: "question", type: "string",  indexed: false },
      { name: "category", type: "string",  indexed: false },
      { name: "endDate",  type: "uint256", indexed: false },
      { name: "criteria", type: "string",  indexed: false },
    ],
  },
] as const;

export const PREDICTION_MARKET_ABI = [
  {
    name: "marketInfo",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "_question",    type: "string"  },
      { name: "_category",    type: "string"  },
      { name: "_endDate",     type: "uint256" },
      { name: "_yesPool",     type: "uint256" },
      { name: "_noPool",      type: "uint256" },
      { name: "_resolved",    type: "bool"    },
      { name: "_outcome",     type: "bool"    },
      { name: "_yesProbBps",  type: "uint256" },
    ],
  },
  {
    name: "buyYes",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "usdcAmount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "buyNo",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "usdcAmount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "claim",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "yesShares",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "noShares",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "adminResolve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_outcome", type: "bool" }],
    outputs: [],
  },
  {
    name: "SharesBought",
    type: "event",
    inputs: [
      { name: "user",   type: "address", indexed: true  },
      { name: "isYes",  type: "bool",    indexed: false },
      { name: "usdc",   type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
  {
    name: "MarketResolved",
    type: "event",
    inputs: [
      { name: "outcome",   type: "bool",    indexed: false },
      { name: "totalPool", type: "uint256", indexed: false },
    ],
  },
] as const;

export const USDC_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount",  type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner",   type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
