
import { spotPricingEngine } from './SpotPricingEngine';
import { poolController } from './PoolController';
import { sharedStateCache } from './SharedStateCache';

/**
 * PHASE 2: PriceViewerService - Pool-Centric Pricing
 * 
 * RESPONSIBILITY:
 * - Receive token price requests
 * - Route through PoolController for deduplication
 * - Call pricing engine with deduplicated pools
 * - Return prices to UI
 * 
 * BEFORE: Token-centric (1 token → 1 price call)
 * AFTER: Pool-centric (N tokens → M pool queries where M < N)
 * 
 * PHASE 6: Verify tick consistency to prevent mixed-epoch rendering
 */

class PriceViewerService {
  /**
   * PHASE 2: Get price snapshots for tokens
   * 
   * Refactored to use controller for deduplication:
   * 1. Tokens with attached pricingPools come from UI
   * 2. Controller maps tokens → pools and deduplicates
   * 3. Pricing engine computes prices from deduplicated pools
   * 4. Results mapped back to tokens for UI
   * 
   * PHASE 6: Verify all pools share same tickId before returning (prevents mixed-epoch rendering)
   * 
   * @param tokens Array of tokens with pricingPools metadata
   * @param chainId Network chain ID
   * @returns Record of token address → price, or null if tick consistency check fails
   */
  public getSnapshots(
    tokens: Array<{ address: string; pricingPools: Array<{ pool: string; base: string }> }>,
    chainId: number
  ): Record<string, number | null> {
    // PHASE 2: Register token interest with controller
    poolController.handleTokenInterest(tokens);

    // PHASE 6: Collect tickIds from all pools used by these tokens
    const tickIds = new Set<string>();
    for (const token of tokens) {
      for (const route of token.pricingPools) {
        const poolState = sharedStateCache.getPoolState(route.pool);
        if (poolState && poolState.tickId) {
          tickIds.add(poolState.tickId);
        }
      }
    }

    // PHASE 6: Verify tick consistency - all pools must belong to same refresh cycle
    if (tickIds.size > 1) {
      console.warn(
        `⚠️ PHASE 6: Mixed tick consistency detected (${tickIds.size} different ticks). ` +
        `Returning null to prevent mixed-epoch rendering. Next snapshot should be consistent.`
      );
      const nullPrices: Record<string, number | null> = {};
      for (const token of tokens) {
        nullPrices[token.address] = null;
      }
      return nullPrices;
    }

    // Compute prices for each token
    const prices: Record<string, number | null> = {};
    for (const token of tokens) {
      prices[token.address] = spotPricingEngine.computeSpotPrice(token.address, chainId);
    }

    return prices;
  }
}

export const priceViewerService = new PriceViewerService();
