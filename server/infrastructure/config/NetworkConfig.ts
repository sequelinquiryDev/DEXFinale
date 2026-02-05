import { Token } from "../../../shared/schema";
/**
 * NetworkConfig - Network Definitions and Constants
 * 
 * RESPONSIBILITY: Define all network-specific constants
 * - Chain IDs, names, symbols
 * - Stablecoin addresses (reference tokens for pricing)
 * - Gas considerations
 * - Network-specific parameters
 * 
 * USED BY: Both Market Viewer and Swapper
 * SHARED: Yes - both modules use these definitions
 * 
 * IMPORTANT: Different from ProvidersConfig
 * - ProvidersConfig: WHERE to get data (endpoints)
 * - NetworkConfig: WHAT networks exist and their properties
 */

export enum ChainId {
  ETHEREUM = 1,
  POLYGON = 137,
}

export interface NetworkDefinition {
  chainId: ChainId;
  name: string;
  symbol: string;
  rpcUrl: string;
  
  // Reference stablecoins for pricing
  stablecoins: Token[];
  
  // Reference tokens for common pairs
  wrappedNative: Token;

  // Base tokens for liquidity discovery
  baseTokens: string[];
  
  // Block explorer details
  blockExplorer: {
    name: string;
    url: string;
    tokenUrl: string;
  };
  
  // Gas considerations
  gas: {
    standard: number;
    fast: number;
  };
}

class NetworkConfig {
  private static instance: NetworkConfig;
  private networks: Map<ChainId, NetworkDefinition>;

  private constructor() {
    this.networks = new Map([
      [ChainId.ETHEREUM, this.getEthereumConfig()],
      [ChainId.POLYGON, this.getPolygonConfig()],
    ]);
  }

  public static getInstance(): NetworkConfig {
    if (!NetworkConfig.instance) {
      NetworkConfig.instance = new NetworkConfig();
    }
    return NetworkConfig.instance;
  }

  /**
   * Ethereum Mainnet configuration
   */
  private getEthereumConfig(): NetworkDefinition {
    const stablecoins: Token[] = [
        {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
          symbol: 'USDC',
          name: "USD Coin",
          decimals: 6,
        },
        {
          address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
          symbol: 'DAI',
          name: "Dai",
          decimals: 18,
        },
        {
          address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
          symbol: 'USDT',
          name: "Tether",
          decimals: 6,
        },
      ];
    const wrappedNative: Token = {
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        symbol: 'WETH',
        name: "Wrapped Ether",
        decimals: 18,
      };
    return {
      chainId: ChainId.ETHEREUM,
      name: 'Ethereum',
      symbol: 'ETH',
      rpcUrl: 'https://mainnet.infura.io/v3/', // Will be completed by ProvidersConfig
      
      stablecoins,
      
      wrappedNative,

      baseTokens: [...stablecoins.map(t => t.address), wrappedNative.address],
      
      blockExplorer: {
        name: 'Etherscan',
        url: 'https://etherscan.io',
        tokenUrl: 'https://etherscan.io/token/',
      },
      
      gas: {
        standard: 21000,
        fast: 21000,
      },
    };
  }

  /**
   * Polygon Mainnet configuration
   */
  private getPolygonConfig(): NetworkDefinition {
    const stablecoins: Token[] = [
        {
          address: '0x2791Bca1f2de4661ED88A30C99a7a9449Aa84174', // USDC (Polygon)
          symbol: 'USDC',
          name: "USD Coin",
          decimals: 6,
        },
        {
          address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT (Polygon)
          symbol: 'USDT',
          name: "Tether",
          decimals: 6,
        },
        {
          address: '0x8f3cf7ad23cd3cadbd9735aff958023d60d76ee6',
          symbol: 'DAI',
          name: 'Dai',
          decimals: 18,
        }
      ];

    const wrappedNative: Token = {
        address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
        symbol: 'WMATIC',
        name: "Wrapped Matic",
        decimals: 18,
      };

    return {
      chainId: ChainId.POLYGON,
      name: 'Polygon',
      symbol: 'MATIC',
      rpcUrl: 'https://polygon-rpc.com',
      
      stablecoins,
      
      wrappedNative,

      baseTokens: [...stablecoins.map(t => t.address), wrappedNative.address],
      
      blockExplorer: {
        name: 'PolygonScan',
        url: 'https://polygonscan.com',
        tokenUrl: 'https://polygonscan.com/token/',
      },
      
      gas: {
        standard: 30,
        fast: 50,
      },
    };
  }

