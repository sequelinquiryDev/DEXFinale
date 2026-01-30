
import { PoolState, TokenMetadata } from '../../domain/types';

/**
 * A unified, in-memory cache to store foundational blockchain data.
 * This cache is the single source of truth for both the Price Viewer and the Swap Quote Engine.
 */
class SharedStateCache {
  private poolStateStore: Map<string, PoolState>;
  private tokenMetadataStore: Map<string, TokenMetadata>;

  constructor() {
    this.poolStateStore = new Map<string, PoolState>();
    this.tokenMetadataStore = new Map<string, TokenMetadata>();
  }

  /**
   * Retrieves the state of a liquidity pool.
   * @param address The contract address of the pool.
   * @returns The `PoolState` object or `undefined` if not found.
   */
  public getPoolState(address: string): PoolState | undefined {
    return this.poolStateStore.get(address);
  }

  /**
   * Stores the state of a liquidity pool.
   * @param address The contract address of the pool.
   * @param state The `PoolState` object to store.
   */
  public setPoolState(address: string, state: PoolState): void {
    this.poolStateStore.set(address, state);
  }

  /**
   * Retrieves all pools that contain a specific token.
   * @param tokenAddress The address of the token.
   * @returns An array of `PoolState` objects.
   */
  public getPoolsForToken(tokenAddress: string): PoolState[] {
    const pools: PoolState[] = [];
    const poolStates = Array.from(this.poolStateStore.values());
    const normalizedToken = tokenAddress.toLowerCase();
    for (let i = 0; i < poolStates.length; i++) {
        const pool = poolStates[i];
        if (pool.token0.toLowerCase() === normalizedToken || pool.token1.toLowerCase() === normalizedToken) {
            pools.push(pool);
        }
    }
    return pools;
  }

  /**
   * Retrieves the metadata for a token.
   * @param address The contract address of the token.
   * @returns The `TokenMetadata` object or `undefined` if not found.
   */
  public getTokenMetadata(address: string): TokenMetadata | undefined {
    return this.tokenMetadataStore.get(address);
  }

  /**
   * Stores the metadata for a token.
   * @param address The contract address of the token.
   *
   */
  public setTokenMetadata(address: string, metadata: TokenMetadata): void {
    this.tokenMetadataStore.set(address, metadata);
  }
}

export const sharedStateCache = new SharedStateCache();
