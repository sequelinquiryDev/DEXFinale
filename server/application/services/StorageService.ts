import fs from 'fs/promises';
import path from 'path';
import { Token, Pool } from '../../domain/entities';

const DATA_DIR = path.join(process.cwd(), 'data');

export class StorageService {
  async read(fileName: string): Promise<any> {
    try {
      const filePath = path.join(DATA_DIR, fileName);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, return default value for the specific file
        if (fileName.startsWith('pools_')) {
          return {};
        } else if (fileName === 'tokens.json') {
          return [];
        }
      }
      throw error;
    }
  }

  async write(fileName: string, data: any): Promise<void> {
    const filePath = path.join(DATA_DIR, fileName);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async getTokens(): Promise<Token[]> {
    return await this.read('tokens.json') as Token[];
  }

  async savePools(pools: Pool[], chainId: number): Promise<void> {
    const fileName = `pools_${chainId === 1 ? 'ethereum' : 'polygon'}.json`;
    const existingPools = await this.read(fileName);

    pools.forEach(pool => {
      const poolKey = `${pool.token0.address}_${pool.token1.address}`;
      existingPools[poolKey] = pool.address;
    });

    await this.write(fileName, existingPools);
  }
}
