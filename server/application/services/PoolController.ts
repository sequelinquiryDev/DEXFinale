import { CacheLayer } from './CacheLayer';
import { PoolRegistry } from '../../domain/types';
import { StorageService } from './StorageService'; // Import StorageService

/**
 * Per-pool liveness and scheduling metadata
 */
export interface AlivePool {
  address: string;
  chainId: number; // chain ID for this pool
  dexVersion: 'v2' | 'v3' | 'v4'; // The DEX version for this pool
  tier: "high" | "normal" | "low";
  nextRefresh: number; // timestamp when next refresh is due
  lastBlockSeen: number; // last block number from multicall results
  lastPrice: number; // last computed price
  requestCount: number; // total requests for this pool
  lastRequestTime: number; // timestamp of most recent request
  refCount: number; // number of active users requesting this pool
}

export class PoolController {
  private aliveSet: Map<string, AlivePool> = new Map();

  constructor(private cacheLayer: CacheLayer) {}

  /**
   * Handles token interest requests, now using the CacheLayer.
   *
   * @param tokens Array of tokens with attached pricingPools pool addresses
   * @param chainId Chain ID for the pools
   */
  public async handleTokenInterest(
    tokens: Array<{ 
      address: string;
      pricingPools: string[] // Pool addresses
    }>,
    chainId: number = 1
  ): Promise<void> {
    // Read the registry from the cache, which falls back to storage if needed.
    const registry: PoolRegistry = await this.cacheLayer.getPoolRegistryCached(chainId);

    for (const token of tokens) {
      for (const poolAddress of token.pricingPools) {
        const poolKey = `${chainId}:${poolAddress}`;

        if (this.aliveSet.has(poolKey)) {
          const pool = this.aliveSet.get(poolKey)!;
          pool.refCount++;
          pool.lastRequestTime = Date.now();
          pool.requestCount++;
        } else {
          const poolInfo = registry.pools[poolAddress];
          if (!poolInfo) {
            console.warn(`[WARN] Pool ${poolAddress} not found in registry for chain ${chainId}. Skipping.`);
            continue;
          }

          this.aliveSet.set(poolKey, {
            address: poolAddress,
            chainId: chainId,
            dexVersion: poolInfo.dexType as 'v2' | 'v3', // Corrected property
            tier: "normal",
            nextRefresh: Date.now() + 10000, // 10 seconds
            lastBlockSeen: 0,
            lastPrice: 0,
            requestCount: 1,
            lastRequestTime: Date.now(),
            refCount: 1, // First user
          });
        }
      }
    }
  }

  // ... rest of the file is unchanged ...

  public incrementRefCount(poolAddress: string, chainId: number): void {
    const poolKey = `${chainId}:${poolAddress}`;
    const pool = this.aliveSet.get(poolKey);
    if (pool) {
      pool.refCount++;
      console.log(`📈 [POOL] refCount++ for ${poolAddress.slice(0, 6)}... (now ${pool.refCount})`);
    }
  }

  public decrementRefCount(poolAddress: string, chainId: number): void {
    const poolKey = `${chainId}:${poolAddress}`;
    const pool = this.aliveSet.get(poolKey);
    if (pool) {
      pool.refCount = Math.max(0, pool.refCount - 1);
      console.log(`📉 [POOL] refCount-- for ${poolAddress.slice(0, 6)}... (now ${pool.refCount})`);
    }
  }

  public resetPoolRefCount(poolAddress: string, chainId: number): void {
    const poolKey = `${chainId}:${poolAddress}`;
    const pool = this.aliveSet.get(poolKey);
    if (pool) {
      pool.refCount = 0;
    }
  }

  public getPoolsForRefresh(): AlivePool[] {
    const now = Date.now();
    return Array.from(this.aliveSet.values())
      .filter(pool => pool.nextRefresh <= now);
  }

  public getAliveSet(): AlivePool[] {
    return Array.from(this.aliveSet.values());
  }

  public getAlivePoolCount(): number {
    return this.aliveSet.size;
  }

  public updatePoolTier(poolAddress: string, currentPrice: number): void {
    const pool = this.aliveSet.get(poolAddress);
    if (!pool) return;

    const priceDelta = pool.lastPrice > 0
      ? Math.abs(currentPrice - pool.lastPrice) / pool.lastPrice
      : 0;

    if (priceDelta > 0.05) {
      pool.tier = "high";
      pool.nextRefresh = Date.now() + 5000;
    } else if (priceDelta > 0.001) {
      pool.tier = "normal";
      pool.nextRefresh = Date.now() + 10000;
    } else {
      pool.tier = "low";
      pool.nextRefresh = Date.now() + 30000;
    }

    pool.lastPrice = currentPrice;
  }

  public setBlockSeen(poolAddress: string, blockNumber: number): void {
    const pool = this.aliveSet.get(poolAddress);
    if (pool) {
      pool.lastBlockSeen = blockNumber;
    }
  }

  public removePool(poolAddress: string, chainId: number): void {
    const poolKey = `${chainId}:${poolAddress}`;
    const removed = this.aliveSet.delete(poolKey);
    if (removed) {
      console.log(`🗑️ [POOL] Removed ${poolAddress.slice(0, 6)}... from alive set`);
    }
  }

  public pruneStalePools(ttlMs: number = 30000): void {
    const now = Date.now();
    const staleEntries: string[] = [];

    this.aliveSet.forEach((pool, address) => {
      if (now - pool.lastRequestTime > ttlMs) {
        staleEntries.push(address);
      }
    });

    staleEntries.forEach(address => this.aliveSet.delete(address));

    if (staleEntries.length > 0) {
      console.log(
        `🗑️ Pruned ${staleEntries.length} stale pools from alive set (TTL: ${ttlMs}ms)`
      );
    }
  }

  public clearAliveSet(): void {
    this.aliveSet.clear();
    console.log('🗑️ Cleared pool alive set');
  }

  public getStats() {
    const pools = Array.from(this.aliveSet.values());
    const byTier = {
      high: pools.filter(p => p.tier === 'high').length,
      normal: pools.filter(p => p.tier === 'normal').length,
      low: pools.filter(p => p.tier === 'low').length,
    };

    return {
      totalPools: pools.length,
      byTier,
      poolsAveRequestCount: pools.length > 0
        ? pools.reduce((sum, p) => sum + p.requestCount, 0) / pools.length
        : 0,
    };
  }
}

// Create a singleton instance of StorageService
const storageService = new StorageService();
// Create a singleton instance of CacheLayer, injecting StorageService
const cacheLayer = new CacheLayer(storageService);

// Export singleton instance, now with injected service
export const poolController = new PoolController(cacheLayer);
