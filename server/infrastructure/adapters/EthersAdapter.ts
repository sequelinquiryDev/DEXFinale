import { Pool } from "../../domain/entities";
import { IChainAdapter } from "./MockAdapter";
import { ethers } from "ethers";

// MakerDAO Multicall3 address (same on most chains)
const MULTICALL_ADDRESS = "0xca11bde05977b3631167028862be2a173976ca11";
const MULTICALL_ABI = [
  "function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)"
];

// Uniswap V3 Pool ABI snippet
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)"
];

export class EthersAdapter implements IChainAdapter {
  private chainName: string;
  private provider: ethers.JsonRpcProvider;
  private stableTokenAddress: string;
  private etherscanApiKey: string;

  constructor(chainName: string, rpcUrl: string, stableTokenAddress: string, etherscanApiKey: string) {
    this.chainName = chainName;
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.stableTokenAddress = stableTokenAddress;
    this.etherscanApiKey = etherscanApiKey;
  }

  getChainName(): string {
    return this.chainName;
  }

  getStableTokenAddress(): string {
    return this.stableTokenAddress;
  }

  async getTopPools(limit: number): Promise<Pool[]> {
    try {
      // Etherscan V2 Discovery: Find top liquidity pools for tokens
      // This is a simplified version of the logic we'll use to discover pools
      // In a full implementation, we'd query the V2 'top tokens/pools' endpoint
      const response = await fetch(`https://api.etherscan.io/v2/api?chainid=1&module=token&action=tokenholderlist&address=${this.stableTokenAddress}&apikey=${this.etherscanApiKey}`);
      
      if (!response.ok) return [];
      
      const data = await response.json();
      // Logic to parse the Etherscan response into Pool entities would go here
      // For now, we return empty so the Service can fall back gracefully
      return [];
    } catch (error) {
      console.error(`Error fetching pools for ${this.chainName}:`, error);
      return [];
    }
  }

  async getPoolStateV3(poolAddress: string): Promise<Partial<Pool>> {
    const poolContract = new ethers.Contract(poolAddress, POOL_ABI, this.provider);
    const [slot0, liquidity] = await Promise.all([
      poolContract.slot0(),
      poolContract.liquidity()
    ]);

    return {
      sqrtPriceX96: BigInt(slot0.sqrtPriceX96.toString()),
      liquidity: BigInt(liquidity.toString())
    };
  }

  /**
   * Fetches state for multiple pools in a single RPC call using Multicall3
   */
  async getBatchPoolData(poolAddresses: string[]) {
    const multicall = new ethers.Contract(MULTICALL_ADDRESS, MULTICALL_ABI, this.provider);
    const poolInterface = new ethers.Interface(POOL_ABI);

    const calls = poolAddresses.flatMap(address => [
      {
        target: address,
        callData: poolInterface.encodeFunctionData("slot0")
      },
      {
        target: address,
        callData: poolInterface.encodeFunctionData("liquidity")
      }
    ]);

    const [blockNumber, returnData] = await multicall.aggregate(calls);
    
    const results = [];
    for (let i = 0; i < poolAddresses.length; i++) {
      const slot0Data = poolInterface.decodeFunctionResult("slot0", returnData[i * 2]);
      const liquidityData = poolInterface.decodeFunctionResult("liquidity", returnData[i * 2 + 1]);
      
      results.push({
        address: poolAddresses[i],
        sqrtPriceX96: slot0Data.sqrtPriceX96,
        liquidity: liquidityData[0]
      });
    }

    return results;
  }
}
