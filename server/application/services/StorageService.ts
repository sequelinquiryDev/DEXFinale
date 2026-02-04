import fs from 'fs/promises';
import path from 'path';
import { getAddress } from 'ethers';
import { Token } from '../../domain/entities';
import { PoolRegistry, QuarantineRegistry } from '../../domain/types';

function normalizeAddress(address: string): string {
  try {
    return getAddress(address);
  } catch {
    return address.toLowerCase();
  }
}

const DATA_DIR = path.join(process.cwd(), 'server', 'data');

export class StorageService {
  async read(fileName: string): Promise<any> {
    try {
      const filePath = path.join(DATA_DIR, fileName);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return fileName.startsWith('tokens_') ? [] : {};
      }
      throw error;
    }
  }

  async write(fileName: string, data: any): Promise<void> {
    const filePath = path.join(DATA_DIR, fileName);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async getTokensByNetwork(chainId: number): Promise<Token[]> {
    const fileName = `tokens_${chainId === 1 ? 'ethereum' : 'polygon'}.json`;
    try {
      const tokens = await this.read(fileName) as any[];
      if (!Array.isArray(tokens)) return [];

      return tokens
        .map((token) => {
          if (!token || !token.address) return null;
          const metadata = token.metadata || token;
          return {
            address: normalizeAddress(token.address),
            name: metadata.name,
            symbol: metadata.symbol,
            decimals: metadata.decimals,
            chainId: chainId,
            logoURI: metadata.logoURI || '',
            logoFetchedAt: metadata.logoFetchedAt,
          } as Token;
        })
        .filter((t): t is Token => t !== null);
    } catch (e) {
      console.error(`Error reading tokens for chain ${chainId}:`, e);
      return [];
    }
  }

  async saveTokensByNetwork(chainId: number, tokens: Token[]): Promise<void> {
    const fileName = `tokens_${chainId === 1 ? 'ethereum' : 'polygon'}.json`;
    await this.write(fileName, tokens);
  }

  async getPoolRegistry(chainId: number): Promise<PoolRegistry> {
    const fileName = `pool-registry_${chainId === 1 ? 'ethereum' : 'polygon'}.json`;
    const data = await this.read(fileName);
    if (!data.pools) data.pools = {};
    if (!data.pricingRoutes) data.pricingRoutes = {};
    return data as PoolRegistry;
  }

  async savePoolRegistry(chainId: number, registry: PoolRegistry): Promise<void> {
    const fileName = `pool-registry_${chainId === 1 ? 'ethereum' : 'polygon'}.json`;
    await this.write(fileName, registry);
  }

  async getQuarantineRegistry(chainId: number): Promise<QuarantineRegistry> {
    const fileName = `quarantine-registry_${chainId === 1 ? 'ethereum' : 'polygon'}.json`;
    const data = await this.read(fileName);
    if (!data.entries) data.entries = {};
    return data as QuarantineRegistry;
  }

  async saveQuarantineRegistry(chainId: number, registry: QuarantineRegistry): Promise<void> {
    const fileName = `quarantine-registry_${chainId === 1 ? 'ethereum' : 'polygon'}.json`;
    await this.write(fileName, registry);
  }

  async promoteQuarantineToken(chainId: number, tokenAddress: string, cacheLayer?: any): Promise<void> {
    const quarantine = await this.getQuarantineRegistry(chainId);
    const entry = quarantine.entries[tokenAddress];
    if (!entry) return;

    const tokens = await this.getTokensByNetwork(chainId);
    if (!tokens.some((t) => t.address === tokenAddress)) {
      tokens.push({
        address: tokenAddress,
        name: entry.metadata.name,
        symbol: entry.metadata.symbol,
        decimals: entry.metadata.decimals,
        chainId: chainId,
        logoURI: entry.metadata.logoURI || '',
        logoFetchedAt: entry.metadata.logoFetchedAt,
      });
    }

    entry.promoted = true;
    await this.saveTokensByNetwork(chainId, tokens);
    await this.saveQuarantineRegistry(chainId, quarantine);

    if (cacheLayer) {
      cacheLayer.invalidateTokenCache(chainId);
    }
  }

  async removeFromQuarantine(chainId: number, tokenAddress: string): Promise<void> {
    const quarantine = await this.getQuarantineRegistry(chainId);
    if (quarantine.entries[tokenAddress]) {
      delete quarantine.entries[tokenAddress];
      await this.saveQuarantineRegistry(chainId, quarantine);
    }
  }
}

export const storageService = new StorageService();
