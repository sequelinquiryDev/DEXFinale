/**
 * PHASE 3: PoolScheduler - Tiered Pool Refresh Scheduling
 * 
 * RESPONSIBILITY:
 * - Continuously check PoolController for pools due refresh
 * - Execute multicall queries for scheduled pools
 * - Update pool tiers based on price volatility
 * - Reschedule next refresh based on tier
 * 
 * ARCHITECTURE:
 * - Main loop checks every 1 second (not 10s global interval)
 * - Each pool has independent refresh cadence
 * - Volatility-based tier transitions (5s / 10s / 30s)
 * - Self-adjusting (no external configuration needed)
 * 
 * PHASE 4: Integration with MulticallEngine
 * - Scheduler gets pools due refresh
 * - Passes to MulticallEngine for batching
 * - MulticallEngine handles weight-aware chunking
 * - Results processed for tier updates and caching
 */

import { poolController, AlivePool } from './PoolController';
import { sharedStateCache } from './SharedStateCache';
import { MulticallEngine } from './MulticallEngine';
import { StorageService } from './StorageService';
import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import { timingConfig } from '../../infrastructure/config/TimingConfig';
import { PoolState } from '../../domain/types';

export class PoolScheduler {
  private isRunning = false;
  private executionLoopIntervalId: NodeJS.Timeout | null = null;
  private multicallEngine: MulticallEngine;

  // Promise for first run completion
  private firstRunPromise: Promise<void> | null = null;
  private resolveFirstRun: (() => void) | null = null;

  // PHASE 5: Micro-batching collection window
  private collectionWindow = timingConfig.MICROBATCH_COLLECTION_WINDOW_MS;
  private pendingPoolsForBatch: Set<string> = new Set(); // poolKey deduplication
  private batchFlushTimer: NodeJS.Timeout | null = null;
  private lastBatchExecutionTime = 0;

  constructor(
    private storageService: StorageService,
    private ethersAdapter: EthersAdapter
  ) {
    this.multicallEngine = new MulticallEngine(this.ethersAdapter);
    
    this.firstRunPromise = new Promise((resolve) => {
      this.resolveFirstRun = resolve;
    });
  }

  /**
   * PHASE 3: Start the scheduler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Pool scheduler already running');
      return;
    }

    console.log('🚀 Starting pool scheduler (tiered scheduling enabled)');
    this.isRunning = true;

    const scheduleNextExecution = () => {
      if (!this.isRunning) return;
      
      const alivePoolsSet = poolController.getAliveSet();
      if (alivePoolsSet.length === 0) {
        this.executionLoopIntervalId = setTimeout(scheduleNextExecution, 1000);
        return;
      }
      
      const nextRefreshTime = Math.min(...alivePoolsSet.map(p => p.nextRefresh));
      const timeUntilNextRefresh = Math.max(0, nextRefreshTime - Date.now());
      const delayMs = Math.min(timeUntilNextRefresh, 1000);
      
      this.executionLoopIntervalId = setTimeout(() => {
        this.executionLoop().catch(error => {
          console.error('❌ Error in scheduler execution loop:', error);
        }).finally(() => {
          scheduleNextExecution();
        });
      }, delayMs);
    };
    
    scheduleNextExecution();
  }

  /**
   * Wait for the first batch of pools to be executed.
   */
  public async waitForFirstRun(): Promise<void> {
    if (this.lastBatchExecutionTime > 0) return;
    if (this.firstRunPromise) await this.firstRunPromise;
  }

  /**
   * Main execution loop
   */
  private async executionLoop(): Promise<void> {
    const poolsDue = poolController.getPoolsForRefresh();
    if (poolsDue.length === 0) return;

    let newPoolsAdded = 0;
    for (const pool of poolsDue) {
      const poolKey = `${pool.chainId}:${pool.address}`;
      if (!this.pendingPoolsForBatch.has(poolKey)) {
        this.pendingPoolsForBatch.add(poolKey);
        newPoolsAdded++;
      }
    }

    if (newPoolsAdded === 0) return;

    if (!this.batchFlushTimer) {
      this.scheduleBatchFlush();
    }

    if (this.pendingPoolsForBatch.size >= 10) {
      await this.flushBatch();
    }
  }

  /**
   * Schedule batch flush after collection window
   */
  private scheduleBatchFlush(): void {
    if (this.batchFlushTimer) clearTimeout(this.batchFlushTimer);

    this.batchFlushTimer = setTimeout(async () => {
      await this.flushBatch();
      this.batchFlushTimer = null;
    }, this.collectionWindow);
  }

  /**
   * Execute pending batch and clear
   */
  private async flushBatch(): Promise<void> {
    if (this.resolveFirstRun) {
      this.resolveFirstRun();
      this.resolveFirstRun = null;
    }

    if (this.batchFlushTimer) {
      clearTimeout(this.batchFlushTimer);
      this.batchFlushTimer = null;
    }

    if (this.pendingPoolsForBatch.size === 0) return;

    const aliveSet = poolController.getAliveSet();
    const poolsToExecute: AlivePool[] = [];
    for (const poolKey of this.pendingPoolsForBatch) {
      const pool = aliveSet.find(p => `${p.chainId}:${p.address}` === poolKey);
      if (pool) poolsToExecute.push(pool);
    }

    this.pendingPoolsForBatch.clear();
    if (poolsToExecute.length === 0) return;

    const poolsByChain = new Map<number, AlivePool[]>();
    for (const pool of poolsToExecute) {
      const chainId = pool.chainId || 1;
      if (!poolsByChain.has(chainId)) {
        poolsByChain.set(chainId, []);
      }
      poolsByChain.get(chainId)!.push(pool);
    }

    const startTime = Date.now();
    for (const [chainId, chainPools] of poolsByChain) {
      await this.executeForChain(chainId, chainPools);
    }
    this.lastBatchExecutionTime = Date.now() - startTime;
  }

