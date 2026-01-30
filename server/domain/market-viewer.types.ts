/**
 * Market Viewer Types - Data structures for market data display
 * 
 * RESPONSIBILITY: Define types for market data returned by MarketViewerService
 * - Token market data (price, liquidity, volume)
 * - Data source tracking (where did this data come from?)
 * - Timestamp for cache validation
 */

/**
 * Source of data - for audit trail
 */
export type DataSource = 'explorer-api' | 'rpc-call' | 'cached' | 'multicall' | 'alchemy-api' | 'insufficient-data';

/**
 * Complete market data for a single token
 */
export interface TokenMarketData {
  // Token identification
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;

  // Price information
  price: number; // In USD
  priceChange24h?: number; // Percentage change
  priceHigh24h?: number;
  priceLow24h?: number;

  // Market metrics
  marketCap?: number; // Total USD value
  fullyDilutedMarketCap?: number;
  liquidity?: number; // Total USD liquidity
  volume24h?: number; // Trading volume in USD
  holders?: number; // Number of token holders

  // Metadata
  logoURI?: string;
  website?: string;
  twitter?: string;
  description?: string;

  // Data source and timing
  dataSource: DataSource;
  timestamp: number; // Unix timestamp when data was fetched
  cachedUntil?: number; // When this cache expires
}

/**
 * Market overview - multiple tokens at once
 */
export interface MarketOverview {
  chainId: number;
  tokens: TokenMarketData[];
  timestamp: number;
  totalLiquidity: number; // Sum of all liquidity
  totalVolume24h: number; // Sum of all volume
}

/**
 * Market data with error information
 */
export interface MarketDataWithError extends TokenMarketData {
  error?: string;
  errorDetails?: {
    source: DataSource;
    message: string;
  };
}

/**
 * Token search result (for UI display)
 */
export interface TokenSearchResult {
  address: string;
  symbol: string;
  name: string;
  chainId: number;
  price?: number;
  logoURI?: string;
  relevanceScore: number; // 0-1, how well it matched the search
}

/**
 * Cache entry for market data
 */
export interface MarketDataCacheEntry {
  data: TokenMarketData;
  expireAt: number; // When this entry expires
}

/**
 * Options for fetching market data
 */
export interface FetchMarketDataOptions {
  chainId?: number; // Optional - chainId passed separately in service method
  forceRefresh?: boolean; // Bypass cache
  preferDataSource?: DataSource; // Try this source first
  timeout?: number; // Maximum time to wait (ms)
}
