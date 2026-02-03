
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
  public async getSnapshots(
    tokens: Array<{ address: string; pricingPools: Array<{ pool: string; base: string }> }>,
    chainId: number
  ): Promise<Record<string, number | null>> {
    // PHASE 2: Register token interest with controller
    const tokensWithPoolAddresses = tokens.map(token => ({
      address: token.address,
      pricingPools: token.pricingPools.map(route => route.pool)
    }));
    poolController.handleTokenInterest(tokensWithPoolAddresses, chainId);

    // PHASE 6: Collect tickIds from all pools used by these tokens
    const tickIds = new Set<string>();
    const tokensWithPools = tokens.map(token => {
        const pricingPools = tokensWithPoolAddresses.find(t => t.address === token.address)?.pricingPools || [];
        return { address: token.address, pricingPools };
    });

    for (const token of tokensWithPools) {
      for (const poolAddress of token.pricingPools) {
        const poolState = sharedStateCache.getPoolState(poolAddress);
        if (poolState && poolState.tickId) {
          tickIds.add(poolState.tickId);
        }
      }
    }

    // PHASE 6: Verify tick consistency - all pools must belong to same refresh cycle
    // If no pools have ticks yet, they haven't been fetched at least once.
    if (tickIds.size === 0) {
        console.log(`ℹ️ PHASE 6: No ticks discovered yet. Waiting for first multicall...`);
        const nullPrices: Record<string, number | null> = {};
        for (const token of tokens) {
          nullPrices[token.address] = null;
        }
        return nullPrices;
    }

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
      const price = await spotPricingEngine.computeSpotPrice(token.address, chainId);
      console.log(`💰 [PriceViewer] Price for ${token.address.slice(0, 6)}: ${price}`);
      prices[token.address] = price;
    }

    return prices;
  }
}

export const priceViewerService = new PriceViewerService();