  /**
   * Execute multicall for a specific chain's pools
   */
  private async executeForChain(chainId: number, poolsDue: AlivePool[]): Promise<void> {
    if (poolsDue.length === 0) return;

    const tickId = `tick_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const poolRegistry = await this.storageService.getPoolRegistry(chainId);
    
    const batches = this.multicallEngine.createBatches(poolsDue);

    try {
      const multicallResults = await this.multicallEngine.executeBatches(batches, chainId);

      for (const result of multicallResults) {
        const pool = poolsDue.find(p => p.address.toLowerCase() === result.poolAddress.toLowerCase());
        const registryPoolInfo = poolRegistry.pools[result.poolAddress.toLowerCase()];

        if (!pool || !registryPoolInfo) continue;
        
        if (!result.success || !result.data) {
          poolController.resetPoolRefCount(pool.address, pool.chainId);
          continue;
        }

        if (result.blockNumber === pool.lastBlockSeen && result.blockNumber !== 0) {
          poolController.resetPoolRefCount(pool.address, pool.chainId);
          continue;
        }

        let price: number = 0;
        let poolStateForCache: Omit<PoolState, 'address'>;

        if (pool.dexVersion === 'v2') {
          const reserve0 = BigInt(result.data.reserve0.toString());
          const reserve1 = BigInt(result.data.reserve1.toString());
          poolStateForCache = {
            token0: registryPoolInfo.token0.toLowerCase(),
            token1: registryPoolInfo.token1.toLowerCase(),
            reserve0, 
            reserve1, 
            tickId, 
            blockNumber: result.blockNumber, 
            timestamp: Date.now(),
          };
          if (reserve0 > 0) {
            price = Number(reserve1 * BigInt(1e18) / reserve0) / 1e18;
          }
        } else { // v3, v4
          const sqrtPriceX96 = BigInt(result.data.sqrtPriceX96.toString());
          poolStateForCache = {
            token0: registryPoolInfo.token0.toLowerCase(),
            token1: registryPoolInfo.token1.toLowerCase(),
            sqrtPriceX96, 
            liquidity: BigInt(result.data.liquidity.toString()),
            tickId, 
            blockNumber: result.blockNumber, 
            timestamp: Date.now(),
          };
          const priceRatio = Number(sqrtPriceX96) / (2 ** 96);
          price = priceRatio * priceRatio;
        }
        
        sharedStateCache.setPoolState(result.poolAddress.toLowerCase(), poolStateForCache as PoolState);

        poolController.updatePoolTier(pool.address, price);
        pool.lastBlockSeen = result.blockNumber;
        pool.lastPrice = price;

        poolController.resetPoolRefCount(pool.address, pool.chainId);
      }
    } catch (error) {
      console.error('❌ Multicall batch execution failed:', error);
      for (const pool of poolsDue) {
        pool.nextRefresh = Date.now() + 5000;
      }
    }
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.batchFlushTimer) {
      clearTimeout(this.batchFlushTimer);
      this.batchFlushTimer = null;
    }

    if (this.pendingPoolsForBatch.size > 0) {
      await this.flushBatch();
    }

    if (this.executionLoopIntervalId) {
      clearInterval(this.executionLoopIntervalId);
      this.executionLoopIntervalId = null;
    }

    this.isRunning = false;
    console.log('🛑 Pool scheduler stopped');
  }

  /**
   * Get scheduler status
   */
  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * DEBUG: Get scheduling statistics
   */
  public getSchedulingStats() {
    const aliveSet = poolController.getAliveSet();
    const byTier = {
      high: aliveSet.filter(p => p.tier === 'high').length,
      normal: aliveSet.filter(p => p.tier === 'normal').length,
      low: aliveSet.filter(p => p.tier === 'low').length,
    };

    const now = Date.now();
    const nextRefreshes = aliveSet.map(p => p.nextRefresh - now);
    const avgMsUntilRefresh = nextRefreshes.length > 0 ? nextRefreshes.reduce((a, b) => a + b, 0) / nextRefreshes.length : 0;

    return {
      isRunning: this.isRunning,
      totalTrackedPools: aliveSet.length,
      poolsByTier: byTier,
      averageMsUntilNextRefresh: Math.round(avgMsUntilRefresh),
      tierDistribution: {
        high_5s: byTier.high,
        normal_10s: byTier.normal,
        low_30s: byTier.low,
      },
      microBatching: {
        pendingPoolsInBatch: this.pendingPoolsForBatch.size,
        collectionWindowMs: this.collectionWindow,
        lastBatchExecutionMs: this.lastBatchExecutionTime,
        batchFlushScheduled: this.batchFlushTimer !== null,
      },
    };
  }
}
