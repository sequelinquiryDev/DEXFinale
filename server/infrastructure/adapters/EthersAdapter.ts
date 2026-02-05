
import { ethers } from "ethers";
import { providersConfig } from "../config/ProvidersConfig";
import { getContractAddress, PoolABIs, MULTICALL_ABI } from "../config/ContractAddressConfig";
import type { MulticallResult } from "../../application/services/MulticallEngine";

// Keep retry logic as it's useful for network requests
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// Define a new type for the input parameter to executeMulticall
interface PoolIdentifier {
  address: string;
  dexVersion: "v2" | "v3" | "v4";
}

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
      if ((isRateLimited || error?.code === "CALL_EXCEPTION") && attempt < maxRetries - 1) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delayMs);
        continue;
      }
      throw error;
    }
  }
  throw lastError!;
}

// Define interfaces for different DEX version data
interface V2Data {
  reserve0: bigint;
  reserve1: bigint;
}

interface V3Data {
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
}

export class EthersAdapter {
  private providers: { [chainId: number]: ethers.JsonRpcProvider } = {};

  constructor() {
    // Constructor is now empty, providers are created on-demand
  }

  private getProvider(chainId: number): ethers.JsonRpcProvider {
    if (this.providers[chainId]) {
      return this.providers[chainId];
    }

    if (!providersConfig.isChainSupported(chainId)) {
      throw new Error(`Provider for chain ID ${chainId} not configured.`);
    }

    // Assumes getChainProviders and getRpcEndpoint exist and are correct
    const { rpcEndpoint } = providersConfig.getChainProviders(chainId);
    if (!rpcEndpoint) {
      throw new Error(`RPC endpoint for chain ID ${chainId} not found.`);
    }

    const provider = new ethers.JsonRpcProvider(rpcEndpoint);
    this.providers[chainId] = provider;
    return provider;
  }

  /**
   * Executes a multicall batch, dynamically handling different DEX versions.
   *
   * @param pools - An array of objects containing the address and dexVersion for each pool.
   * @param providerIndex - The index of the provider to use (for logging/debugging).
   * @param chainId - The blockchain network ID.
   * @returns A promise that resolves to an array of multicall results.
   */
  public async executeMulticall(
    pools: PoolIdentifier[],
    providerIndex: number, // Retained for context, though provider is now chosen by chainId
    chainId: number
  ): Promise<MulticallResult[]> {
    const provider = this.getProvider(chainId);
    // REMOVED: No longer need to read the registry on every call.
    // const registry = await storageService.getPoolRegistry(chainId);
    const multicallAddress = getContractAddress(chainId, "multicall");
    const multicallContract = new ethers.Contract(multicallAddress, MULTICALL_ABI, provider);

    const calls: { target: string; callData: string }[] = [];
    const poolCallMappings: { address: string; version: "v2" | "v3" | "v4"; callCount: number }[] = [];

    const v2Iface = new ethers.Interface(PoolABIs.v2);
    const v3Iface = new ethers.Interface(PoolABIs.v3); // v4 uses v3 ABI

    for (const pool of pools) {
      const { address: poolAddress, dexVersion } = pool;
      const target = ethers.getAddress(poolAddress);

      if (dexVersion === 'v2') {
        calls.push({ target, callData: v2Iface.encodeFunctionData("getReserves", []) });
        poolCallMappings.push({ address: poolAddress, version: dexVersion, callCount: 1 });
      } else if (dexVersion === 'v3' || dexVersion === 'v4') {
        calls.push({ target, callData: v3Iface.encodeFunctionData("slot0", []) });
        calls.push({ target, callData: v3Iface.encodeFunctionData("liquidity", []) });
        poolCallMappings.push({ address: poolAddress, version: dexVersion, callCount: 2 });
      }
    }

    if (calls.length === 0) return [];

    const result = await withRetry(
      () => multicallContract.aggregate(calls),
      `multicall(${pools.length} pools on provider ${providerIndex})`
    );

    const blockNumber = Number(result.blockNumber);
    const returnData = result.returnData as string[];
    const results: MulticallResult[] = [];
    let dataIndex = 0;

    for (const mapping of poolCallMappings) {
      try {
        let success = true;
        let poolData: any = {};

        if (mapping.version === 'v2') {
          const [reservesResult] = returnData.slice(dataIndex, dataIndex + 1);
          if (reservesResult === '0x') success = false;
          else {
            const [reserve0, reserve1] = v2Iface.decodeFunctionResult("getReserves", reservesResult);
            poolData = {
              reserve0: BigInt(reserve0.toString()),
              reserve1: BigInt(reserve1.toString()),
            } as V2Data;
          }
        } else if (mapping.version === 'v3' || mapping.version === 'v4') {
          const [slot0Result, liquidityResult] = returnData.slice(dataIndex, dataIndex + 2);
           if (slot0Result === '0x' || liquidityResult === '0x') success = false;
           else {
            const [sqrtPriceX96, tick] = v3Iface.decodeFunctionResult("slot0", slot0Result);
            const [liquidity] = v3Iface.decodeFunctionResult("liquidity", liquidityResult);
            poolData = {
              sqrtPriceX96: BigInt(sqrtPriceX96.toString()),
              tick: Number(tick),
              liquidity: BigInt(liquidity.toString()),
            } as V3Data;
          }
        }

        results.push({
          poolAddress: mapping.address,
          blockNumber,
          success,
          data: success ? poolData : undefined,
          error: success ? undefined : new Error("Multicall execution failed"),
        });

      } catch (error) {
        results.push({
          poolAddress: mapping.address,
          blockNumber,
          success: false,
          error: error as Error,
        });
      }
      dataIndex += mapping.callCount;
    }

    return results;
  }
}
