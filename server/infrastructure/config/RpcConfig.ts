/**
 * RpcConfig - RPC Endpoint Configuration
 * 
 * RESPONSIBILITY: Manage RPC providers with round-robin load balancing
 * - Multiple RPC providers (Infura, Alchemy, PublicPolygon)
 * - Both can query Ethereum and Polygon
 * - Round-robin selection for redundancy and load distribution
 * 
 * ROUND-ROBIN LOGIC:
 * - Maintains counter per chain
 * - Cycles through available providers
 * - Ensures even distribution of requests
 * 
 * ADDING NEW RPCS:
 * 1. Add provider name to PROVIDERS array
 * 2. Add endpoint URLs to providers config
 * 3. Done - round-robin automatically includes it
 */

export interface RpcProvider {
  name: string;
  endpoints: {
    [chainId: number]: string;
  };
}

class RpcConfig {
  private static instance: RpcConfig;

  // List of RPC providers (add more here easily)
  private providers: RpcProvider[] = [];

  // Round-robin counters per chain
  private roundRobinCounters: Map<number, number> = new Map();

  // Track if we've initialized
  private initialized: boolean = false;

  private constructor() {
    // Don't initialize in constructor - do it lazily
  }

  /**
   * Singleton instance access
   */
  public static getInstance(): RpcConfig {
    if (!RpcConfig.instance) {
      RpcConfig.instance = new RpcConfig();
    }
    if (!RpcConfig.instance.initialized) {
      RpcConfig.instance.initializeProviders();
      RpcConfig.instance.initializeCounters();
      RpcConfig.instance.initialized = true;
    }
    return RpcConfig.instance;
  }

  /**
   * Initialize all RPC providers
   */
  private initializeProviders(): void {
    const envVars = {
      INFURA_API_KEY: process.env.INFURA_API_KEY,
      ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY,
      POLYGON_RPC_URL: process.env.POLYGON_RPC_URL,
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
          1: `https://mainnet.infura.io/v3/${envVars.INFURA_API_KEY}`,
          137: `https://polygon-mainnet.infura.io/v3/${envVars.INFURA_API_KEY}`,
        },
      });
    }

    if (envVars.ALCHEMY_API_KEY) {
      providers.push({
        name: 'Alchemy',
        endpoints: {
          1: `https://eth-mainnet.g.alchemy.com/v2/${envVars.ALCHEMY_API_KEY}`,
          137: `https://polygon-mainnet.g.alchemy.com/v2/${envVars.ALCHEMY_API_KEY}`,
        },
      });
    }

    if (envVars.POLYGON_RPC_URL) {
      providers.push({
        name: 'PublicPolygon',
        endpoints: {
          137: envVars.POLYGON_RPC_URL,
        },
      });
    }

    this.providers = providers;

    if (providers.length === 0) {
      console.warn('⚠️ RpcConfig: No RPC providers configured. Set INFURA_API_KEY, ALCHEMY_API_KEY, or POLYGON_RPC_URL.');
    } else {
      console.log(`✓ RpcConfig: Initialized ${this.providers.length} RPC providers: ${this.getAvailableProviders().join(', ')}`);
    }
  }

  /**
   * Initialize round-robin counters for each chain
   */
  private initializeCounters(): void {
    this.roundRobinCounters.set(1, 0);   // Ethereum
    this.roundRobinCounters.set(137, 0); // Polygon
  }

  /**
   * Reinitialize providers (useful after env vars are loaded)
   */
  public reinitialize(): void {
    this.providers = [];
    this.initializeProviders();
    this.initializeCounters();
    this.initialized = true;
  }

  /**
   * Get next RPC endpoint using round-robin
   * @param chainId Network chain ID
   * @returns RPC endpoint URL
   */
  public getNextRpcEndpoint(chainId: number): string {
    const available = this.providers.filter(p => p.endpoints[chainId]);
    if (available.length === 0) {
      throw new Error(`No RPC provider available for chain ${chainId}`);
    }

    const counter = this.roundRobinCounters.get(chainId) || 0;
    const nextIndex = counter % available.length;

    const provider = available[nextIndex];

    // Increment counter for next call
    this.roundRobinCounters.set(chainId, (counter + 1) % available.length);

    return provider.endpoints[chainId];
  }

  /**
   * Get RPC endpoint from specific provider
   * @param providerName Name of RPC provider (e.g., 'Infura', 'Alchemy')
   * @param chainId Network chain ID
   * @returns RPC endpoint URL
   */
  public getRpcEndpointFromProvider(providerName: string, chainId: number): string {
    const provider = this.providers.find(p => p.name === providerName);
    if (!provider || !provider.endpoints[chainId]) {
      throw new Error(`Provider "${providerName}" not available for chain ${chainId}`);
    }
    return provider.endpoints[chainId];
  }

  /**
   * Get all available RPC providers
   * @returns Array of provider names
   */
  public getAvailableProviders(): string[] {
    return this.providers.map(p => p.name);
  }

  /**
   * Get all endpoints for a specific chain
   * @param chainId Network chain ID
   * @returns Array of endpoints for this chain
   */
  public getEndpointsForChain(chainId: number): { provider: string; endpoint: string }[] {
    return this.providers
      .filter(p => p.endpoints[chainId])
      .map(p => ({
        provider: p.name,
        endpoint: p.endpoints[chainId],
      }));
  }

  /**
   * Check if provider supports a chain
   * @param providerName Name of RPC provider
   * @param chainId Network chain ID
   * @returns True if provider supports the chain
   */
  public isProviderSupported(providerName: string, chainId: number): boolean {
    const provider = this.providers.find(p => p.name === providerName);
    return provider ? !!provider.endpoints[chainId] : false;
  }

  /**
   * Get configuration status
   */
  public getStatus(): {
    providers: string[];
    counters: Record<number, number>;
  } {
    const counters: Record<number, number> = {};
    this.roundRobinCounters.forEach((value, key) => {
      counters[key] = value;
    });

    return {
      providers: this.getAvailableProviders(),
      counters,
    };
  }

  /**
   * Reset round-robin counters (for testing)
   */
  public resetCounters(): void {
    this.initializeCounters();
  }
}

// Export getInstance function
export function getRpcConfig(): RpcConfig {
  return RpcConfig.getInstance();
}

// Export class for testing
export { RpcConfig };