
import { sharedStateCache } from './SharedStateCache';
import { storageService } from './StorageService';
import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import { networkConfig } from '../../infrastructure/config/NetworkConfig';

class SpotPricingEngine {
  private tokenDecimals: Map<string, number> = new Map();
  private usdStablecoins: Set<string> = new Set();

  constructor(private ethersAdapter: EthersAdapter) {}

  public async initialize(): Promise<void> {
    console.log("[SPOT-PRICING] Initializing spot pricing engine...");
    const chainIds = networkConfig.getSupportedChainIds();

    for (const chainId of chainIds) {
        const tokens = await storageService.getTokensByNetwork(chainId);
        const stablecoins = networkConfig.getStablecoins(chainId);

        for (const token of tokens) {
            this.tokenDecimals.set(token.address.toLowerCase(), token.decimals);
        }

        for (const stable of stablecoins) {
            this.usdStablecoins.add(stable.address.toLowerCase());
        }
    }
    console.log(`[SPOT-PRICING] Initialization complete. Loaded token data for ${chainIds.length} chains.`);
  }

  /**
   * Build a symbol-to-address map for a given chain
   */
  private async buildSymbolMap(chainId: number): Promise<Map<string, string>> {
    const tokens = await storageService.getTokensByNetwork(chainId);
    const map = new Map<string, string>();
    for (const token of tokens) {
      map.set(token.symbol?.toUpperCase() || '', token.address.toLowerCase());
    }
    return map;
  }

  /**
   * Get pool state - from cache if available, otherwise fetch directly from contract
   */
  private async getPoolState(poolAddress: string, chainId: number) {
    // ONLY check cache. Do not fall back to a direct RPC query.
    // The PoolScheduler is responsible for populating this cache.
    const cached = sharedStateCache.getPoolState(poolAddress.toLowerCase());
    if (cached) {
      return cached;
    }

    // If it's not in the cache, we return null and wait for the scheduler to run.
    console.log(`[SPOT-PRICING] Pool state for ${poolAddress} not in cache. Awaiting scheduler.`);
    return null;
  }

  /**
   * Get token decimals from cache or hardcoded lookup
   */
  private getDecimals(tokenAddress: string): number {
    const normalized = tokenAddress.toLowerCase();
    // Check local cache first
    if (this.tokenDecimals.has(normalized)) {
      return this.tokenDecimals.get(normalized)!;
    }
    // Try to get from shared cache as a fallback
    const metadata = sharedStateCache.getTokenMetadata(tokenAddress);
    return metadata?.decimals ?? 18;
  }

  /**
   * Check if token is a USD stablecoin
   */
  private isUsdStablecoin(tokenAddress: string): boolean {
    return this.usdStablecoins.has(tokenAddress.toLowerCase());
  }

