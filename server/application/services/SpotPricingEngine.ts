
import { sharedStateCache } from './SharedStateCache';
import { storageService } from './StorageService';

// Known USD stablecoins for price anchoring
const USD_STABLECOINS: Record<number, Set<string>> = {
  1: new Set([
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
    '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  ]),
  137: new Set([
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', // USDT
    '0x8f3cf7ad23cd3cadbd9735aff958023d60d76ee6', // DAI
  ]),
};

// Token decimals lookup
const TOKEN_DECIMALS: Record<string, number> = {
  // Ethereum
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,  // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,  // USDT
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18, // WETH
  '0x2260fac5e5542a773aa44fbcfedd86a9abde89b6': 8,  // WBTC
  // Polygon
  '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 6,  // USDC
  '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 6,  // USDT
  '0x8f3cf7ad23cd3cadbd9735aff958023d60d76ee6': 18, // DAI
  '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': 18, // WETH
  '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 18, // WMATIC
};

class SpotPricingEngine {
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
   * Get token decimals from cache or hardcoded lookup
   */
  private getDecimals(tokenAddress: string): number {
    const normalized = tokenAddress.toLowerCase();
    // Check hardcoded lookup first
    if (TOKEN_DECIMALS[normalized] !== undefined) {
      return TOKEN_DECIMALS[normalized];
    }
    // Try to get from cache
    const metadata = sharedStateCache.getTokenMetadata(tokenAddress);
    return metadata?.decimals ?? 18;
  }

  /**
   * Check if token is a USD stablecoin
   */
  private isUsdStablecoin(tokenAddress: string, chainId: number): boolean {
    return USD_STABLECOINS[chainId]?.has(tokenAddress.toLowerCase()) ?? false;
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
   * @returns The spot price in USD, or null if it cannot be calculated.
   */
  public async computeSpotPrice(tokenAddress: string, chainId: number): Promise<number | null> {
    const normalizedToken = tokenAddress.toLowerCase();
    const tokenShort = tokenAddress.slice(0, 6);

    // If it's a stablecoin, return $1
    if (this.isUsdStablecoin(normalizedToken, chainId)) {
      console.log(`✓ [PRICING] ${tokenShort}... is USD stablecoin → $1.00`);
      return 1.0;
    }

    // Get pricing routes from pool registry
    const poolRegistry = await storageService.getPoolRegistry(chainId);
    const tokenRoutes = poolRegistry.pricingRoutes[normalizedToken];

    if (!tokenRoutes || Object.keys(tokenRoutes).length === 0) {
      console.log(`❌ [PRICING] ${tokenShort}... on chain ${chainId} → NO ROUTES (not discovered)`);
      return null;
    }
    
    const totalPools = Object.values(tokenRoutes).reduce((sum, pools) => sum + pools.length, 0);
    console.log(`ℹ️ [PRICING] ${tokenShort}... has ${Object.keys(tokenRoutes).length} base token(s), ${totalPools} pool(s)`);

    // Build symbol-to-address map for resolving base token symbols
    const symbolMap = await this.buildSymbolMap(chainId);

    // Strategy 1: Find a direct route to a USD stablecoin with cached pool
    let bestPoolAddress: string | null = null;
    let bestBaseSymbol: string | null = null;
    let bestBaseAddress: string | null = null;

    console.log(`🔍 [PRICING] ${tokenShort}... checking strategy 1 (stablecoin base)`);
    // First, try to find a stablecoin base with a cached pool
    for (const baseSymbol in tokenRoutes) {
      const baseAddress = symbolMap.get(baseSymbol);
      if (!baseAddress) continue;
      if (!this.isUsdStablecoin(baseAddress, chainId)) continue;

      // This base is a USD stablecoin, check if any pool is cached
      const poolAddresses = tokenRoutes[baseSymbol];
      for (const poolAddr of poolAddresses) {
        const pState = sharedStateCache.getPoolState(poolAddr);
        if (pState) {
          bestPoolAddress = poolAddr;
          bestBaseSymbol = baseSymbol;
          bestBaseAddress = baseAddress;
          console.log(`✓ [PRICING] ${tokenShort}... found CACHED ${baseSymbol} route (pool: ${poolAddr.slice(0, 6)}...)`);
          break;
        }
      }
      if (bestPoolAddress) break;
    }

    // Strategy 2: If no stablecoin route with cache, try WETH
    if (!bestPoolAddress) {
      console.log(`🔍 [PRICING] ${tokenShort}... checking strategy 2 (WETH base)`);
      const wethSymbol = 'WETH';
      if (tokenRoutes[wethSymbol]) {
        const poolAddresses = tokenRoutes[wethSymbol];
        for (const poolAddr of poolAddresses) {
          const pState = sharedStateCache.getPoolState(poolAddr);
          if (pState) {
            bestPoolAddress = poolAddr;
            bestBaseSymbol = wethSymbol;
            bestBaseAddress = symbolMap.get(wethSymbol) || null;
            console.log(`⚠️ [PRICING] ${tokenShort}... using WETH route (pool: ${poolAddr.slice(0, 6)}..., will recurse)`);
            break;
          }
        }
      }
    }

    // Strategy 3: Try any route with a cached pool
    if (!bestPoolAddress) {
      console.log(`🔍 [PRICING] ${tokenShort}... checking strategy 3 (any base)`);
      for (const baseSymbol in tokenRoutes) {
        const baseAddress = symbolMap.get(baseSymbol);
        if (!baseAddress) continue;

        const poolAddresses = tokenRoutes[baseSymbol];
        for (const poolAddr of poolAddresses) {
          const pState = sharedStateCache.getPoolState(poolAddr);
          if (pState) {
            bestPoolAddress = poolAddr;
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
      const cachedCount = Object.values(tokenRoutes).filter(pools => 
        pools.some(p => sharedStateCache.getPoolState(p))
      ).length;
      console.log(`❌ [PRICING] ${tokenShort}... → NO CACHED POOLS (${cachedCount}/${Object.keys(tokenRoutes).length} base tokens have cached pools)`);
      return null;
    }

    // Get pool state from cache
    const poolState = sharedStateCache.getPoolState(bestPoolAddress);
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
    if (this.isUsdStablecoin(bestBaseAddress, chainId)) {
      console.log(`✓ [PRICING] ${tokenShort}... → $${priceInBaseToken.toFixed(6)} (stablecoin base)`);
      return priceInBaseToken;
    }

    // Otherwise, recursively get the USD price of the base token
    console.log(`⚠️ [PRICING] ${tokenShort}... recursing for base token ${bestBaseSymbol} (${bestBaseAddress.slice(0, 6)}...)`);
    const baseUsdPrice = await this.computeSpotPrice(bestBaseAddress, chainId);
    if (baseUsdPrice === null) {
      console.log(`❌ [PRICING] ${tokenShort}... → RECURSIVE BASE PRICE FAILED`);
      return null;
    }

    const finalPrice = priceInBaseToken * baseUsdPrice;
    console.log(`✓ [PRICING] ${tokenShort}... → $${finalPrice.toFixed(6)} (multi-hop)`);
    return finalPrice;
  }
}

export const spotPricingEngine = new SpotPricingEngine();
