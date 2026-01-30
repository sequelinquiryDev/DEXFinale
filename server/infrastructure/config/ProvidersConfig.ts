/**
 * ProvidersConfig - Centralized API Provider Configuration
 * 
 * SINGLE SOURCE OF TRUTH for all external API calls:
 * - RPC Providers (Infura, Alchemy)
 * - Block Explorer APIs (Etherscan, PolygonScan)
 * - Data Sources for Market Viewer and Swapper
 * 
 * API CALL SOURCES:
 * - Infura: RPC calls HOT PATH ONLY
 * - Alchemy: RPC calls HOT PATH ONLY
 * - Etherscan: COLD PATH API
 * - PolygonScan: COLD PATH API
 * 
 * - Public RPCs: Fallback endpoints
 * 
 * SWITCHING ENDPOINTS:
 * Change values here to switch providers globally.
 * No other files need modification.
 */

interface ProviderEndpoints { //fix tbis//
  rpc: string;
  etherscan: string;
  alchemy?: string;
  fallbackRpc: string;
}

interface ChainProviders {
  [chainId: number]: ProviderEndpoints;
}

import { rpcConfig } from './RpcConfig';
import { explorerConfig } from './ExplorerConfig';

class ProvidersConfig {
  private static instance: ProvidersConfig;
  
  // Environment variables (with fallbacks)
  private infuraApiKey: string;
  private alchemyApiKey: string;
  private etherscanApiKey: string;
  private polygonscanApiKey: string;
  private polygonRpcUrl: string;

  // ProvidersConfig is a thin facade that delegates to `rpcConfig` and `explorerConfig`.
  // It preserves the public API for backwards compatibility.

