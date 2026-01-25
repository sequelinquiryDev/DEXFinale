import { RoutingEngine } from './RoutingEngine';
import { TradeSimulator } from './TradeSimulator';
import { sharedStateCache } from './SharedStateCache';

export class SwapController {
  private routingEngine: RoutingEngine;
  private tradeSimulator: TradeSimulator;

  constructor() {
    this.routingEngine = new RoutingEngine();
    this.tradeSimulator = new TradeSimulator();
  }

  /**
   * Finds the best trade and returns a quote.
   * @param tokenIn The address of the input token.
   * @param tokenOut The address of the output token.
   * @param amountIn The amount of the input token.
   * @returns The best quote found, including the route and output amount.
   */
  public async getQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: string
  ): Promise<{ route: string[]; amountOut: string } | null> {
    const routes = this.routingEngine.findRoutes(tokenIn, tokenOut);
    if (routes.length === 0) {
      return null; // No routes found
    }

    let bestRoute: string[] = [];
    let bestAmountOut = 0n;

    const amountInBI = BigInt(amountIn);

    for (const route of routes) {
      const amountOut = this.tradeSimulator.simulatePath(route, amountInBI);

      if (amountOut && amountOut > bestAmountOut) {
        bestAmountOut = amountOut;
        bestRoute = route;
      }
    }

    if (bestRoute.length === 0) {
      return null; // No viable routes found
    }

    return {
      route: bestRoute,
      amountOut: bestAmountOut.toString(),
    };
  }
}
