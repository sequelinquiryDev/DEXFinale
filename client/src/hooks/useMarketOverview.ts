/**
 * useMarketOverview - React Query Hook
 * 
 * Fetches market overview for a list of tokens on a selected network.
 * Provides caching, error handling, and automatic refetching.
 */

import { useQuery, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import { marketViewerClient } from '@/lib/api/MarketViewerClient';
import type { MarketOverview } from '@shared/schema';

/**
 * Hook to fetch market overview for a specific list of tokens on a network.
 * 
 * @param chainId - Network chain ID (1 for Ethereum, 137 for Polygon).
 * @param tokenAddresses - Array of token addresses to fetch data for.
 * @param options - React Query options (optional).
 * @returns Query result with market overview data.
 * 
 * @example
 * const { data: overview, isLoading } = useMarketOverview(137, ['0x123...', '0x456...']);
 */
export function useMarketOverview(
  chainId: number,
  tokenAddresses: string[],
  options?: Omit<UseQueryOptions<MarketOverview | null>, 'queryKey' | 'queryFn'>
): UseQueryResult<MarketOverview | null, Error> {
  return useQuery({
    queryKey: ['market', 'overview', chainId, tokenAddresses],
    queryFn: async () => {
      // This query will only run if there are addresses to fetch.
      if (!tokenAddresses || tokenAddresses.length === 0) {
        // Return a valid, empty MarketOverview object if there are no tokens.
        return {
          chainId: chainId,
          tokens: [],
          timestamp: Date.now(),
          totalLiquidity: 0,
          totalVolume24h: 0,
        };
      }
      return await marketViewerClient.getMarketOverview(chainId, tokenAddresses);
    },
    enabled: !!tokenAddresses && tokenAddresses.length > 0, // The query will not run until token addresses are available.
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 1,
    ...options,
  });
}
