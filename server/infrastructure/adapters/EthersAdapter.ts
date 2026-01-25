import { Pool, Token } from "../../domain/entities";
import { ethers, BaseContract } from "ethers";
import { PoolState, TokenMetadata } from "../../domain/types";

const MULTICALL_ADDRESS = "0xca11bde05977b3631167028862be2a173976ca11";
const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
];

const MULTICALL_ABI = [
  "function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)"
];

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 feeTier) view returns (address pool)"
];

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function fee() view returns (uint24)"
];

export class EthersAdapter {
  private providers: { [chainId: number]: ethers.JsonRpcProvider };
  private factory: ethers.Contract;

  constructor(rpcUrls: { [chainId: number]: string }) {
    this.providers = {};
    for (const chainId in rpcUrls) {
      this.providers[chainId] = new ethers.JsonRpcProvider(rpcUrls[chainId]);
    }
    this.factory = new ethers.Contract(UNISWAP_V3_FACTORY, FACTORY_ABI, this.providers[1]);
  }

  private getProvider(chainId: number): ethers.JsonRpcProvider {
    const provider = this.providers[chainId];
    if (!provider) {
      throw new Error(`Provider for chain ID ${chainId} not configured.`);
    }
    return provider;
  }

  async getTokenMetadata(tokenAddress: string, chainId: number): Promise<TokenMetadata> {
    const provider = this.getProvider(chainId);
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [name, symbol, decimals] = await Promise.all([
        tokenContract.name(),
        tokenContract.symbol(),
        tokenContract.decimals(),
    ]);
    return { name, symbol, decimals };
  }

  async getPoolState(poolAddress: string, chainId: number): Promise<PoolState> {
    const provider = this.getProvider(chainId);
    const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
    const slot0 = await poolContract.slot0();
    const liquidity = await poolContract.liquidity();
    return {
        liquidity: BigInt(liquidity.toString()),
        sqrtPriceX96: BigInt(slot0.sqrtPriceX96.toString()),
    };
  }

  async getPoolAddress(tokenA: Token, tokenB: Token, chainId: number, fee: number): Promise<string | null> {
    const provider = this.getProvider(chainId);
    const factory = this.factory.connect(provider);
    const poolAddress = await (factory as BaseContract & { getPool: (a: string, b: string, c: number) => Promise<string> }).getPool(tokenA.address, tokenB.address, fee);
    if (poolAddress && poolAddress !== "0x0000000000000000000000000000000000000000") {
      return poolAddress;
    }
    return null;
  }

  async getPools(tokenA: Token, tokenB: Token): Promise<PoolState[]> {
    const chainId = tokenA.chainId;
    const feeTiers = [100, 500, 3000, 10000];
    const pools: PoolState[] = [];

    for (const fee of feeTiers) {
      const poolAddress = await this.getPoolAddress(tokenA, tokenB, chainId, fee);

      if (poolAddress) {
        const poolState = await this.getPoolState(poolAddress, chainId);
        pools.push(poolState);
      }
    }

    return pools;
  }
}
