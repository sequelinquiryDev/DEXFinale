import { StorageService } from './StorageService';
import { PoolRegistry } from '../../domain/types';
import { Token } from '../../domain/entities';
import { logoFetcherAdapter } from '../../infrastructure/adapters/LogoFetcherAdapter';
import { timingConfig } from '../../infrastructure/config/TimingConfig';

interface TokenCacheEntry {
  tokens: Token[];
  timestamp: number;
}

interface PoolRegistryCacheEntry {
  registry: PoolRegistry;
  timestamp: number;
}

export class CacheLayer {
  private tokenCache: Map<number, TokenCacheEntry> = new Map();
  private poolRegistryCache: Map<number, PoolRegistryCacheEntry> = new Map();

  constructor(private storageService: StorageService) {}

  async getTokensByNetworkCached(chainId: number): Promise<Token[]> {
    const cached = this.tokenCache.get(chainId);
    if (cached && Date.now() - cached.timestamp < timingConfig.MARKET_DATA_CACHE_TTL_MS) {
      return cached.tokens;
    }

    const tokensFromStorage = await this.storageService.getTokensByNetwork(chainId);
    let wasModified = false;

    const enrichedTokens = await Promise.all(
      tokensFromStorage.map(async (token) => {
        if (!token.logoURI) {
          const logoUrl = await logoFetcherAdapter.fetchLogoFromFallbacks(token.address, chainId);
          if (logoUrl) {
            wasModified = true;
            return { ...token, logoURI: logoUrl, logoFetchedAt: Date.now() };
          }
        }
        return token;
      })
    );

    if (wasModified) {
      await this.storageService.saveTokensByNetwork(chainId, enrichedTokens);
    }

    this.tokenCache.set(chainId, { tokens: enrichedTokens, timestamp: Date.now() });
    return enrichedTokens;
  }

  invalidateTokenCache(chainId: number): void {
    this.tokenCache.delete(chainId);
  }

  async getPoolRegistryCached(chainId: number): Promise<PoolRegistry> {
    const cached = this.poolRegistryCache.get(chainId);
    if (cached && Date.now() - cached.timestamp < timingConfig.MARKET_DATA_CACHE_TTL_MS) {
      return cached.registry;
    }

    const registry = await this.storageService.getPoolRegistry(chainId);
    this.poolRegistryCache.set(chainId, { registry, timestamp: Date.now() });
    return registry;
  }

  invalidatePoolRegistryCache(chainId: number): void {
    this.poolRegistryCache.delete(chainId);
  }
}
