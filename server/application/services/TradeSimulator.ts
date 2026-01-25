import { sharedStateCache } from './SharedStateCache';

export class TradeSimulator {

  constructor() {}

  /**
   * Simulates a trade along a given path to calculate the output amount.
   * @param path An array of token addresses representing the trade route.
   * @param amountIn The amount of the input token.
   * @returns The estimated output amount of the final token in the path.
   */
  public simulatePath(path: string[], amountIn: bigint): bigint | null {
    let currentAmount = amountIn;

    for (let i = 0; i < path.length - 1; i++) {
      const tokenIn = path[i];
      const tokenOut = path[i + 1];

      const poolAddress = this.findPool(tokenIn, tokenOut);
      if (!poolAddress) {
        return null; // Pool not found for this leg of the trade
      }
      
      const poolState = sharedStateCache.getPoolState(poolAddress);
      if (!poolState) {
        return null;
      }

      const amountOut = this.getAmountOut(poolState, tokenIn, currentAmount);
      if (amountOut === null) {
        return null;
      }
      currentAmount = amountOut;
    }

    return currentAmount;
  }

  private getAmountOut(poolState: any, tokenIn: string, amountIn: bigint): bigint | null {
    const zeroForOne = tokenIn === poolState.token0;
    
    const sqrtPriceX96 = BigInt(poolState.sqrtPriceX96);
    const liquidity = BigInt(poolState.liquidity);

    if (zeroForOne) {
      const amountInWithFee = amountIn * 997n / 1000n;
      const newLiquidity = liquidity + amountInWithFee;
      if (newLiquidity === 0n) return 0n;
      const newSqrtPriceX96 = (liquidity * sqrtPriceX96) / newLiquidity;
      const amountOut = liquidity * (sqrtPriceX96 - newSqrtPriceX96) / (sqrtPriceX96 * newSqrtPriceX96);
      return amountOut > 0n ? amountOut : 0n;
    } else {
      const amountInWithFee = amountIn * 997n / 1000n;
      if (liquidity === 0n) return 0n;
      const newSqrtPriceX96 = sqrtPriceX96 + amountInWithFee * (1n << 96n) / liquidity;
      const amountOut = liquidity * (newSqrtPriceX96 - sqrtPriceX96) / (1n << 96n);
      return amountOut > 0n ? amountOut : 0n;
    }
  }

  private findPool(tokenA: string, tokenB: string): string | undefined {
    const pools = sharedStateCache.getPoolsForToken(tokenA);
    const pool = pools.find(pool => (pool.token0 === tokenA && pool.token1 === tokenB) || (pool.token0 === tokenB && pool.token1 === tokenA));
    return pool ? (pool as any).address : undefined;
  }
}
