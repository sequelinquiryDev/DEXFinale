import { ChainId, networkConfig } from "./NetworkConfig";

export interface ExplorerApi {
  name: string;
  baseUrl: string;
  apiKey: string;
  endpoints: {
    tokenInfo: string;
    tokenHolders: string;
    transactionHistory: string;
  };
}

class ExplorerConfig {
  private static instance: ExplorerConfig;
  private explorers: Map<number, ExplorerApi> = new Map();
  private initialized = false;

  private constructor() {}

  public static getInstance(): ExplorerConfig {
    if (!ExplorerConfig.instance) {
      ExplorerConfig.instance = new ExplorerConfig();
    }
    if (!ExplorerConfig.instance.initialized) {
      ExplorerConfig.instance.initializeExplorers();
      ExplorerConfig.instance.initialized = true;
    }
    return ExplorerConfig.instance;
  }

  private initializeExplorers(): void {
    // Centralized API key map
    const explorerKeys: Record<string, string | undefined> = {
      [ChainId.ETHEREUM]: process.env.ETHERSCAN_API_KEY,
      [ChainId.POLYGON]: process.env.POLYGONSCAN_API_KEY || process.env.ETHERSCAN_API_KEY,
    };

    // Warn for missing keys
    if (!explorerKeys[ChainId.ETHEREUM]) console.warn(`ETHERSCAN_API_KEY not set. Some explorer API features may be limited.`);
    if (!explorerKeys[ChainId.POLYGON]) console.warn(`POLYGONSCAN_API_KEY not set. Some explorer API features may be limited.`);

    const supportedChains = networkConfig.getSupportedChainIds();

    for (const chainId of supportedChains) {
      const network = networkConfig.getNetwork(chainId);
      if (!network) continue;

      const apiKey = explorerKeys[chainId] || "";
      // Construct the API base URL from the general block explorer URL
      // e.g., https://etherscan.io -> https://api.etherscan.io/api
      const apiUrl = network.blockExplorer.url.replace("//", "//api.") + "/api";

      this.explorers.set(chainId, {
        name: network.blockExplorer.name,
        baseUrl: apiUrl,
        apiKey: apiKey,
        endpoints: {
          tokenInfo: network.blockExplorer.tokenUrl, // From networkConfig
          tokenHolders: network.blockExplorer.tokenUrl, // From networkConfig
          transactionHistory: `${network.blockExplorer.url}/tx/`,
        },
      });
    }

    console.log(`✓ ExplorerConfig: Initialized ${this.explorers.size} block explorers`);
  }

  public reinitialize(): void {
    this.explorers.clear();
    this.initializeExplorers();
  }

  public getExplorer(chainId: number): ExplorerApi {
    const explorer = this.explorers.get(chainId);
    if (!explorer) throw new Error(`No block explorer configured for chain ${chainId}`);
    return explorer;
  }

  public getExplorerName(chainId: number): string {
    return this.getExplorer(chainId).name;
  }

  public getExplorerApiUrl(chainId: number): string {
    const explorer = this.getExplorer(chainId);
    return explorer.apiKey && explorer.apiKey.length > 0
      ? `${explorer.baseUrl}?apikey=${explorer.apiKey}`
      : explorer.baseUrl;
  }

  public getTokenUrl(chainId: number, tokenAddress: string): string {
    return `${this.getExplorer(chainId).endpoints.tokenInfo}${tokenAddress}`;
  }

  public getTransactionUrl(chainId: number, txHash: string): string {
    return `${this.getExplorer(chainId).endpoints.transactionHistory}${txHash}`;
  }

  public getSupportedChains(): number[] {
    return Array.from(this.explorers.keys());
  }

  public isChainSupported(chainId: number): boolean {
    return this.explorers.has(chainId);
  }

  public getAllExplorers(): Map<number, ExplorerApi> {
    return new Map(this.explorers);
  }

  public getStatus(): { explorers: { chainId: number; name: string }[] } {
    const explorers: { chainId: number; name: string }[] = [];
    this.explorers.forEach((explorer, chainId) => {
      explorers.push({ chainId, name: explorer.name });
    });
    return { explorers };
  }
}

// Singleton instance
export const explorerConfig = ExplorerConfig.getInstance();
export { ExplorerConfig };
