/**
 * Subgraph Configuration
 * 
 * Defines which subgraphs to query for pool topology discovery
 * Uses The Graph API endpoints
 */

export type DexType = "v2" | "v3" | "custom";
export type SupportedChainId = 1 | 137;

export interface SubgraphConfig {
  name: string;
  endpoint: string;
  dexType: DexType;
  chainId: SupportedChainId;
}

// Read Graph API key once at module load
const GRAPH_API_KEY = process.env.THE_GRAPH_API_KEY || "";
if (!GRAPH_API_KEY) {
  console.warn(
    "THE_GRAPH_API_KEY not set. Subgraph queries will be made without an API key."
  );
}

// Helper to build Graph endpoints
function buildGraphEndpoint(subgraphId: string): string {
  return GRAPH_API_KEY
    ? `https://gateway.thegraph.com/api/${GRAPH_API_KEY}/subgraphs/id/${subgraphId}`
    : `https://api.thegraph.com/subgraphs/id/${subgraphId}`;
}

// Export the full configuration
export function getSubgraphConfig(): Record<SupportedChainId, SubgraphConfig[]> {
  return {
    // Ethereum Mainnet
    1: [
      // Uniswap
      {
        name: "Uniswap V4 (Ethereum)",
        endpoint: buildGraphEndpoint("DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G"),
        dexType: "v3", // treated as v3-compatible
        chainId: 1,
      },
      {
        name: "Uniswap V3 (Ethereum)",
        endpoint: buildGraphEndpoint("5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV"),
        dexType: "v3",
        chainId: 1,
      },
      {
        name: "Uniswap V2 (Ethereum)",
        endpoint: buildGraphEndpoint("A3Np3RQbaBA6oKJgiwDJeo5T3zrYfGHPWFYayMwtNDum"),
        dexType: "v2",
        chainId: 1,
      },
      // SushiSwap
      {
        name: "SushiSwap V2 (Ethereum)",
        endpoint: buildGraphEndpoint("77jZ9KWeyi3CJ96zkkj5s1CojKPHt6XJKjLFzsDCd8Fd"),
        dexType: "v2",
        chainId: 1,
      },
      {
        name: "SushiSwap V3 (Ethereum)",
        endpoint: buildGraphEndpoint("2tGWMrDha4164KkFAfkU3rDCtuxGb4q1emXmFdLLzJ8x"),
        dexType: "v3",
        chainId: 1,
      },
    ],

    // Polygon Mainnet
    137: [
      {
        name: "Uniswap V3 (Polygon)",
        endpoint: buildGraphEndpoint("3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm"),
        dexType: "v3",
        chainId: 137,
      },
      {
        name: "SushiSwap (Polygon)",
        endpoint: buildGraphEndpoint("B3Jt84tHJJjanE4W1YijyksTwtm7jqK8KcG5dcoc1ZNF"),
        dexType: "v2",
        chainId: 137,
      },
      {
        name: "QuickSwap (Polygon)",
        endpoint: buildGraphEndpoint("CbYdVpAtj6bU1jcb7FcEWn2ydLdVNhwRy1c7C2XGrNa9"),
        dexType: "v2",
        chainId: 137,
      },
    ],
  };
}

// Optional: base tokens by network (unchanged)
export interface BaseToken {
  symbol: string;
  address: string;
}

export const BASE_TOKENS: Record<SupportedChainId, BaseToken[]> = {
  1: [
    { symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
    { symbol: "USDT", address: "0xdac17f958d2ee523a2206206994597c13d831ec7" },
    { symbol: "DAI",  address: "0x6b175474e89094c44da98b954eedeac495271d0f" },
    { symbol: "WETH", address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" },
  ],
  137: [
    { symbol: "USDC", address: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174" },
    { symbol: "USDT", address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f" },
    { symbol: "DAI",  address: "0x8f3cf7ad23cd3cadbd9735aff958023d60d76ee6" },
    { symbol: "WETH", address: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619" },
    { symbol: "WMATIC", address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270" },
  ],
};