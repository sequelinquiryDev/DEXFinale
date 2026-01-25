// === Domain Layer: Entities ===

export interface Token {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logoURI?: string;
  chainId: number;
}

export interface PoolData {
  tokenA: string;
  tokenB: string;
  address: string;
}

export interface Pool {
  address: string;
  token0: Token;
  token1: Token;
  reserve0: bigint;
  reserve1: bigint;
  feeTier: number;
  sqrtPriceX96?: bigint;
  liquidity?: bigint;
}

export interface SnapshotEntry {
  token: Token;
  priceUSD: number;
  liquidityUSD: number;
  volumeUSD: number;
  marketCapUSD: number;
}

export interface ChainSnapshot {
  timestamp: number;
  chain: string;
  entries: SnapshotEntry[];
}
