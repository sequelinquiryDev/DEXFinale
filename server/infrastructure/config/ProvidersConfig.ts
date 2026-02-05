/**
 * ProvidersConfig - Centralized API Provider Configuration
 * 
 * SINGLE SOURCE OF TRUTH for all external API calls:
 * - RPC Providers (Infura, Alchemy)
 * - Block Explorer APIs (Etherscan, PolygonScan)
 * - Data Sources for Market Viewer and Swapper
 * 
 * API CALL SOURCES:
 * - Infura / Alchemy: HOT PATH RPC calls
 * - Block Explorers: COLD PATH API calls
 * 
 * SWITCHING ENDPOINTS:
 * Change values here to switch providers globally.
 */

import { getRpcConfig } from './RpcConfig';
import { explorerConfig } from './ExplorerConfig';

class ProvidersConfig {
  private static instance: ProvidersConfig;

  // Lazy-loaded RPC config
  private rpcConfigInstance = getRpcConfig();
  
  private constructor() {
    // Private constructor for singleton
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
   * Re-initialize all provider configs
   * This is necessary because env vars are not available on module load
   */
  public reinitialize(): void {
    this.rpcConfigInstance.reinitialize();
    explorerConfig.reinitialize();
    console.log('✓ ProvidersConfig: Re-initialized all providers');
  }

  /**
   * Get Etherscan / PolygonScan API endpoint for a chain
   * Delegates to ExplorerConfig
   */
  public getEtherscanApi(chainId: number): string {
    try {
      return explorerConfig.getExplorerApiUrl(chainId);
    } catch (e) {
      throw new Error(`No block explorer API configured for chain ${chainId}`);
    }
  }

  /**
   * Get all provider endpoints for a chain
   */
  public getChainProviders(chainId: number) {
    return {
      rpcEndpoint: this.rpcConfigInstance.getRpcEndpoint(chainId),
      etherscan: this.getEtherscanApi(chainId),
    };
  }

  /**
   * Check if a chain is supported by any provider
   */
  public isChainSupported(chainId: number): boolean {
    const rpcChains = this.rpcConfigInstance.getSupportedChains();
    const explorerChains = explorerConfig.getSupportedChains();
    const union = new Set<number>([...rpcChains, ...explorerChains]);
    return union.has(chainId);
  }
}

// Export singleton instance
export const providersConfig = ProvidersConfig.getInstance();

// Export class for testing
export { ProvidersConfig };
