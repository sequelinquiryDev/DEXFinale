
import { spotPricingEngine } from './SpotPricingEngine';

class PriceViewerService {
  public getSnapshots(tokenAddresses: string[], chainId: number): Record<string, number | null> {
    const prices: Record<string, number | null> = {};
    for (const address of tokenAddresses) {
      prices[address] = spotPricingEngine.computeSpotPrice(address, chainId);
    }
    return prices;
  }
}

export const priceViewerService = new PriceViewerService();
