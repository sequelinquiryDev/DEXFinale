/**
 * Subgraph Configuration
 * 
 * Defines which subgraphs to query for pool topology discovery
 * Uses The Graph Studio hosted endpoints
 */

import { ChainId } from "./NetworkConfig";

export type DexType = "v2" | "v3" | "custom";
export type SupportedChainId = ChainId.ETHEREUM | ChainId.POLYGON;

export interface SubgraphConfig {
  name: string;         // Human-readable label for frontend
  endpoint: string;     // Studio GraphQL endpoint
  dexType: DexType;     // v2/v3 or custom logic
  chainId: SupportedChainId;
}

// Export full configuration: one subgraph per chain
export function getSubgraphConfig(): Record<SupportedChainId, SubgraphConfig[]> {
  return {
    // Ethereum Mainnet - single subgraph indexes all Ethereum factories
    [ChainId.ETHEREUM]: [
      {
        name: "Ethereum Pools (All Factories)",
        endpoint: "https://api.studio.thegraph.com/query/1724648/mine/version/latest",
        dexType: "custom",  // multiple factories, v2+v3 combined
        chainId: ChainId.ETHEREUM,
      },
    ],

    // Polygon Mainnet - single subgraph indexes all Polygon factories
    [ChainId.POLYGON]: [
      {
        name: "Polygon Pools (All Factories)",
        endpoint: "https://api.studio.thegraph.com/query/1724648/mine-p/version/latest",
        dexType: "custom",  // multiple factories, v2+v3 combined
        chainId: ChainId.POLYGON,
      },
    ],
  };
}