  /**
   * Calculates the spot price of a token in USD.
   * Uses pre-indexed pricing routes from pool registry (cold path output).
   * Fetches pool states from cache (hot path).
   * 
   * pricingRoutes structure: [tokenAddress][baseSymbol] = poolAddresses[]
   * Routes are indexed by base token SYMBOL for efficient lookup and readability.
   * 
   * @param tokenAddress The address of the token to price.
   * @param chainId The chain ID of the token.
   * @param pricingStack The stack of tokens being priced, to prevent circular dependencies.
   * @returns The spot price in USD, or null if it cannot be calculated.
   */
  public async computeSpotPrice(tokenAddress: string, chainId: number, pricingStack: string[] = []): Promise<number | null> {
    const normalizedToken = tokenAddress.toLowerCase();
    const tokenShort = tokenAddress.slice(0, 6);

    // Prevent circular dependencies
    if (pricingStack.includes(normalizedToken)) {
      console.warn(`[PRICING] Circular dependency detected, aborting: ${pricingStack.join(' -> ')} -> ${normalizedToken}`);
      return null;
    }

    // Get pricing routes from pool registry
    const poolRegistry = await storageService.getPoolRegistry(chainId);
    const tokenRoutes = poolRegistry.pricingRoutes[normalizedToken];

    if (!tokenRoutes || Object.keys(tokenRoutes).length === 0) {
      // If it's a stablecoin and has no other routes, we can confidently return 1.0 as a fallback
      if (this.isUsdStablecoin(normalizedToken)) {
          return 1.0;
      }
      console.log(`❌ [PRICING] ${tokenShort}... on chain ${chainId} → NO ROUTES (not discovered)`);
      console.log(`[LOG-PRICING-RESULT] ${tokenShort}... RETURNING: null (no routes)`);
      return null;
    }
    
    const totalPools = Object.values(tokenRoutes).reduce((sum, pools) => sum + pools.length, 0);
    console.log(`ℹ️ [PRICING] ${tokenShort}... has ${Object.keys(tokenRoutes).length} base token(s), ${totalPools} pool(s)`);

    // Build symbol-to-address map for resolving base token symbols
    const symbolMap = await this.buildSymbolMap(chainId);

    // Strategy 1: Find a direct route to a USD stablecoin with available pool
    let bestPoolAddress: string | null = null;
    let bestBaseSymbol: string | null = null;
    let bestBaseAddress: string | null = null;

    console.log(`🔍 [PRICING] ${tokenShort}... checking strategy 1 (stablecoin base)`);
    // First, try to find a stablecoin base with a cached pool
    for (const baseSymbol in tokenRoutes) {
      const baseAddress = symbolMap.get(baseSymbol);
      if (!baseAddress) continue;
      if (!this.isUsdStablecoin(baseAddress)) continue;

      // This base is a USD stablecoin, try to fetch pool state
      const poolAddresses = tokenRoutes[baseSymbol];
      for (const poolAddr of poolAddresses) {
        // ALWAYS use lowercase for cache keys
        const pState = sharedStateCache.getPoolState(poolAddr.toLowerCase());
        if (pState) {
          bestPoolAddress = poolAddr.toLowerCase();
          bestBaseSymbol = baseSymbol;
          bestBaseAddress = baseAddress;
          console.log(`✓ [PRICING] ${tokenShort}... found CACHED ${baseSymbol} route (pool: ${poolAddr.slice(0, 6)}...)`);
          break;
        } else {
          console.log(`ℹ️ [PRICING] ${tokenShort}... pool ${poolAddr.slice(0, 6)} not in cache yet`);
        }
      }
      if (bestPoolAddress) break;
    }

    // Strategy 2: If no stablecoin route available, try WETH
    if (!bestPoolAddress) {
      console.log(`🔍 [PRICING] ${tokenShort}... checking strategy 2 (WETH base)`);
      const wethSymbol = networkConfig.getWrappedNative(chainId).symbol;
      if (tokenRoutes[wethSymbol]) {
        const poolAddresses = tokenRoutes[wethSymbol];
        for (const poolAddr of poolAddresses) {
          const pState = sharedStateCache.getPoolState(poolAddr.toLowerCase());
          if (pState) {
            bestPoolAddress = poolAddr.toLowerCase();
            bestBaseSymbol = wethSymbol;
            bestBaseAddress = symbolMap.get(wethSymbol) || null;
            console.log(`⚠️ [PRICING] ${tokenShort}... using WETH route (pool: ${poolAddr.slice(0, 6)}..., will recurse)`);
            break;
          } else {
            console.log(`ℹ️ [PRICING] ${tokenShort}... WETH pool ${poolAddr.slice(0, 6)} not in cache yet`);
          }
        }
      }
    }

    // Strategy 3: Try any route with an available pool
    if (!bestPoolAddress) {
      console.log(`🔍 [PRICING] ${tokenShort}... checking strategy 3 (any base)`);
      for (const baseSymbol in tokenRoutes) {
        const baseAddress = symbolMap.get(baseSymbol);
        if (!baseAddress) continue;

        const poolAddresses = tokenRoutes[baseSymbol];
        for (const poolAddr of poolAddresses) {
          const pState = sharedStateCache.getPoolState(poolAddr.toLowerCase());
          if (pState) {
            bestPoolAddress = poolAddr.toLowerCase();
            bestBaseSymbol = baseSymbol;
            bestBaseAddress = baseAddress;
            console.log(`⚠️ [PRICING] ${tokenShort}... using ${baseSymbol} route (will recurse)`);
            break;
          }
        }
        if (bestPoolAddress) break;
      }
    }

    if (!bestPoolAddress || !bestBaseAddress) {
      const availableCount = Object.values(tokenRoutes).filter(pools => 
        pools.some(async p => {
          const state = await this.getPoolState(p, chainId);
          return state !== null;
        })
      ).length;
      console.log(`❌ [PRICING] ${tokenShort}... → NO AVAILABLE POOLS (${availableCount}/${Object.keys(tokenRoutes).length} base tokens have accessible pools)`);
      return null;
    }

    // Get pool state (from cache or fresh)
    const poolState = await this.getPoolState(bestPoolAddress, chainId);
    if (!poolState) {
      return null;
    }

    // Calculate price from sqrtPriceX96
    const sqrtPrice = Number(poolState.sqrtPriceX96) / (2 ** 96);
    let rawPrice = sqrtPrice * sqrtPrice;

    // Determine if our token is token0 or token1
    const isToken0 = poolState.token0.toLowerCase() === normalizedToken;
    
    // Get decimals for adjustment
    const token0Decimals = this.getDecimals(poolState.token0);
    const token1Decimals = this.getDecimals(poolState.token1);

    // Adjust for decimals
    const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
    rawPrice = rawPrice * decimalAdjustment;

    // Calculate price: base/ourToken = token1/token0 if our token is token0
    let priceInBaseToken = isToken0 ? rawPrice : (rawPrice > 0 ? 1 / rawPrice : 0);

    // If the base token is a USD stablecoin, this is the USD price
    if (this.isUsdStablecoin(bestBaseAddress)) {
      console.log(`✓ [PRICING] ${tokenShort}... → $${priceInBaseToken.toFixed(6)} (stablecoin base)`);
      return priceInBaseToken;
    }

    // Otherwise, recursively get the USD price of the base token
    console.log(`⚠️ [PRICING] ${tokenShort}... recursing for base token ${bestBaseSymbol} (${bestBaseAddress.slice(0, 6)}...)`);
    const baseUsdPrice = await this.computeSpotPrice(bestBaseAddress, chainId, [...pricingStack, normalizedToken]);
    if (baseUsdPrice === null) {
      console.log(`❌ [PRICING] ${tokenShort}... → RECURSIVE BASE PRICE FAILED`);
      return null;
    }

    const finalPrice = priceInBaseToken * baseUsdPrice;
    console.log(`✓ [PRICING] ${tokenShort}... → $${finalPrice.toFixed(6)} (multi-hop)`);
    return finalPrice;
  }
}

let spotPricingEngineInstance: SpotPricingEngine | null = null;

export async function initSpotPricingEngine(ethersAdapter: EthersAdapter): Promise<SpotPricingEngine> {
  if (!spotPricingEngineInstance) {
    spotPricingEngineInstance = new SpotPricingEngine(ethersAdapter);
    await spotPricingEngineInstance.initialize();
  }
  return spotPricingEngineInstance;
}

export const spotPricingEngine = {
  computeSpotPrice(tokenAddress: string, chainId: number) {
    if (!spotPricingEngineInstance) {
      throw new Error('SpotPricingEngine not initialized. Call initSpotPricingEngine first.');
    }
    // Initialize the pricing stack for the top-level call
    return spotPricingEngineInstance.computeSpotPrice(tokenAddress, chainId, []);
  }
};
