
import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import {
    FACTORIES,
    V2_FACTORY_ABI, V3_FACTORY_ABI,
    V2_POOL_ABI, V3_POOL_ABI
} from '../../infrastructure/config/ContractAddressConfig';

interface PoolState {
    address: string;
    type: 'v2' | 'v3';
    data: any;
    token0: string;
    token1: string;
}

export class TradeSimulator {

  constructor(private ethersAdapter: EthersAdapter) {}

  public async simulatePath(path: string[], amountIn: bigint, chainId: number): Promise<bigint | null> {
    let currentAmount = amountIn;

    for (let i = 0; i < path.length - 1; i++) {
      const tokenIn = path[i];
      const tokenOut = path[i + 1];

      const poolState = await this.findAndGetBestPoolState(tokenIn, tokenOut, chainId);
      
      if (!poolState) {
        console.error(`[SIMULATOR] Could not find a valid pool for ${tokenIn} -> ${tokenOut} on chain ${chainId}`);
        return null;
      }

      const amountOut = this.getAmountOut(poolState, tokenIn, currentAmount);
      if (amountOut === null) {
        console.error(`[SIMULATOR] Calculation failed for pool ${poolState.address}`);
        return null;
      }
      currentAmount = amountOut;
    }

    return currentAmount;
  }

  private async findAndGetBestPoolState(tokenA: string, tokenB: string, chainId: number): Promise<PoolState | null> {
    const chainFactories = FACTORIES[chainId];
    if (!chainFactories) return null;

    let bestPool: { state: PoolState, amountOut: bigint } | null = null;
    const nominalAmount = BigInt(10) ** BigInt(Math.min(6, 18)); // A nominal amount for testing, e.g., 1 USDC or 1 LINK

    // V2 Pools
    for (const factoryAddress of chainFactories.v2) {
        const poolAddress = await this.ethersAdapter.callContractMethod(factoryAddress, V2_FACTORY_ABI, 'getPair', [tokenA, tokenB], chainId);
        if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
            const reserves = await this.ethersAdapter.callContractMethod(poolAddress, V2_POOL_ABI, 'getReserves', [], chainId);
            if (reserves) {
                const state: PoolState = { address: poolAddress, type: 'v2', data: { reserve0: reserves[0], reserve1: reserves[1] }, token0: tokenA, token1: tokenB };
                const amountOut = this.getAmountOut(state, tokenA, nominalAmount);
                if (amountOut && (!bestPool || amountOut > bestPool.amountOut)) {
                    bestPool = { state, amountOut };
                }
            }
        }
    }

    // V3 Pools
    for (const factoryAddress of chainFactories.v3) {
        for (const fee of chainFactories.v3_fees) {
            const poolAddress = await this.ethersAdapter.callContractMethod(factoryAddress, V3_FACTORY_ABI, 'getPool', [tokenA, tokenB, fee], chainId);
            if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
                const [slot0, liquidity] = await Promise.all([
                    this.ethersAdapter.callContractMethod(poolAddress, V3_POOL_ABI, 'slot0', [], chainId),
                    this.ethersAdapter.callContractMethod(poolAddress, V3_POOL_ABI, 'liquidity', [], chainId)
                ]);
                if (slot0 && liquidity) {
                    const state: PoolState = { address: poolAddress, type: 'v3', data: { sqrtPriceX96: slot0[0], liquidity: liquidity, fee: fee }, token0: tokenA, token1: tokenB };
                    const amountOut = this.getAmountOut(state, tokenA, nominalAmount);
                    if (amountOut && (!bestPool || amountOut > bestPool.amountOut)) {
                        bestPool = { state, amountOut };
                    }
                }
            }
        }
    }

    return bestPool ? bestPool.state : null;
  }

  private getAmountOut(poolState: PoolState, tokenIn: string, amountIn: bigint): bigint | null {
    const fee = BigInt(poolState.type === 'v2' ? 3000 : poolState.data.fee);
    const amountInWithFee = amountIn * (BigInt(1000000) - fee) / BigInt(1000000);
    const isToken0In = tokenIn.toLowerCase() === poolState.token0.toLowerCase();

    if (poolState.type === 'v2') {
        const { reserve0, reserve1 } = poolState.data;
        const [reserveIn, reserveOut] = isToken0In ? [BigInt(reserve0), BigInt(reserve1)] : [BigInt(reserve1), BigInt(reserve0)];
        if (reserveIn === 0n || reserveOut === 0n) return 0n;

        const numerator = amountInWithFee * reserveOut;
        const denominator = reserveIn + amountInWithFee;
        return numerator / denominator;

    } else if (poolState.type === 'v3') {
        const { sqrtPriceX96, liquidity } = poolState.data;
        const L = BigInt(liquidity);
        if (L === 0n) return 0n;

        const P = BigInt(sqrtPriceX96);
        // Calculate virtual reserves based on liquidity and current price
        // y = L * sqrt(P)
        // x = L / sqrt(P)
        // Note: These are not real reserves, but virtual ones used for the constant product formula.
        const reserveY = (L * P) / (2n ** 96n);
        const reserveX = (L * (2n ** 96n)) / P;

        const [reserveIn, reserveOut] = isToken0In ? [reserveX, reserveY] : [reserveY, reserveX];

        if (reserveIn === 0n || reserveOut === 0n) return 0n;

        const numerator = amountInWithFee * reserveOut;
        const denominator = reserveIn + amountInWithFee;
        return numerator / denominator;
    }
    return null;
  }
}
