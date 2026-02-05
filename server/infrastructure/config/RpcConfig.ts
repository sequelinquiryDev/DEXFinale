/**
 * RpcConfig - Centralized RPC Provider Configuration
 * 
 * RESPONSIBILITY: Consolidate all RPC provider information
 * - Read API keys from environment variables
 * - Build provider endpoints for all supported chains
 * - Provide a consistent interface for accessing RPC endpoints
 * 
 * GOAL: Decouple RPC provider logic from application services
 * - Services request an RPC endpoint for a chain, not a specific provider
 * - Easy to add/remove/prioritize providers without service-level changes
 */

import { networkConfig, ChainId } from "./NetworkConfig";

export interface RpcProvider {
  name: string;
  endpoints: {
    [key in ChainId]?: string;
  };
}

class RpcConfig {
  private static instance: RpcConfig;
  private providers: RpcProvider[] = [];
  private roundRobinIndex: Map<number, number> = new Map();

  private constructor() {
    this.loadProviders();
  }

  public static getInstance(): RpcConfig {
    if (!RpcConfig.instance) {
      RpcConfig.instance = new RpcConfig();
    }
    return RpcConfig.instance;
  }

  /**
   * Get the next available RPC endpoint for a chain in round-robin fashion
   * 
   * @param chainId The ID of the chain
   * @returns The RPC endpoint URL
   */
  public getRpcEndpoint(chainId: number): string {
    const availableProviders = this.providers.filter(
      (p) => p.endpoints[chainId as ChainId]
    );

    if (availableProviders.length === 0) {
      // As a last resort, fall back to the public RPC URL from NetworkConfig
      console.warn(`⚠️ No dedicated RPC provider found for chain ${chainId}. Using public RPC.`)
      const network = networkConfig.getNetwork(chainId);
      return network.rpcUrl;
    }

    // Initialize round-robin index if not present
    if (!this.roundRobinIndex.has(chainId)) {
      this.roundRobinIndex.set(chainId, 0);
    }

    // Get current index and provider
    const currentIndex = this.roundRobinIndex.get(chainId)!;
    const provider = availableProviders[currentIndex];

    // Update index for next call
    this.roundRobinIndex.set(chainId, (currentIndex + 1) % availableProviders.length);

    return provider.endpoints[chainId as ChainId]!;
  }

  /**
   * Load providers from environment variables
   * Best-effort: if a key is missing, that provider is simply disabled
   */
  private loadProviders(): void {
    const envVars = {
      INFURA_API_KEY: process.env.INFURA_API_KEY,
      ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY,
      POLYGON_RPC_URL: process.env.POLYGON_RPC_URL, // Optional public RPC
    };

    // Deduplicate missing key warnings
    Object.entries(envVars).forEach(([key, value]) => {
      if (!value) console.warn(`⚠️ ${key} not provided. Some RPC features may be disabled.`);
    });

    const providers: RpcProvider[] = [];

    if (envVars.INFURA_API_KEY) {
      providers.push({
        name: 'Infura',
        endpoints: {
          [ChainId.ETHEREUM]: `https://mainnet.infura.io/v3/${envVars.INFURA_API_KEY}`,
          [ChainId.POLYGON]: `https://polygon-mainnet.infura.io/v3/${envVars.INFURA_API_KEY}`,
        },
      });
    }

    if (envVars.ALCHEMY_API_KEY) {
      providers.push({
        name: 'Alchemy',
        endpoints: {
          [ChainId.ETHEREUM]: `https://eth-mainnet.g.alchemy.com/v2/${envVars.ALCHEMY_API_KEY}`,
          [ChainId.POLYGON]: `https://polygon-mainnet.g.alchemy.com/v2/${envVars.ALCHEMY_API_KEY}`,
        },
      });
    }

    if (envVars.POLYGON_RPC_URL) {
      providers.push({
        name: 'PublicPolygon',
        endpoints: {
          [ChainId.POLYGON]: envVars.POLYGON_RPC_URL,
        },
      });
    }

    this.providers = providers;
    console.log(`📡 Loaded ${this.providers.length} RPC providers`);
  }
  
  public reinitialize(): void {
    this.loadProviders();
  }

  /**
   * Get all loaded RPC providers
   * @returns An array of RpcProvider objects
   */
  public getProviders(): RpcProvider[] {
    return this.providers;
  }

  public getSupportedChains(): number[] {
    const chainIds = new Set<number>();
    for (const provider of this.providers) {
        for (const chainIdStr in provider.endpoints) {
            chainIds.add(Number(chainIdStr));
        }
    }
    return Array.from(chainIds);
  }
}

// Export singleton instance
export const rpcConfig = RpcConfig.getInstance();
export const getRpcConfig = RpcConfig.getInstance;
