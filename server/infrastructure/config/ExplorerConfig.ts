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
      ETHERSCAN: process.env.ETHERSCAN_API_KEY,
      POLYGONSCAN: process.env.POLYGONSCAN_API_KEY || process.env.ETHERSCAN_API_KEY,
    };

    // Warn for missing keys
    for (const [name, key] of Object.entries(explorerKeys)) {
      if (!key) console.warn(`${name}_API_KEY not set. Some explorer API features may be limited.`);
    }

    // Ethereum Mainnet - Etherscan
    this.explorers.set(1, {
      name: "Etherscan",
      baseUrl: "https://api.etherscan.io/api",
      apiKey: explorerKeys.ETHERSCAN || "",
      endpoints: {
        tokenInfo: "https://etherscan.io/token/",
        tokenHolders: "https://etherscan.io/token/",
        transactionHistory: "https://etherscan.io/tx/",
      },
    });

    // Polygon Mainnet - PolygonScan
    this.explorers.set(137, {
      name: "PolygonScan",
      baseUrl: "https://api.polygonscan.com/api",
      apiKey: explorerKeys.POLYGONSCAN || "",
      endpoints: {
        tokenInfo: "https://polygonscan.com/token/",
        tokenHolders: "https://polygonscan.com/token/",
        transactionHistory: "https://polygonscan.com/tx/",
      },
    });

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