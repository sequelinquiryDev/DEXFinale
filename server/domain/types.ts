
/**
 * Represents the static, non-changing metadata for a token.
 */
export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
}

/**
 * Represents the live, frequently changing state of a liquidity pool.
 */
export interface PoolState {
    address: string;
    liquidity: bigint;
    sqrtPriceX96: bigint;
    token0: string;
    token1: string;
    fee?: number;
    timestamp?: number;
    // PHASE 6: Cache versioning for tick consistency
    tickId?: string; // Unique identifier for this refresh cycle
    blockNumber?: number; // Block where this state was captured
}

/**
 * Pool Registry Phase 1: Pool Metadata
 * 
 * Metadata about a liquidity pool for pricing topology.
 * Used by hot path to schedule queries and understand pool structure.
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
 * Pool Registry Phase 1: Pricing Route
 * 
 * Static, pre-indexed route for pricing a token.
 * Deterministic - no runtime pathfinding.
 */
export interface PricingRoute {
  pool: string; // Pool address
  base: string; // Base token (WETH, USDC, etc.)
}

/**
 * Pool Registry Phase 1: Complete Pool Registry
 * 
 * Network-scoped registry containing:
 * 1. Pool metadata indexed by address
 * 2. Pricing routes indexed by token address
 */
export interface PoolRegistry {
  pools: Record<string, PoolMetadata>;
  pricingRoutes: Record<string, PricingRoute[]>;
}

/**
 * PHASE 7: Quarantine Entry
 * 
 * Represents a newly discovered token pending validation.
 * Tracks discovery time and validation status.
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
 * 
 * Registry for newly discovered tokens awaiting background validation.
 * Separate from primary registry to prevent untrusted tokens from reaching users.
 */
export interface QuarantineRegistry {
  entries: Record<string, QuarantineEntry>;
}
