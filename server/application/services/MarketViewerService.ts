/**
 * MarketViewerService - Market Data Display Service
 * 
 * RESPONSIBILITY: Fetch and aggregate market data for tokens
 * - Token prices in USD via SpotPricingEngine (uses pool data)
 * - Token metadata from StorageService
 * - Liquidity, holders from Explorer APIs (optional)
 * - Track data sources explicitly
 * - Support network-specific data
 * 
 * PRICING FLOW:
 * 1. SpotPricingEngine computes prices from pool data (cached in SharedStateCache)
 * 2. Pool data is maintained fresh by PoolScheduler
 * 3. Explorer APIs provide supplemental metadata (holders, contract creation date)
 * 
 * HOT PATH INTEGRATION:
 * - Receives tokens with pricingPools already attached (from cold path)
 * - Calls PoolController.handleTokenInterest() to register pool interest
 * - PoolScheduler monitors and executes multicall queries
 * 
 * EXPLICIT DATA TRACKING:
 * Every response includes "dataSource" field showing where data came from
 */

import { StorageService } from './StorageService';
import { spotPricingEngine } from './SpotPricingEngine';
import { sharedStateCache } from './SharedStateCache';
import { poolController } from './PoolController';
import { CacheLayer } from './CacheLayer';
import { PoolScheduler } from './PoolScheduler';
import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import { providersConfig } from '../../infrastructure/config/ProvidersConfig';
import { timingConfig } from '../../infrastructure/config/TimingConfig';
import { ChainId } from '../../infrastructure/config/NetworkConfig';
import type { TokenMetadata } from '../../../shared/schema';
import {
  TokenMarketData,
  MarketOverview,
  DataSource,
  TokenSearchResult,
  FetchMarketDataOptions,
} from '../../domain/market-viewer.types';

class MarketViewerService {
  private storageService: StorageService;
  private cacheLayer: CacheLayer;
  private cache: Map<string, { data: TokenMarketData; expireAt: number }> = new Map();
  private readonly DEFAULT_CACHE_TTL = timingConfig.MARKET_DATA_CACHE_TTL_MS;
  private poolScheduler: PoolScheduler | null = null;
  private schedulerStarted = false;

  constructor(storageService: StorageService) {
    this.storageService = storageService;
    this.cacheLayer = new CacheLayer(storageService);
    this.initializeScheduler();
  }

  /**
   * Initialize PoolScheduler (hot path executor)
   */
  private initializeScheduler(): void {
    try {
      // Get RPC providers from config
      const rpcProviders: { [chainId: number]: string } = {};
      rpcProviders[ChainId.ETHEREUM] = providersConfig.getChainProviders(ChainId.ETHEREUM).rpcEndpoint;
      rpcProviders[ChainId.POLYGON] = providersConfig.getChainProviders(ChainId.POLYGON).rpcEndpoint;

      const ethersAdapter = new EthersAdapter();
      this.poolScheduler = new PoolScheduler(this.storageService, ethersAdapter);
    } catch (error) {
      console.error('Failed to initialize PoolScheduler:', error);
    }
  }

  /**
   * Start the pool scheduler if not already running
   */
  private async startSchedulerIfNeeded(): Promise<void> {
    if (this.schedulerStarted || !this.poolScheduler) return;

    try {
      await this.poolScheduler.start();
      this.schedulerStarted = true;
      console.log('✓ Pool scheduler started by MarketViewerService');
    } catch (error) {
      console.error('Error starting pool scheduler:', error);
    }
  }

