import { Pool, Token } from "../../domain/entities";
import { ethers, BaseContract } from "ethers";
import { PoolState, TokenMetadata } from "../../domain/types";
import type { MulticallResult } from "../../application/services/MulticallEngine";
import { explorerConfig } from "../config/ExplorerConfig";
import { getContractAddress } from "../config/ContractAddressConfig";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  context: string,
  maxRetries = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      const isRateLimited =
        error?.info?.error?.code === 429 ||
        error?.code === 429 ||
        error?.message?.includes("429") ||
        error?.message?.includes("rate limit") ||
        error?.message?.includes("compute units");

      if (isRateLimited && attempt < maxRetries - 1) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delayMs);
        continue;
      }

      if (attempt < maxRetries - 1 && error?.code === "CALL_EXCEPTION") {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delayMs);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

const MULTICALL_ABI = [
  "function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)",
];

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 feeTier) view returns (address pool)",
];

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
  "function liquidity() view returns (uint128)",
  "function fee() view returns (uint24)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

export class EthersAdapter {
  private providers: { [chainId: number]: ethers.JsonRpcProvider };
  private factories: { [chainId: number]: ethers.Contract };

  constructor(rpcUrls: { [chainId: number]: string }) {
    this.providers = {};
    this.factories = {};

    for (const chainId in rpcUrls) {
      this.providers[chainId] = new ethers.JsonRpcProvider(rpcUrls[chainId]);
      const factoryAddress = getContractAddress(parseInt(chainId, 10), "uniswapV3Factory");
      this.factories[chainId] = new ethers.Contract(factoryAddress, FACTORY_ABI, this.providers[chainId]);
    }
  }

  private getProvider(chainId: number): ethers.JsonRpcProvider {
    const provider = this.providers[chainId];
    if (!provider) throw new Error(`Provider for chain ID ${chainId} not configured.`);
    return provider;
  }

  async getTokenMetadata(tokenAddress: string, chainId: number): Promise<TokenMetadata> {
    return withRetry(async () => {
      const provider = this.getProvider(chainId);
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const [name, symbol, decimals] = await Promise.all([
        tokenContract.name(),
        tokenContract.symbol(),
        tokenContract.decimals(),
      ]);
      return { name, symbol, decimals };
    }, `getTokenMetadata(${tokenAddress.slice(0, 8)})`);
  }

  async getPoolState(poolAddress: string, chainId: number): Promise<PoolState> {
    return withRetry(async () => {
      const provider = this.getProvider(chainId);
      const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
      const slot0 = await poolContract.slot0();
      const liquidity = await poolContract.liquidity();
      const token0 = await poolContract.token0();
      const token1 = await poolContract.token1();
      const fee = await poolContract.fee();

      return {
        address: poolAddress,
        liquidity: BigInt(liquidity.toString()),
        sqrtPriceX96: BigInt(slot0.sqrtPriceX96.toString()),
        token0,
        token1,
        fee,
        timestamp: Math.floor(Date.now() / 1000),
      };
    }, `getPoolState(${poolAddress.slice(0, 8)})`);
  }

  async getPoolAddress(tokenA: Token, tokenB: Token, chainId: number, fee: number): Promise<string | null> {
    const provider = this.getProvider(chainId);
    const factory = this.factories[chainId].connect(provider);

    try {
      const poolAddress = await (factory as any).getPool(tokenA.address, tokenB.address, fee);
      if (poolAddress && poolAddress !== ethers.ZeroAddress) return poolAddress;
    } catch {}

    return null;
  }

  /**
   * FIXED MULTICALL
   */
  public async executeMulticall(
    poolAddresses: string[],
    providerIndex: number,
    chainId: number
  ): Promise<MulticallResult[]> {
    const provider = this.getProvider(chainId);
    const multicallAddress = getContractAddress(chainId, "multicall");
    const multicallContract = new ethers.Contract(multicallAddress, MULTICALL_ABI, provider);

    const calls: any[] = [];
    const validPools: string[] = [];
    const poolIface = new ethers.Interface(POOL_ABI);

    for (const poolAddress of poolAddresses) {
      let target: string;
      try {
        target = ethers.getAddress(poolAddress);
      } catch {
        continue;
      }

      validPools.push(target);

      calls.push([target, poolIface.encodeFunctionData("slot0", [])]);
      calls.push([target, poolIface.encodeFunctionData("liquidity", [])]);
      calls.push([target, poolIface.encodeFunctionData("token0", [])]);
      calls.push([target, poolIface.encodeFunctionData("token1", [])]);
    }

    if (calls.length === 0) return [];

    const result = await withRetry(
      async () => (multicallContract as any).aggregate(calls),
      `multicall(${validPools.length} pools)`
    );

    const blockNumber = Number(result.blockNumber);
    const returnData = result.returnData as string[];

    const results: MulticallResult[] = [];

    for (let i = 0; i < validPools.length; i++) {
      const poolAddress = validPools[i];
      const base = i * 4;

      try {
        const slot0Decoded = poolIface.decodeFunctionResult("slot0", returnData[base]) as any;
        const liquidityDecoded = poolIface.decodeFunctionResult("liquidity", returnData[base + 1]) as any;
        const token0Decoded = poolIface.decodeFunctionResult("token0", returnData[base + 2]) as any;
        const token1Decoded = poolIface.decodeFunctionResult("token1", returnData[base + 3]) as any;

        results.push({
          poolAddress,
          blockNumber,
          success: true,
          data: {
            sqrtPriceX96: BigInt(slot0Decoded.sqrtPriceX96.toString()),
            tick: slot0Decoded.tick,
            liquidity: BigInt(liquidityDecoded.toString()),
            token0: token0Decoded,
            token1: token1Decoded,
          },
        });
      } catch (error) {
        results.push({
          poolAddress,
          blockNumber,
          success: false,
          error: error as Error,
        });
      }
    }

    return results;
  }
}