  /**
   * Get network definition by chain ID
   * @param chainId Network chain ID (1 = Ethereum, 137 = Polygon)
   * @returns Network definition
   */
  public getNetwork(chainId: ChainId | number): NetworkDefinition {
    const network = this.networks.get(chainId as ChainId);
    if (!network) {
      throw new Error(`Network with chain ID ${chainId} not found`);
    }
    return network;
  }

  public getBaseTokenAddresses(chainId: number): Set<string> {
    const network = this.getNetwork(chainId);
    return new Set(network.baseTokens.map(t => t.toLowerCase()));
  }

  /**
   * Get all supported networks
   * @returns Array of all network definitions
   */
  public getAllNetworks(): NetworkDefinition[] {
    return Array.from(this.networks.values());
  }

  /**
   * Get network by name
   * @param name Network name (e.g., 'Ethereum', 'Polygon')
   * @returns Network definition
   */
  public getNetworkByName(name: string): NetworkDefinition | undefined {
    for (const network of Array.from(this.networks.values())) {
      if (network.name.toLowerCase() === name.toLowerCase()) {
        return network;
      }
    }
    return undefined;
  }

  /**
   * Check if chain ID is supported
   * @param chainId Network chain ID
   * @returns True if chain is supported
   */
  public isChainSupported(chainId: number): boolean {
    return this.networks.has(chainId as ChainId);
  }

  /**
   * Get supported chain IDs
   * @returns Array of supported chain IDs
   */
  public getSupportedChainIds(): number[] {
    return Array.from(this.networks.keys());
  }

  /**
   * Get stablecoins for a network
   * @param chainId Network chain ID
   * @returns Array of stablecoins on this network
   */
  public getStablecoins(chainId: ChainId | number): Token[] {
    const network = this.getNetwork(chainId);
    return network.stablecoins;
  }

  /**
   * Get wrapped native token for a network
   * @param chainId Network chain ID
   * @returns Wrapped native token (WETH, WMATIC, etc.)
   */
  public getWrappedNative(chainId: ChainId | number) {
    const network = this.getNetwork(chainId);
    return network.wrappedNative;
  }

  /**
   * Get primary stablecoin for a network (USDC preferred)
   * @param chainId Network chain ID
   * @returns Primary stablecoin
   */
  public getPrimaryStablecoin(chainId: ChainId | number) {
    const network = this.getNetwork(chainId);
    // Prefer USDC, then USDT, then first. If those don't exist, return the first one
    return (
      network.stablecoins.find(s => s.symbol === 'USDC') ||
      network.stablecoins.find(s => s.symbol === 'USDT') ||
      network.stablecoins[0]
    );
  }

  /**
   * Get block explorer URL for a token
   * @param chainId Network chain ID
   * @param tokenAddress Token contract address
   * @returns Full block explorer URL for the. token
   */
  public getTokenExplorerUrl(chainId: ChainId | number, tokenAddress: string): string {
    const network = this.getNetwork(chainId);
    return `${network.blockExplorer.tokenUrl}${tokenAddress}`;
  }

  /**
   * Get configuration status
   */
  public getStatus(): {
    supportedChains: number[];
    chainNames: string[];
  } {
    return {
      supportedChains: this.getSupportedChainIds(),
      chainNames: Array.from(this.networks.values()).map(n => n.name),
    };
  }
}

// Export singleton instance
export const networkConfig = NetworkConfig.getInstance();

// Also export the class for testing
export { NetworkConfig };