  /**
   * Get market data for a single token
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

    if (!options?.forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expireAt > Date.now()) {
        return cached.data;
      }
    }

    const tokens = await this.storageService.getTokensByNetwork(chainId);
    const token = tokens.find(t => t.address.toLowerCase() === tokenAddress.toLowerCase());

    if (!token) {
      throw new Error(`Token ${tokenAddress} not found on chain ${chainId}`);
    }

    const price = await spotPricingEngine.computeSpotPrice(tokenAddress, chainId);
    console.log(`[LOG-MARKET-DATA] Token ${tokenAddress.slice(0, 6)}... got price from engine: ${price}`);

    const hasValidPrice = price !== null && price > 0;
    const marketData: TokenMarketData = {
      address: tokenAddress,
      symbol: token.symbol || 'N/A',
      name: token.name || `Token ${tokenAddress.slice(2, 8)}`,
      decimals: token.decimals || 18,
      chainId,
      price: price || 0,
      priceChange24h: 0,
      liquidity: 0,
      volume24h: 0,
      holders: 0,
      dataSource: hasValidPrice ? 'multicall' : 'insufficient-data' as DataSource,
      timestamp: Date.now(),
      cachedUntil: Date.now() + (hasValidPrice ? this.DEFAULT_CACHE_TTL : 0),
    };

    if (hasValidPrice) {
      this.setCacheEntry(cacheKey, marketData);
    }
    return marketData;
  }

  /**
   * Get market overview for a specific list of tokens.
   *
   * HOT PATH: This is the primary function for fetching market data for the UI.
   * 1. Fetches metadata for the requested token addresses.
   * 2. Attaches pricing pools to each token.
   * 3. Notifies the PoolController of the token interest (which deduplicates to pools).
   * 4. Fetches the market data for each token.
   * 
   * @param chainId Network chain ID
   * @param tokenAddresses Array of token addresses to fetch data for.
   * @returns Market overview with data for the specified tokens.
   */
  public async getMarketOverview(chainId: number, tokenAddresses: string[]): Promise<MarketOverview> {
    console.log(`📊 Fetching market overview for ${tokenAddresses.length} tokens on chain ${chainId}`);

    if (tokenAddresses.length === 0) {
        return {
            chainId,
            tokens: [],
            timestamp: Date.now(),
            totalLiquidity: 0,
            totalVolume24h: 0,
        };
    }

    // 1. Fetch metadata for the requested tokens from the cold path source.
    const allTokens = await this.cacheLayer.getTokensByNetworkCached(chainId);
    const tokenMetadataMap = new Map<string, TokenMetadata>(allTokens.map(t => [t.address.toLowerCase(), t]));
    
    const requestedTokens = tokenAddresses.map(address => tokenMetadataMap.get(address.toLowerCase())).filter(Boolean) as TokenMetadata[];

    // 2. Attach pricing pools to each token.
    const poolRegistry = await this.cacheLayer.getPoolRegistryCached(chainId);
    const tokensWithPools = requestedTokens.map(token => {
      // Flatten the nested pricingRoutes structure into a single array of pool addresses
      const tokenRoutes = poolRegistry.pricingRoutes[token.address.toLowerCase()] || {};
      const flattenedPools: string[] = [];
      for (const baseSymbol in tokenRoutes) {
        flattenedPools.push(...tokenRoutes[baseSymbol]);
      }
      return {
        ...token,
        pricingPools: flattenedPools,
      };
    });

    // 3. Notify PoolController of token interest.
    poolController.handleTokenInterest(tokensWithPools, chainId);
    
    // 4. Start scheduler if needed.
    await this.startSchedulerIfNeeded();

    // **FIX: Wait for the scheduler to complete its first run before proceeding**
    if (this.poolScheduler) {
      await this.poolScheduler.waitForFirstRun();
    }

    const marketDataPromises = tokensWithPools.map(token =>
      this.getTokenMarketData(token.address, chainId).catch(error => {
        console.error(`Error fetching market data for ${token.symbol}:`, error.message);
        return {
          address: token.address,
          symbol: token.symbol || 'N/A',
          name: token.name || `Token ${token.address.slice(2, 8)}`,
          decimals: token.decimals || 18,
          chainId,
          price: 0,
          priceChange24h: 0,
          liquidity: 0,
          volume24h: 0,
          holders: 0,
          dataSource: 'insufficient-data' as const,
          timestamp: Date.now(),
          cachedUntil: Date.now(),
        };
      })
    );

    const marketDataResults = await Promise.all(marketDataPromises);
    console.log(`[LOG-MARKET-OVERVIEW] Computed prices for ${marketDataResults.length} tokens`);
    console.log(`[LOG-MARKET-OVERVIEW] Results summary: ${marketDataResults.map(t => `${t.symbol}=${t.price}`).join(', ')}`);

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
   * @returns Array of matching tokens sorted by relevance
   */
  public async searchTokens(query: string, chainId: number): Promise<TokenSearchResult[]> {
    console.log(`🔍 Searching tokens for: "${query}" on chain ${chainId}`);

    const tokens = await this.cacheLayer.getTokensByNetworkCached(chainId);
    const lowerQuery = query.toLowerCase();

    const results: TokenSearchResult[] = tokens
      .map(token => {
        let relevanceScore = 0;

        if (token.symbol.toLowerCase() === lowerQuery) {
          relevanceScore = 1.0;
        } else if (token.symbol.toLowerCase().startsWith(lowerQuery)) {
          relevanceScore = 0.9;
        } else if (token.name.toLowerCase().includes(lowerQuery)) {
          relevanceScore = 0.6;
        } else if (token.address.toLowerCase().includes(lowerQuery)) {
          relevanceScore = 0.3;
        }

        return {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          chainId,
          decimals: token.decimals,
          logoURI: (token as any).logoURI,
          relevanceScore,
        };
      })
      .filter(t => t.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    console.log(`✓ Search found ${results.length} matching token(s)`);
    return results;
  }

  private setCacheEntry(key: string, data: TokenMarketData): void {
    this.cache.set(key, {
      data,
      expireAt: Date.now() + this.DEFAULT_CACHE_TTL,
    });
  }

  public clearCache(): void {
    this.cache.clear();
    console.log('🗑️ Market viewer cache cleared');
  }

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
