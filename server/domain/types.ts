
/**
 * Represents the static, non-changing metadata for a token.
 */
export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  logoFetchedAt?: number; // Timestamp when logo was fetched (for cleanup TTL)
}

/**
 * Represents the live, frequently changing state of a liquidity pool.
 * This interface is now flexible to support both V2 (reserves) and V3 (liquidity/sqrtPrice) pools.
 */
export interface PoolState {
    address: string;
    token0: string;
    token1: string;
    // V3-specific state
    liquidity?: bigint;
    sqrtPriceX96?: bigint;
    // V2-specific state
    reserve0?: bigint;
    reserve1?: bigint;
    // Common state
    fee?: number;
    timestamp?: number;
    tickId?: string; // Unique identifier for this refresh cycle
    blockNumber?: number; // Block where this state was captured
}

/**
 * Pool Registry Phase 1: Pool Metadata
 */
export interface PoolMetadata {
  address: string;
  dexType: "v2" | "v3";
  token0: string;
  token1: string;
  feeTier?: number; // Only for V3
  weight: number; // 1 for V2 (light), 2 for V3 (heavier)
}

/**
 * Pool Registry Phase 2: Pricing Routes (Refactored)
 */
export interface PoolRegistry {
  pools: Record<string, PoolMetadata>;
  pricingRoutes: Record<string, Record<string, string[]>>; // [tokenAddress][baseSymbol] = poolAddresses[]
  topologyTimestamp?: Record<string, number>; // Timestamp (ms) when token topology was last refreshed
  refCount?: Record<string, number>; // Per-pool user count (poolAddress -> count)
}

/**
 * PHASE 7: Quarantine Entry
 */
export interface QuarantineEntry {
  address: string;
  metadata: TokenMetadata;
  discoveredAt: number; // Timestamp when token was discovered
  validationScheduled: boolean; // Whether validation has been queued
  promoted: boolean; // Whether token passed validation and was promoted to primary
}

/**
 * PHASE 7: Quarantine Registry
 */
export interface QuarantineRegistry {
  entries: Record<string, QuarantineEntry>;
}