  private constructor() {
    // Load from environment variables (for status reporting)
    this.infuraApiKey = process.env.INFURA_API_KEY || '84842078b09946638c03157f83405213';
    this.alchemyApiKey = process.env.ALCHEMY_API_KEY || 'demo';
    this.etherscanApiKey = process.env.ETHERSCAN_API_KEY || 'demo';
    this.polygonscanApiKey = process.env.POLYGONSCAN_API_KEY || process.env.POLYGON_API_KEY || 'demo';
    this.polygonRpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';

    // NOTE: ProvidersConfig delegates runtime resolution to RpcConfig and ExplorerConfig.
    this.logInitialization();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ProvidersConfig {
    if (!ProvidersConfig.instance) {
      ProvidersConfig.instance = new ProvidersConfig();
    }
    return ProvidersConfig.instance;
  }

  /**
   * Get RPC endpoint for a specific chain
   * @param chainId Network chain ID (1 = Ethereum, 137 = Polygon)
   * @returns Primary RPC endpoint
   */
  public getRpcProvider(chainId: number): string {
    // Prefer named provider (Infura) for backward compatibility
    try {
      return rpcConfig.getRpcEndpointFromProvider('Infura', chainId);
    } catch (e) {
      // Fallback to first available endpoint
      const endpoints = rpcConfig.getEndpointsForChain(chainId);
      if (endpoints && endpoints.length > 0) {
        return endpoints[0].endpoint;
      }

      // Last-resort fallbacks
      if (chainId === 1) {
        return `https://mainnet.infura.io/v3/${this.infuraApiKey}`;
      } else if (chainId === 137) {
        return this.polygonRpcUrl;
      }

      throw new Error(`No RPC provider configured for chain ${chainId}`);
    }
  }

  /**
   * Get fallback RPC endpoint for a specific chain
   * @param chainId Network chain ID
   * @returns Fallback RPC endpoint
   */
  public getFallbackRpcProvider(chainId: number): string {
    const endpoints = rpcConfig.getEndpointsForChain(chainId);
    if (endpoints && endpoints.length > 1) {
      return endpoints[1].endpoint;
    }
    if (endpoints && endpoints.length === 1) {
      return endpoints[0].endpoint;
    }

    // Chain-specific fallback
    if (chainId === 137) {
      return this.polygonRpcUrl;
    }
    if (chainId === 1) {
      return `https://eth-mainnet.alchemyapi.io/v2/${this.alchemyApiKey}`;
    }

    throw new Error(`No fallback RPC provider configured for chain ${chainId}`);
  }

  /**
   * Get Alchemy endpoint for a specific chain
   * @param chainId Network chain ID
   * @returns Alchemy RPC endpoint
   */
  public getAlchemyProvider(chainId: number): string | undefined {
    try {
      return rpcConfig.getRpcEndpointFromProvider('Alchemy', chainId);
    } catch (e) {
      const endpoints = rpcConfig.getEndpointsForChain(chainId);
      const match = endpoints.find(e => e.provider === 'Alchemy');
      return match ? match.endpoint : undefined;
    }
  }

  /**
   * Get Etherscan API endpoint for a specific chain
   * @param chainId Network chain ID
   * @returns Etherscan API endpoint
   */
  public getEtherscanApi(chainId: number): string {
    try {
      return explorerConfig.getExplorerApiUrl(chainId);
    } catch (e) {
      // Fallback to legacy constructed endpoints
      if (chainId === 1) {
        return `https://api.etherscan.io/api?apikey=${this.etherscanApiKey}`;
      } else if (chainId === 137) {
        return `https://api.polygonscan.com/api?apikey=${this.polygonscanApiKey}`;
      }
      throw new Error(`No Etherscan API configured for chain ${chainId}`);
    }
  }

  /**
   * Get all endpoints for a chain
   * @param chainId Network chain ID
   * @returns All configured endpoints for the chain
   */
  public getChainProviders(chainId: number): ProviderEndpoints {
    return {
      rpc: this.getRpcProvider(chainId),
      alchemy: this.getAlchemyProvider(chainId),
      etherscan: this.getEtherscanApi(chainId),
      fallbackRpc: this.getFallbackRpcProvider(chainId),
    };
  }

  /**
   * Get supported chain IDs
   * @returns Array of supported chain IDs
   */
  public getSupportedChains(): number[] {
    const rpcChains = Object.keys(rpcConfig.getStatus().counters).map(Number);
    const explorerChains = explorerConfig.getSupportedChains();
    const union = new Set<number>([...rpcChains, ...explorerChains]);
    return Array.from(union).sort((a, b) => a - b);
  }

  /**
   * Check if a chain is supported
   * @param chainId Network chain ID
   * @returns True if chain is supported
   */
  public isChainSupported(chainId: number): boolean {
    return this.getSupportedChains().includes(chainId);
  }

  /**
   * Validate configuration
   * Logs warnings if API keys are missing or default
   */
  private logInitialization(): void {
    const warnings: string[] = [];

    if (this.infuraApiKey === '84842078b09946638c03157f83405213') {
      warnings.push('INFURA_API_KEY is using public fallback (may have rate limits)');
    }

    if (this.alchemyApiKey === 'demo') {
      warnings.push('ALCHEMY_API_KEY is using demo key (may have rate limits)');
    }

    if (this.etherscanApiKey === 'demo') {
      warnings.push('ETHERSCAN_API_KEY is using demo key (may have rate limits)');
    }

    if (this.polygonscanApiKey === 'demo') {
      warnings.push('POLYGON_API_KEY is using demo key (may have rate limits)');
    }

    const rpcStatus = rpcConfig.getStatus();
    const explorers = explorerConfig.getStatus();

    console.log(`✓ ProvidersConfig: rpc providers: ${rpcStatus.providers.join(', ')}`);
    console.log(`✓ ProvidersConfig: explorers: ${explorers.explorers.map(e => e.name).join(', ')}`);

    if (warnings.length > 0) {
      console.warn('⚠️  ProvidersConfig Warnings:');
      warnings.forEach(w => console.warn(`   - ${w}`));
    }
  }

  /**
   * Get configuration status (for debugging)
   */
  public getStatus(): {
    chains: number[];
    infuraConfigured: boolean;
    alchemyConfigured: boolean;
    etherscanConfigured: boolean;
    rpcProviders: string[];
    explorers: { chainId: number; name: string }[];
  } {
    const rpcStatus = rpcConfig.getStatus();
    const explorers = explorerConfig.getStatus();

    return {
      chains: this.getSupportedChains(),
      infuraConfigured: this.infuraApiKey !== '84842078b09946638c03157f83405213',
      alchemyConfigured: this.alchemyApiKey !== 'demo',
      etherscanConfigured: this.etherscanApiKey !== 'demo',
      rpcProviders: rpcStatus.providers,
      explorers: explorers.explorers,
    };
  }
}

// Export singleton instance
export const providersConfig = ProvidersConfig.getInstance();

// Also export the class for testing
export { ProvidersConfig };
