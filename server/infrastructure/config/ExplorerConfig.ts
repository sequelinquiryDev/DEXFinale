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
    const explorerKeys: Record<string, string | undefined> = {
      [ChainId.ETHEREUM]: process.env.ETHERSCAN_API_KEY,
      [ChainId.POLYGON]: process.env.POLYGONSCAN_API_KEY || process.env.ETHERSCAN_API_KEY,
    };

    if (!explorerKeys[ChainId.ETHEREUM]) console.warn(`ETHERSCAN_API_KEY not set. Some explorer API features may be limited.`);
    if (!explorerKeys[ChainId.POLYGON]) console.warn(`POLYGONSCAN_API_KEY not set. Some explorer API features may be limited.`);

    const supportedChains = networkConfig.getSupportedChainIds();

    for (const chainId of supportedChains) {
      const network = networkConfig.getNetwork(chainId);
      if (!network) continue;

      const apiKey = explorerKeys[chainId] || "";
      const apiUrl = network.blockExplorer.url.replace("//", "//api.") + "/api";

      this.explorers.set(chainId, {
        name: network.blockExplorer.name,
        baseUrl: apiUrl,
        apiKey: apiKey,
        endpoints: {
          // Correctly define API endpoints as query strings
          tokenInfo: `?module=contract&action=getsourcecode`,
          tokenHolders: `?module=token&action=tokenholderlist`,
          transactionHistory: `?module=account&action=txlist`,
        },
      });
    }

    console.log(`✓ ExplorerConfig: Initialized ${this.explorers.size} block explorers`);
  }

  public getExplorer(chainId: number): ExplorerApi {
    const explorer = this.explorers.get(chainId);
    if (!explorer) throw new Error(`No block explorer configured for chain ${chainId}`);
    return explorer;
  }

  public getTokenInfoUrl(chainId: number, tokenAddress: string): string {
    const explorer = this.getExplorer(chainId);
    return `${explorer.baseUrl}${explorer.endpoints.tokenInfo}&address=${tokenAddress}&apikey=${explorer.apiKey}`;
  }
  
  public getTransactionUrl(chainId: number, txHash: string): string {
    const network = networkConfig.getNetwork(chainId);
    return `${network.blockExplorer.url}/tx/${txHash}`;
  }
  
  // Other methods remain the same...
  public reinitialize(): void {
    this.explorers.clear();
    this.initializeExplorers();
  }

  public getExplorerName(chainId: number): string {
    return this.getExplorer(chainId).name;
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

export const explorerConfig = ExplorerConfig.getInstance();
export { ExplorerConfig };
