
import { sharedStateCache } from './SharedStateCache';
import { storageService } from './StorageService';

class SpotPricingEngine {
  /**
   * Calculates the spot price of a token in USD.
   * Uses pre-indexed pricing routes from pool registry (cold path output).
   * Fetches pool states from cache (hot path).
   * 
   * @param tokenAddress The address of the token to price.
   * @param chainId The chain ID of the token.
   * @returns The spot price in USD, or null if it cannot be calculated.
   */
  public async computeSpotPrice(tokenAddress: string, chainId: number): Promise<number | null> {
    // Get pricing route from pool registry (pre-indexed by cold path)
    const poolRegistry = await storageService.getPoolRegistry(chainId);
    const routes = poolRegistry.pricingRoutes[tokenAddress.toLowerCase()];

    if (!routes || routes.length === 0) {
      return null; // No pricing route for this token
    }

    // Use first available route
    const route = routes[0];
    const poolAddress = route.pool;

    // Get pool state from cache (populated by hot path via discovery/multicall)
    const poolState = sharedStateCache.getPoolState(poolAddress);
    if (!poolState) {
      // Pool state not yet available - return null (insufficient data)
      // PoolScheduler will populate this cache once multicall executes
      return null;
    }

    // Get token metadata
    const tokenMetadata = sharedStateCache.getTokenMetadata(tokenAddress);
    if (!tokenMetadata) {
      return null;
    }

    // For now, compute price assuming the route is directly to USD base
    // In future, could handle multi-hop routes
    // Price = sqrtPriceX96^2 / 2^192, adjusted for decimals
    const price = (Number(poolState.sqrtPriceX96) / 2**96)**2;
    return price;
  }
}

export const spotPricingEngine = new SpotPricingEngine();
