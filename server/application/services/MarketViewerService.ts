/**
 * MarketViewerService - Market Data Display Service
 * 
 * RESPONSIBILITY: Fetch and aggregate market data for tokens
 * - Token prices in USD
 * - Liquidity, volume, and market metrics
 * - Track data sources explicitly
 * - Support network-specific data
 * 
 * DATA SOURCES:
 * 1. Explorer APIs (Etherscan, PolygonScan) - token info
 * 2. RPC Calls (via ProvidersConfig) - on-chain data
 * 3. Cache - previously fetched data
 * 4. Alchemy APIs - enhanced data
 * 5. Multicall - batch queries
 * 
 * EXPLICIT DATA TRACKING:
 * Every response includes "dataSource" field showing where data came from
 */

import { StorageService } from './StorageService';
import { rpcConfig } from '../../infrastructure/config/RpcConfig';
import { explorerConfig } from '../../infrastructure/config/ExplorerConfig';
import { networkConfig } from '../../infrastructure/config/NetworkConfig';
import {
  TokenMarketData,
  MarketOverview,
  DataSource,
  MarketDataWithError,
  TokenSearchResult,
  FetchMarketDataOptions,
} from '../../domain/market-viewer.types';

class MarketViewerService {
  private storageService: StorageService;
  private cache: Map<string, { data: TokenMarketData; expireAt: number }> = new Map();
  private readonly DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(storageService: StorageService) {
    this.storageService = storageService;
  }

  /**
   * Get market data for a single token
   * 
   * DATA SOURCES USED:
   * 1. Cache (fastest)
   * 2. Explorer API (Etherscan/PolygonScan)
   * 3. RPC calls
   * 4. Mock data (fallback)
   * 
   * @param tokenAddress Token contract address
   * @param chainId Network chain ID
   * @param options Fetch options
   * @returns Token market data with source attribution
   */
  public async getTokenMarketData(
    tokenAddress: string,
    chainId: number,
    options?: FetchMarketDataOptions
  ): Promise<TokenMarketData> {
    const cacheKey = `${tokenAddress}-${chainId}`;

    // Check cache first (unless forceRefresh)
    if (!options?.forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expireAt > Date.now()) {
        console.log(`✓ Market data from cache: ${tokenAddress} on chain ${chainId}`);
        return cached.data;
      }
    }

    // Fetch from explorer API
    try {
      const explorerData = await this.fetchFromExplorerApi(tokenAddress, chainId);
      if (explorerData) {
        this.setCacheEntry(cacheKey, explorerData);
        return explorerData;
      }
    } catch (error) {
      console.warn(`⚠️ Explorer API failed for ${tokenAddress}:`, error);
    }

