/**
 * ContractAddressConfig
 * 
 * Centralized configuration for protocol and infrastructure contract addresses and ABIs.
 * Organized by network and purpose.
 */

// -------------------
// Pool ABIs
// -------------------

// V2-style AMM pool (Uniswap V2, SushiSwap, QuickSwap)
export const V2_POOL_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1)"
];

// V3-style AMM pool (Uniswap V3)
export const V3_POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick)",
  "function liquidity() view returns (uint128)"
];

// V4-style AMM pool (Uniswap V4, treated same as V3 for spot pricing)
export const V4_POOL_ABI = V3_POOL_ABI;

// -------------------
// Contract addresses per network
// -------------------
interface ContractAddresses {
  multicall: string;
}

const CONTRACT_ADDRESSES: Record<string, ContractAddresses> = {
  ethereum: {
    multicall: "0xca11bde05977b3631167028862be2a173976ca11",
  },
  polygon: {
    multicall: "0xca11bde05977b3631167028862be2a173976ca11",
  },
};

// -------------------
// Supported networks mapping
// -------------------
export const SUPPORTED_NETWORKS: Record<number, string> = {
  1: "ethereum",
  137: "polygon",
};

// -------------------
// Utility to parse chain ID
// Supports number, decimal string, or hex string (0x-prefixed)
// -------------------
function parseChainId(chainId: number | string): number {
  if (typeof chainId === "number") return chainId;
  if (typeof chainId === "string") {
    if (chainId.startsWith("0x") || chainId.startsWith("0X")) {
      return parseInt(chainId, 16); // Hex string
    } else {
      return parseInt(chainId, 10); // Decimal string
    }
  }
  throw new Error(`Invalid chainId type: ${typeof chainId}`);
}

// -------------------
// Get contract address by network
// -------------------
export function getContractAddress(
  chainId: number | string,
  contract: keyof ContractAddresses
): string {
  const id = parseChainId(chainId);
  const networkKey = SUPPORTED_NETWORKS[id];

  if (!networkKey) {
    throw new Error(`Unsupported chainId: ${id}. Supported networks: ${Object.keys(SUPPORTED_NETWORKS).join(", ")}`);
  }

  const address = CONTRACT_ADDRESSES[networkKey][contract];
  if (!address) {
    throw new Error(`Contract '${contract}' is not configured for network '${networkKey}'`);
  }

  return address;
}

// -------------------
// Export everything
// -------------------
export const ContractAddressConfig = CONTRACT_ADDRESSES;
export const PoolABIs = {
  v2: V2_POOL_ABI,
  v3: V3_POOL_ABI,
  v4: V4_POOL_ABI,
};