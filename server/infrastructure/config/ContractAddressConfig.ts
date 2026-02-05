/**
 * ContractAddressConfig
 * 
 * Centralized configuration for protocol and infrastructure contract addresses.
 * Organized by network and purpose.
 */

interface ContractAddresses {
  multicall: string;
}

const CONTRACT_ADDRESSES: {
  ethereum: ContractAddresses;
  polygon: ContractAddresses;
  [key: string]: ContractAddresses;
} = {
  ethereum: {
    // Multicall3: Universal multicall contract across all networks
    multicall: "0xca11bde05977b3631167028862be2a173976ca11",
      },
  
  polygon: {
    // Multicall3: Same address on Polygon
    multicall: "0xca11bde05977b3631167028862be2a173976ca11",
  },
};

/**
 * Get contract address for a specific network.
 * This function only supports Ethereum Mainnet (1) and Polygon Mainnet (137).
 * @param chainId - Network chain ID (1 for Ethereum, 137 for Polygon)
 * @param contract - Contract name ('multicall' or 'uniswapV3Factory')
 * @returns Contract address
 * @throws If the chainId is not 1 or 137.
 */
export function getContractAddress(
  chainId: number | string,
  contract: keyof ContractAddresses
): string {
  const id = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;
  
  let networkKey: string;
  if (id === 1) {
    // Ethereum mainnet
    networkKey = 'ethereum';
  } else if (id === 137) {
    // Polygon mainnet
    networkKey = 'polygon';
  } else {
    // Explicitly block any other chain to prevent silent errors.
    throw new Error(`Unsupported chainId: ${id}. Only Ethereum Mainnet (1) and Polygon Mainnet (137) are configured.`);
  }
  
  const address = CONTRACT_ADDRESSES[networkKey][contract];
  if (!address) {
    // This should not be reachable if the networkKey is valid, but serves as a safeguard.
    throw new Error(`Contract '${contract}' is not configured for network '${networkKey}'.`);
  }
  
  return address;
}

export const ContractAddressConfig = CONTRACT_ADDRESSES;