    // Fallback: return mock/placeholder data
    const fallbackData = this.getMockTokenData(tokenAddress, chainId);
    this.setCacheEntry(cacheKey, fallbackData);
    return fallbackData;
  }

  /**
   * Get market overview for all tokens on a network
   * 
   * @param chainId Network chain ID
   * @returns Market overview with all tokens
   */
  public async getMarketOverview(chainId: number): Promise<MarketOverview> {
    console.log(`📊 Fetching market overview for chain ${chainId}`);

    // Get tokens for this network
    const tokens = await this.storageService.getTokensByNetwork(chainId);

    // Fetch market data for each token in parallel
    const marketDataPromises = tokens.map(token =>
      this.getTokenMarketData(token.address, chainId)
    );

    const marketDataResults = await Promise.all(marketDataPromises);

    // Calculate aggregate metrics
    const totalLiquidity = marketDataResults.reduce((sum: number, t: TokenMarketData) => sum + (t.liquidity || 0), 0);
    const totalVolume24h = marketDataResults.reduce((sum: number, t: TokenMarketData) => sum + (t.volume24h || 0), 0);

    return {
      chainId,
      tokens: marketDataResults,
      timestamp: Date.now(),
      totalLiquidity,
      totalVolume24h,
    };
  }

  /**
   * Search for tokens by symbol, name, or address
   * 
   * @param query Search query
   * @param chainId Network chain ID
   * @returns Array of matching tokens
   */
  public async searchTokens(query: string, chainId: number): Promise<TokenSearchResult[]> {
    console.log(`🔍 Searching tokens for: "${query}" on chain ${chainId}`);

    const tokens = await this.storageService.getTokensByNetwork(chainId);
    const lowerQuery = query.toLowerCase();

    const results: TokenSearchResult[] = tokens
      .map(token => {
        let relevanceScore = 0;

        // Exact symbol match = high score
        if (token.symbol.toLowerCase() === lowerQuery) {
          relevanceScore = 1.0;
        }
        // Symbol starts with query = high score
        else if (token.symbol.toLowerCase().startsWith(lowerQuery)) {
          relevanceScore = 0.9;
        }
        // Name contains query = medium score
        else if (token.name.toLowerCase().includes(lowerQuery)) {
          relevanceScore = 0.6;
        }
        // Address match = low score
        else if (token.address.toLowerCase().includes(lowerQuery)) {
          relevanceScore = 0.3;
        }

        return {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          chainId,
          logoURI: (token as any).logoURI,
          relevanceScore,
        };
      })
      .filter(t => t.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    return results;
  }

  /**
   * Get tokens for a specific network
   * 
   * PHASE 1: Attach pool metadata before serving to hot path
   * 
   * @param chainId Network chain ID
   * @returns List of tokens with attached pool metadata
   */
  public async getTokensForNetwork(chainId: number) {
    console.log(`📋 Fetching tokens for chain ${chainId}`);
    const tokens = await this.storageService.getTokensByNetwork(chainId);
    
    // PHASE 1: Attach pool metadata to each token
    const poolRegistry = await this.storageService.getPoolRegistry(chainId);
    const tokensWithPools = tokens.map(token => ({
      ...token,
      pricingPools: poolRegistry.pricingRoutes[token.address] || [],
    }));

    return tokensWithPools;
  }

  /**
   * INTERNAL: Fetch data from Explorer API
   * DATA SOURCE: Explorer API (Etherscan, PolygonScan)
   */
  private async fetchFromExplorerApi(
    tokenAddress: string,
    chainId: number
  ): Promise<TokenMarketData | null> {
    try {
      const explorer = explorerConfig.getExplorer(chainId);
      const apiUrl = explorerConfig.getExplorerApiUrl(chainId);
      
      if (!apiUrl || apiUrl.includes('?apikey=')) {
        // Check if we actually have an API key
        const url = new URL(apiUrl);
        const apiKey = url.searchParams.get('apikey');
        if (!apiKey || apiKey === '') {
          console.log(`⚠️ No ${explorer.name} API key configured, using fallback`);
          return null;
        }
      }

      console.log(`🌐 Fetching from ${explorer.name} for ${tokenAddress}`);

      // Build the Etherscan/PolygonScan API request for token info
      const params = new URLSearchParams({
        module: 'token',
        action: 'tokeninfo',
        contractaddress: tokenAddress,
      });

      // Add API key if available
      const urlWithKey = `${apiUrl}&${params.toString()}`;
      const response = await fetch(urlWithKey);

      if (!response.ok) {
        console.warn(`⚠️ ${explorer.name} API returned ${response.status}`);
        return null;
      }

      const data = await response.json();

      // Check if the API returned an error
      if (data.status !== '1' || data.result?.length === 0) {
        console.warn(`⚠️ ${explorer.name} no data for token ${tokenAddress}`);
        return null;
      }

      const tokenInfo = data.result[0];

      // Parse the response and construct TokenMarketData
      const marketData: TokenMarketData = {
        address: tokenAddress,
        symbol: tokenInfo.symbol || 'UNKNOWN',
        name: tokenInfo.name || 'Unknown Token',
        decimals: parseInt(tokenInfo.decimals || '18'),
        chainId,
        price: 0, // Explorer API doesn't provide price; would need pricing oracle
        priceChange24h: 0, // Not available from explorer
        liquidity: 0, // Not available from explorer
        volume24h: 0, // Not available from explorer
        holders: parseInt(tokenInfo.holders || '0'),
        dataSource: 'explorer-api' as DataSource,
        timestamp: Date.now(),
        cachedUntil: Date.now() + this.DEFAULT_CACHE_TTL,
      };

      return marketData;
    } catch (error) {
      console.error(`❌ Explorer API error:`, error);
      return null;
    }
  }

  /**
   * INTERNAL: Get fallback data (no mock random numbers)
   * DATA SOURCE: On-chain data (where available)
   */
  private getMockTokenData(tokenAddress: string, chainId: number): TokenMarketData {
    // Return realistic fallback: fetch what we can from storage/explorer,
    // but DO NOT generate random numbers
    const token = {
      address: tokenAddress,
      symbol: 'N/A',
      name: `Token ${tokenAddress.slice(2, 8)}`,
      decimals: 18,
      chainId,
      price: 0, // No pricing data available
      priceChange24h: 0,
      liquidity: 0, // No liquidity data available
      volume24h: 0, // No volume data available
      holders: 0,
      dataSource: 'insufficient-data' as DataSource,
      timestamp: Date.now(),
      cachedUntil: Date.now() + this.DEFAULT_CACHE_TTL,
    };

    console.warn(`⚠️ Insufficient data for token ${tokenAddress} - returning zero values`);
    return token;
  }

  /**
   * INTERNAL: Store data in cache
   */
  private setCacheEntry(key: string, data: TokenMarketData): void {
    this.cache.set(key, {
      data,
      expireAt: Date.now() + this.DEFAULT_CACHE_TTL,
    });
  }

  /**
   * Clear cache (for testing or manual refresh)
   */
  public clearCache(): void {
    this.cache.clear();
    console.log('🗑️ Market viewer cache cleared');
  }

  /**
   * Get cache status
   */
  public getCacheStatus() {
    return {
      entriesCount: this.cache.size,
      ttl: this.DEFAULT_CACHE_TTL,
    };
  }
}

// Export singleton
let instance: MarketViewerService;

export function createMarketViewerService(storageService: StorageService): MarketViewerService {
  if (!instance) {
    instance = new MarketViewerService(storageService);
  }
  return instance;
}

export { MarketViewerService };
