
/**
 * ContractAddressConfig
 * 
 * Centralized configuration for protocol and infrastructure contract addresses and ABIs.
 * Organized by network and purpose.
 */

import { networkConfig } from "./NetworkConfig";

// ------------------
// ABIs
// ------------------

// V2 & V3 Pool ABIs
export const V2_POOL_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
];
export const V3_POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick)",
  "function liquidity() view returns (uint128)"
];

// V2 & V3 Factory ABIs
export const V2_FACTORY_ABI = ['function getPair(address tokenA, address tokenB) view returns (address pair)'];
export const V3_FACTORY_ABI = ['function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)'];

// Multicall
export const MULTICALL_ABI = [
  "function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)"
];


// ------------------
// Addresses
// ------------------

// Infrastructure addresses (e.g., Multicall)
interface InfraContractAddresses {
  multicall: string;
}

const INFRA_CONTRACT_ADDRESSES: Record<string, InfraContractAddresses> = {
  ethereum: {
    multicall: "0xca11bde05977b3631167028862be2a173976ca11",
  },
  polygon: {
    multicall: "0xca11bde05977b3631167028862be2a173976ca11",
  },
};

// DEX Factory addresses and fee tiers by chain ID
export const FACTORIES = {
  [1]: { // Ethereum
    v2: [
      '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', // Uniswap V2
      '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac', // SushiSwap V2
    ],
    v3: [
      '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Uniswap V3
    ],
    v3_fees: [100, 500, 3000, 10000], // 0.01%, 0.05%, 0.3%, 1%
  },
  [137]: { // Polygon
    v2: [
      '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32', // QuickSwap
      '0xc35DADB65012eC5796536bD9864eD8773aBc74C4', // SushiSwap V2
    ],
    v3: [
      '0x1F98431c8aD98523631AE4a59f267346ea31F984' // Uniswap V3 on Polygon
    ],
    v3_fees: [100, 500, 3000, 10000],
  }
};


// ------------------
// Utility Functions
// ------------------

function parseChainId(chainId: number | string): number {
  if (typeof chainId === "number") return chainId;
  if (typeof chainId === "string") {
    if (chainId.startsWith("0x") || chainId.startsWith("0X")) {
      return parseInt(chainId, 16);
    } else {
      return parseInt(chainId, 10);
    }
  }
  throw new Error(`Invalid chainId type: ${typeof chainId}`);
}

export function getInfraContractAddress(
  chainId: number | string,
  contract: keyof InfraContractAddresses
): string {
  const id = parseChainId(chainId);
  if (!networkConfig.isChainSupported(id)) {
    throw new Error(`Unsupported chainId: ${id}.`);
  }

  const networkKey = networkConfig.getNetwork(id).name.toLowerCase();
  const address = INFRA_CONTRACT_ADDRESSES[networkKey]?.[contract];
  
  if (!address) {
    throw new Error(`Contract '${contract}' is not configured for network '${networkKey}'`);
  }

  return address;
}
