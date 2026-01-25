
import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import { StorageService } from './StorageService';
import { Token } from '../../domain/entities';
import { sharedStateCache } from './SharedStateCache';
import { PoolState, TokenMetadata } from '../../domain/types';

export class DiscoveryService {
  constructor(
    private readonly storageService: StorageService,
    private readonly ethersAdapter: EthersAdapter,
  ) {}

  async discoverAndPrimeCache(): Promise<void> {
    console.log('Starting pool and token discovery to prime the cache...');
    const tokens: Token[] = await this.storageService.getTokens();

    // 1. Prime Token Metadata
    for (const token of tokens) {
      try {
        // Assuming EthersAdapter has a method to get token metadata
        const metadata: TokenMetadata = await this.ethersAdapter.getTokenMetadata(token.address, token.chainId);
        sharedStateCache.setTokenMetadata(token.address, metadata);
      } catch (error: any) {
        console.error(`Error fetching metadata for ${token.symbol}:`, error.message);
      }
    }
    console.log('Token metadata cache priming complete.');

    // 2. Discover Pools and Prime their State
    const tokensByChain = tokens.reduce((acc, token) => {
      if (!acc[token.chainId]) {
        acc[token.chainId] = [];
      }
      acc[token.chainId].push(token);
      return acc;
    }, {} as Record<number, Token[]>);

    const feeTiers = [100, 500, 3000, 10000];

    for (const chainId in tokensByChain) {
      const chainTokens = tokensByChain[chainId];
      const chainIdNum = parseInt(chainId, 10);
      console.log(`Discovering pools for chain ID: ${chainIdNum}...`);

      for (let i = 0; i < chainTokens.length; i++) {
        for (let j = i + 1; j < chainTokens.length; j++) {
          const tokenA = chainTokens[i];
          const tokenB = chainTokens[j];

          for (const fee of feeTiers) {
            try {
              const poolAddress = await this.ethersAdapter.getPoolAddress(tokenA, tokenB, chainIdNum, fee);
              if (poolAddress) {
                // 3. Fetch initial pool state and prime cache
                const poolState: PoolState = await this.ethersAdapter.getPoolState(poolAddress, chainIdNum);
                sharedStateCache.setPoolState(poolAddress, poolState);
              }
            } catch (error: any) {
              // It's common for pools not to exist, so we can log this less verbosely
              // console.log(`Info: Pool not found for ${tokenA.symbol}-${tokenB.symbol} with fee ${fee}`);
            }
          }
        }
      }
    }

    console.log('Pool discovery and cache priming finished.');
  }

  /**
   * Periodically refreshes the state of all known pools in the cache.
   */
  async refreshPools(): Promise<void> {
    // This is a placeholder for a more sophisticated refresh mechanism.
    // In a real application, you'd get the list of pools from the cache keys
    // and update them in batches.
    console.log('Refreshing pool states...');
    // This is where we would iterate through the cached pools and update their state
    // For now, we will re-discover to refresh
    await this.discoverAndPrimeCache();
  }
}
