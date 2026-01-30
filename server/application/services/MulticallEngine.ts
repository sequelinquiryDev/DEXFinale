/**
 * PHASE 4: MulticallEngine - Weight-Aware Batch Execution
 * 
 * RESPONSIBILITY:
 * - Group pools into batches respecting weight limits
 * - Distribute batches round-robin across providers
 * - Execute multicall queries without exceeding provider limits
 * 
 * WEIGHT SYSTEM:
 * - V2 pools: weight 1 (light - single getReserves call)
 * - V3 pools: weight 2 (heavier - slot0 + liquidity calls)
 * - MAX_WEIGHT_PER_BATCH: 50 (prevents payload overruns)
 * 
 * ARCHITECTURE:
 * - Batching layer between scheduler and RPC
 * - Handles rate limiting implicitly via round-robin
 * - Provider distribution: batch N → provider (N % numProviders)
 */

import { StorageService } from './StorageService';
import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import { PoolRegistry, PoolMetadata } from '../../domain/types';
import type { AlivePool } from './PoolController';

const MAX_CALL_WEIGHT_PER_BATCH = 50; // Configurable safety limit

/**
 * Represents a batch of pools ready for multicall execution
 */
export interface MulticallBatch {
  pools: AlivePool[];
  totalWeight: number;
  targetProviderIndex: number; // Which provider to use (round-robin)
}

/**
 * Result from a single multicall query
 */
export interface MulticallResult {
  poolAddress: string;
  blockNumber: number;
  success: boolean;
  data?: any; // Pool state data (reserves, sqrtPrice, liquidity, etc.)
  error?: Error;
}

export class MulticallEngine {
  private providerCount: number = 1; // Will be set based on configured providers

  constructor(
    private storageService: StorageService,
    private ethersAdapter: EthersAdapter,
    providerCount: number = 1
  ) {
    this.providerCount = providerCount;
  }

  /**
   * PHASE 4: Create weight-aware batches from scheduled pools
   * 
   * Groups pools into batches such that:
   * 1. Each batch weight ≤ MAX_CALL_WEIGHT_PER_BATCH
   * 2. Batches are numbered sequentially
   * 3. Target provider = batchNumber % numProviders (round-robin)
   * 
   * @param pools Pools due for refresh
   * @param chainId Network chain ID
   * @param registry Pool registry containing weight information
   * @returns Array of batches ready for execution
   */
  public createBatches(
    pools: AlivePool[],
    chainId: number,
    registry: PoolRegistry
  ): MulticallBatch[] {
    const batches: MulticallBatch[] = [];

    let currentBatch: AlivePool[] = [];
    let currentWeight = 0;
    let batchNumber = 0;

    for (const pool of pools) {
      const poolMetadata = registry.pools[pool.address];
      const poolWeight = poolMetadata?.weight || 1;

      // Check if adding this pool would exceed limit
      if (currentWeight + poolWeight > MAX_CALL_WEIGHT_PER_BATCH && currentBatch.length > 0) {
        // Flush current batch
        batches.push({
          pools: currentBatch,
          totalWeight: currentWeight,
          targetProviderIndex: batchNumber % this.providerCount,
        });

        batchNumber++;
        currentBatch = [];
        currentWeight = 0;
      }

      // Add pool to current batch
      currentBatch.push(pool);
      currentWeight += poolWeight;
    }

    // Flush remaining batch
    if (currentBatch.length > 0) {
      batches.push({
        pools: currentBatch,
        totalWeight: currentWeight,
        targetProviderIndex: batchNumber % this.providerCount,
      });
    }

    return batches;
  }

  /**
   * PHASE 4: Execute all batches with round-robin provider distribution
   * 
   * Each batch is assigned a provider based on its batch number.
   * This distributes load without requiring explicit rate-limit coordination.
   * 
   * @param batches Batches to execute
   * @param chainId Network chain ID
   * @returns All results from all batches
   */
  public async executeBatches(
    batches: MulticallBatch[],
    chainId: number
  ): Promise<MulticallResult[]> {
    const allResults: MulticallResult[] = [];

    for (const batch of batches) {
      console.log(
        `⚙️ Executing batch (${batch.pools.length} pools, weight=${batch.totalWeight}) via provider #${batch.targetProviderIndex}`
      );

      try {
        const batchResults = await this.ethersAdapter.executeMulticall(
          batch.pools.map(p => p.address),
          batch.targetProviderIndex,
          chainId
        );

        allResults.push(...batchResults);
      } catch (error) {
        console.error(
          `❌ Batch execution failed for provider #${batch.targetProviderIndex}:`,
          error
        );

        // Failure isolation: create failed results for all pools in batch
        for (const pool of batch.pools) {
          allResults.push({
            poolAddress: pool.address,
            blockNumber: 0,
            success: false,
            error: error as Error,
          });
        }
      }
    }

    return allResults;
  }

  /**
   * DEBUG: Get batching statistics
   */
  public getBatchingStats(
    pools: AlivePool[],
    registry: PoolRegistry
  ) {
    const batches = this.createBatches(pools, 1, registry); // chainId=1 for stats only

    const totalPoolWeight = pools.reduce((sum, pool) => {
      const metadata = registry.pools[pool.address];
      return sum + (metadata?.weight || 1);
    }, 0);

    const maxBatchWeight = Math.max(...batches.map(b => b.totalWeight), 0);

    return {
      totalPools: pools.length,
      totalWeight: totalPoolWeight,
      numberOfBatches: batches.length,
      maxWeightPerBatch: MAX_CALL_WEIGHT_PER_BATCH,
      actualMaxBatchWeight: maxBatchWeight,
      averagePoolsPerBatch: Math.round(pools.length / batches.length || 0),
      providerDistribution: this.getProviderDistribution(batches),
    };
  }

  /**
   * DEBUG: Get provider assignment distribution
   */
  private getProviderDistribution(batches: MulticallBatch[]) {
    const distribution: Record<number, number> = {};

    for (let i = 0; i < this.providerCount; i++) {
      distribution[i] = 0;
    }

    for (const batch of batches) {
      distribution[batch.targetProviderIndex]++;
    }

    return distribution;
  }

  /**
   * Update provider count (for dynamic provider management)
   */
  public setProviderCount(count: number): void {
    this.providerCount = count;
    console.log(`Provider count updated to: ${count}`);
  }
}
