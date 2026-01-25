
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
    liquidity: bigint;
    sqrtPriceX96: bigint;
    token0?: string;
    token1?: string;
}
