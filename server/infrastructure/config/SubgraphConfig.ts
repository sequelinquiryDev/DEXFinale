/**
 * Subgraph Configuration
 * 
 * Defines which subgraphs to query for pool topology discovery
 * Uses The Graph API endpoints
 */

import { ChainId } from "./NetworkConfig";

export type DexType = "v2" | "v3" | "custom";
export type SupportedChainId = ChainId.ETHEREUM | ChainId.POLYGON;

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
    [ChainId.ETHEREUM]: [
      // Uniswap
      {
        name: "Uniswap V4 (Ethereum)",
        endpoint: buildGraphEndpoint("DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G"),
        dexType: "v3", // treated as v3-compatible
        chainId: ChainId.ETHEREUM,
      },
      {
        name: "Uniswap V3 (Ethereum)",
        endpoint: buildGraphEndpoint("5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV"),
        dexType: "v3",
        chainId: ChainId.ETHEREUM,
      },
      {
        name: "Uniswap V2 (Ethereum)",
        endpoint: buildGraphEndpoint("A3Np3RQbaBA6oKJgiwDJeo5T3zrYfGHPWFYayMwtNDum"),
        dexType: "v2",
        chainId: ChainId.ETHEREUM,
      },
      // SushiSwap
      {
        name: "SushiSwap V2 (Ethereum)",
        endpoint: buildGraphEndpoint("77jZ9KWeyi3CJ96zkkj5s1CojKPHt6XJKjLFzsDCd8Fd"),
        dexType: "v2",
        chainId: ChainId.ETHEREUM,
      },
      {
        name: "SushiSwap V3 (Ethereum)",
        endpoint: buildGraphEndpoint("2tGWMrDha4164KkFAfkU3rDCtuxGb4q1emXmFdLLzJ8x"),
        dexType: "v3",
        chainId: ChainId.ETHEREUM,
      },
    ],

    // Polygon Mainnet
    [ChainId.POLYGON]: [
      {
        name: "Uniswap V3 (Polygon)",
        endpoint: buildGraphEndpoint("3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm"),
        dexType: "v3",
        chainId: ChainId.POLYGON,
      },
      {
        name: "SushiSwap (Polygon)",
        endpoint: buildGraphEndpoint("B3Jt84tHJJjanE4W1YijyksTwtm7jqK8KcG5dcoc1ZNF"),
        dexType: "v2",
        chainId: ChainId.POLYGON,
      },
      {
        name: "QuickSwap (Polygon)",
        endpoint: buildGraphEndpoint("CbYdVpAtj6bU1jcb7FcEWn2ydLdVNhwRy1c7C2XGrNa9"),
        dexType: "v2",
        chainId: ChainId.POLYGON,
      },
    ],
  };
}
