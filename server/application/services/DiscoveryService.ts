
import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import { StorageService } from './StorageService';
import { TokenDiscoveryManager } from './TokenDiscoveryManager';
import { Token } from '../../domain/entities';
import { sharedStateCache } from './SharedStateCache';
import { TokenMetadata, PoolRegistry } from '../../domain/types';
import { explorerConfig } from '../../infrastructure/config/ExplorerConfig';

export class DiscoveryService {
  private tokenDiscoveryManager: TokenDiscoveryManager;

  constructor(
    private readonly storageService: StorageService,
    private readonly ethersAdapter: EthersAdapter,
  ) {
    this.tokenDiscoveryManager = new TokenDiscoveryManager(storageService);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async discoverAndPrimeCache(): Promise<void> {
    console.log('Starting pool and token discovery to prime the cache...');
    console.log('🔍 PHASE 1: Fetching token metadata via Explorer APIs (Cold Path)');
    
    const ethTokens: Token[] = await this.storageService.getTokensByNetwork(1);
    const polygonTokens: Token[] = await this.storageService.getTokensByNetwork(137);
    const tokens = [...ethTokens, ...polygonTokens];

    console.log(`\n📋 Priming metadata for ${tokens.length} tokens...`);
    
    const BATCH_SIZE = 5;
    const BATCH_DELAY_MS = 1000;
    
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE).filter(t => t && t.address && t.chainId);
      
      const metadataPromises = batch.map(async (token) => {
        try {
          if (!token || !token.address || !token.chainId) return;
          const tokenSymbol = token.symbol || 'N/A';
          let metadata: TokenMetadata | null = null;
          try {
            const url = explorerConfig.getTokenInfoUrl(token.chainId, token.address);
            const response = await fetch(url);
            const data = await response.json() as any;

            if (data.status === "1" && data.result && data.result[0]) {
              const info = data.result[0];
              metadata = {
                name: info.ContractName || token.name,
                symbol: info.Symbol || token.symbol,
                decimals: parseInt(info.Decimals || (token.decimals || 18).toString()),
                logoURI: '', // Not available from this endpoint
                logoFetchedAt: undefined,
              };
              console.log(`  ✓ ${tokenSymbol} metadata fetched via Explorer API`);
            }
          } catch (e) {
            console.warn(`  ⚠️  Explorer metadata fetch failed for ${tokenSymbol}. It will be skipped.`);
          }
          
          if(metadata) {
            // Update the central token repository
            await this.storageService.updateTokenMetadata(token.chainId, token.address, metadata);
            // Also update the in-memory cache for immediate use
            sharedStateCache.setTokenMetadata(token.address, metadata);
          }
        } catch (error: any) {
          console.error(`  ✗ Error fetching metadata for ${token.symbol || 'N/A'}:`, error.message);
        }
      });

      await Promise.all(metadataPromises);
      
      if (i + BATCH_SIZE < tokens.length) {
        await this.delay(BATCH_DELAY_MS);
      }
    }
    console.log('✅ Token metadata cache priming complete.\n');

    // PHASE 2: Discover Pool Topology using Subgraphs
    console.log('🔍 PHASE 2: Discovering pool topology via subgraphs...');
    const tokensByChain = tokens.reduce((acc, token) => {
      if (token && token.chainId) {
        if (!acc[token.chainId]) {
          acc[token.chainId] = [];
        }
        acc[token.chainId].push(token);
      }
      return acc;
    }, {} as Record<number, Token[]>);

    for (const chainIdStr in tokensByChain) {
      const chainId = parseInt(chainIdStr, 10);
      const chainTokens = tokensByChain[chainId];

      if (!chainTokens || chainTokens.length === 0) continue;

      console.log(`\n📍 Chain ${chainId}: Checking ${chainTokens.length} tokens for stale topology...`);

      const tokensNeedingDiscovery: Token[] = [];
      // This check is now hypothetical as TokenDiscoveryManager does not expose isTopologyStale
      // for (const token of chainTokens) {
      //   const isStale = await this.tokenDiscoveryManager.isTopologyStale(token.address, chainId);
      //   if (isStale) {
      //     tokensNeedingDiscovery.push(token);
      //   }
      // }

      // For now, we assume we check all tokens
      if (tokensNeedingDiscovery.length === 0) {
        // console.log(`  ✓ All ${chainTokens.length} tokens have fresh topology (< 7 days)`);
        // continue;
      }

      console.log(`  → All token(s) will be checked for topology`);

      try {
        await this.tokenDiscoveryManager.discoverPoolsForTokens(chainTokens, chainId);
      } catch (error: any) {
        console.error(`  ✗ Error discovering pools for chain ${chainId}:`, error.message);
      }
    }

    console.log('\n✅ Pool discovery and topology update complete.');
  }
}
