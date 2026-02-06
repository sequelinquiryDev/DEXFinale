/**
 * TokenDiscoveryManager - Subgraph-Based Pool Discovery (FIXED)
 */

import { StorageService } from './StorageService';
import { Token } from '../../domain/entities';
import { PoolRegistry, PoolMetadata } from '../../domain/types';
import { getSubgraphConfig, SubgraphConfig, SupportedChainId } from '../../infrastructure/config/SubgraphConfig';
import { timingConfig } from '../../infrastructure/config/TimingConfig';
import { networkConfig } from '../../infrastructure/config/NetworkConfig';

interface DiscoveryAttempt {
  tokenAddress: string;
  chainId: number;
  attemptedAt: number;
  poolsFound: number;
  succeeded: boolean;
}

interface SubgraphPool {
  id: string;
  token0: { id: string; symbol: string; decimals: string };
  token1: { id: string; symbol: string; decimals: string };
  reserveUSD: string;
  liquidity?: string visible in v3
  feeTier?: string;
}

export class TokenDiscoveryManager {
  private discoveryAttempts: Map<string, DiscoveryAttempt> = new Map();
  private readonly DISCOVERY_RETRY_WINDOW = timingConfig.DISCOVERY_RETRY_WINDOW_MS;
  private readonly LIQUIDITY_THRESHOLD = timingConfig.LIQUIDITY_THRESHOLD;
  private readonly TTL_7_DAYS = timingConfig.DISCOVERY_TOPOLOGY_TTL_MS;

  constructor(private storageService: StorageService) {}

  public async discoverPoolsForTokens(tokens: Token[], chainId: number): Promise<number> {
    console.log(`🔍 [SUBGRAPH DISCOVERY] ${tokens.length} tokens on chain ${chainId}`);

    if (!networkConfig.isChainSupported(chainId)) return 0;

    const poolRegistry = await this.storageService.getPoolRegistry(chainId);
    if (!poolRegistry.topologyTimestamp) poolRegistry.topologyTimestamp = {};

    const baseTokenAddresses = Array.from(networkConfig.getBaseTokenAddresses(chainId));
    const allTokens = await this.storageService.getTokensByNetwork(chainId);

    const tokenSymbolMap = new Map<string, string>();
    for (const t of allTokens) tokenSymbolMap.set(t.address.toLowerCase(), t.symbol);

    const baseTokenMap = new Map<string, string>();
    for (const addr of baseTokenAddresses) {
      const sym = tokenSymbolMap.get(addr.toLowerCase());
      if (sym) baseTokenMap.set(addr.toLowerCase(), sym);
    }

    const subgraphs = getSubgraphConfig()[chainId as SupportedChainId] || [];
    let poolsDiscoveredThisBatch = 0;

    for (const token of tokens) {
      const attemptKey = `${token.address.toLowerCase()}-${chainId}`;
      const lastAttempt = this.discoveryAttempts.get(attemptKey);

      if (lastAttempt && Date.now() - lastAttempt.attemptedAt < this.DISCOVERY_RETRY_WINDOW) continue;

      console.log(`\n🔎 ${token.symbol}`);
      let poolsFoundForToken = 0;

      try {
        const allPools: SubgraphPool[] = [];

        // ✅ ONE QUERY PER SUBGRAPH
        for (const subgraph of subgraphs) {
          try {
            const pools = await this.querySubgraphForToken(
              token.address,
              subgraph,
              chainId
            );

            console.log(`   → ${subgraph.name}: ${pools.length} pools`);
            allPools.push(...pools);
          } catch (e: any) {
            console.warn(`   ⚠️ ${subgraph.name} failed: ${e.message}`);
          }
        }

        // ✅ SINGLE GLOBAL 90% FILTER
        const finalPools = this.filterPoolsByLiquidity(
          allPools,
          this.LIQUIDITY_THRESHOLD
        );

        for (const pool of finalPools) {
          this.addPoolToRegistry(poolRegistry, pool, chainId, baseTokenMap);
          poolsFoundForToken++;
          poolsDiscoveredThisBatch++;
        }

        poolRegistry.topologyTimestamp[token.address.toLowerCase()] = Date.now();

        this.discoveryAttempts.set(attemptKey, {
          tokenAddress: token.address,
          chainId,
          attemptedAt: Date.now(),
          poolsFound: poolsFoundForToken,
          succeeded: true,
        });

        console.log(`   ✓ Added ${poolsFoundForToken} pools`);
      } catch (e: any) {
        console.error(`   ✗ ${token.symbol}: ${e.message}`);
      }
    }

    await this.storageService.savePoolRegistry(chainId, poolRegistry);
    return poolsDiscoveredThisBatch;
  }

