
import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import { networkConfig } from '../../infrastructure/config/NetworkConfig';
import {
    FACTORIES,
    V2_FACTORY_ABI,
    V3_FACTORY_ABI
} from '../../infrastructure/config/ContractAddressConfig';

// A simple representation of a pool found on-chain
interface OnChainPool {
  address: string;
  token0: string;
  token1: string;
}

export class RoutingEngine {
  private ethersAdapter: EthersAdapter;

  constructor(ethersAdapter: EthersAdapter) {
    this.ethersAdapter = ethersAdapter;
  }

  /**
   * Finds a pool for a given token pair by querying a DEX factory.
   * @returns The pool address or the zero address if not found.
   */
  private async findPoolForPair(tokenA: string, tokenB: string, chainId: number): Promise<OnChainPool[]> {
    const foundPools: OnChainPool[] = [];
    const chainFactories = FACTORIES[chainId];
    if (!chainFactories) return [];

    // Query V2 factories
    for (const factoryAddress of chainFactories.v2) {
      try {
        const poolAddress = await this.ethersAdapter.callContractMethod(
          factoryAddress,
          V2_FACTORY_ABI,
          'getPair',
          [tokenA, tokenB],
          chainId
        );
        if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
          foundPools.push({ address: poolAddress, token0: tokenA, token1: tokenB });
        }
      } catch (e) {
        // console.warn(`V2 factory query failed for ${factoryAddress}:`, e);
      }
    }

    // Query V3 factories for each fee tier
    for (const factoryAddress of chainFactories.v3) {
      for (const fee of chainFactories.v3_fees) {
        try {
          const poolAddress = await this.ethersAdapter.callContractMethod(
            factoryAddress,
            V3_FACTORY_ABI,
            'getPool',
            [tokenA, tokenB, fee],
            chainId
          );
          if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
            foundPools.push({ address: poolAddress, token0: tokenA, token1: tokenB });
          }
        } catch (e) {
         // console.warn(`V3 factory query failed for ${factoryAddress} with fee ${fee}:`, e);
        }
      }
    }
    return foundPools;
  }

  /**
   * Finds all available pools for a given token against the network's base tokens.
   */
  private async getPoolsAgainstBase(token: string, chainId: number): Promise<OnChainPool[]> {
    const baseTokens = Array.from(networkConfig.getBaseTokenAddresses(chainId));
    let allPools: OnChainPool[] = [];

    for (const baseToken of baseTokens) {
      if (token.toLowerCase() === baseToken.toLowerCase()) continue;
      const pools = await this.findPoolForPair(token, baseToken, chainId);
      allPools = [...allPools, ...pools];
    }
    return allPools;
  }

  /**
   * Finds all possible trading routes between two tokens using on-chain lookups.
   * This is now an ASYNC operation.
   * @param tokenIn The address of the input token.
   * @param tokenOut The address of the output token.
   * @param chainId The ID of the chain to search on.
   * @param maxDepth The maximum number of hops in a route.
   * @returns An array of possible routes, where each route is an array of token addresses.
   */
  public async findRoutes(tokenIn: string, tokenOut: string, chainId: number, maxDepth: number = 3): Promise<string[][]> {
    const routes: string[][] = [];
    const queue: { token: string; path: string[]; visitedInPath: Set<string> }[] = [
      { token: tokenIn, path: [tokenIn], visitedInPath: new Set([tokenIn]) }
    ];

    while (queue.length > 0) {
      const { token, path, visitedInPath } = queue.shift()!;

      if (path.length > maxDepth) {
        continue;
      }

      // Find pools on-chain against base tokens and the final target token
      const poolsToSearch = await this.getPoolsAgainstBase(token, chainId);
      const directPool = await this.findPoolForPair(token, tokenOut, chainId);
      const allPools = [...poolsToSearch, ...directPool];
      
      const uniquePools = Array.from(new Map(allPools.map(p => [p.address, p])).values());

      for (const pool of uniquePools) {
        const otherToken = pool.token0.toLowerCase() === token.toLowerCase() ? pool.token1 : pool.token0;

        if (otherToken.toLowerCase() === tokenOut.toLowerCase()) {
          // Found a complete route
          routes.push([...path, tokenOut]);
        }

        if (!visitedInPath.has(otherToken) && path.length < maxDepth) {
          const newVisited = new Set(visitedInPath);
          newVisited.add(otherToken);
          queue.push({
            token: otherToken,
            path: [...path, otherToken],
            visitedInPath: newVisited
          });
        }
      }
    }

    return routes;
  }
}