  private async querySubgraphForToken(
    tokenAddress: string,
    subgraph: SubgraphConfig,
    chainId: number
  ): Promise<SubgraphPool[]> {
    const baseTokens = Array.from(networkConfig.getBaseTokenAddresses(chainId));
    const tokenLower = tokenAddress.toLowerCase();
    const baseFilters = baseTokens.map(a => `"${a.toLowerCase()}"`).join(',');

    const query = `
    {
      pools: ${subgraph.dexType === 'v2' ? 'pairs' : 'pools'}(
        first: 1000
        where: {
          or: [
            { token0: "${tokenLower}", token1_in: [${baseFilters}] }
            { token1: "${tokenLower}", token0_in: [${baseFilters}] }
          ]
        }
        orderBy: ${subgraph.dexType === 'v2' ? 'reserveUSD' : 'totalValueLockedUSD'}
        orderDirection: desc
      ) {
        id
        token0 { id symbol decimals }
        token1 { id symbol decimals }
        reserveUSD: ${subgraph.dexType === 'v2' ? 'reserveUSD' : 'totalValueLockedUSD'}
        feeTier
        liquidity
      }
    }`;

    const res = await fetch(subgraph.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    const data = await res.json();
    return data.data?.pools || [];
  }

  private filterPoolsByLiquidity(pools: SubgraphPool[], threshold: number): SubgraphPool[] {
    if (!pools.length) return [];

    const parsed = pools.map(p => ({
      ...p,
      __liq: parseFloat(p.reserveUSD || '0'),
    })).sort((a, b) => b.__liq - a.__liq);

    const total = parsed.reduce((s, p) => s + p.__liq, 0);
    let cum = 0;
    const result: SubgraphPool[] = [];

    for (const p of parsed) {
      cum += p.__liq;
      const { __liq, ...rest } = p;
      result.push(rest);
      if (cum / total >= threshold) break;
    }

    return result;
  }

  private addPoolToRegistry(
    registry: PoolRegistry,
    pool: SubgraphPool,
    chainId: number,
    baseTokenMap: Map<string, string>
  ): void {
    const poolAddress = pool.id.toLowerCase();
    const token0 = pool.token0.id.toLowerCase();
    const token1 = pool.token1.id.toLowerCase();

    const dexType = pool.feeTier ? 'v3' : 'v2';

    const metadata: PoolMetadata = {
      address: poolAddress,
      dexType,
      token0,
      token1,
      feeTier: pool.feeTier ? parseInt(pool.feeTier, 10) : undefined,
      weight: dexType === 'v3' ? 2 : 1,
    };

    if (!registry.pools[poolAddress]) registry.pools[poolAddress] = metadata;

    const routes = registry.pricingRoutes;
    if (!routes[token0]) routes[token0] = {};
    if (!routes[token1]) routes[token1] = {};

    let baseSymbol: string | null = null;
    let nonBase: string | null = null;

    if (baseTokenMap.has(token1)) {
      baseSymbol = pool.token1.symbol;
      nonBase = token0;
    } else if (baseTokenMap.has(token0)) {
      baseSymbol = pool.token0.symbol;
      nonBase = token1;
    }

    if (!baseSymbol || !nonBase) return;

    if (!routes[nonBase][baseSymbol]) routes[nonBase][baseSymbol] = [];
    routes[nonBase][baseSymbol].push(poolAddress);
  }
}