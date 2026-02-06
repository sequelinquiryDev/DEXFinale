
import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import { RoutingEngine } from './RoutingEngine';
import { TradeSimulator } from './TradeSimulator';

export interface TradeExecutionPlan {
  finalAmountOut: string;
  distribution: {
    route: string[];
    amount: string;
  }[];
}

export class SwapController {
  private routingEngine: RoutingEngine;
  private tradeSimulator: TradeSimulator;

  constructor(ethersAdapter: EthersAdapter) {
    this.routingEngine = new RoutingEngine(ethersAdapter);
    this.tradeSimulator = new TradeSimulator(ethersAdapter);
  }

  public async getQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    chainId: number
  ): Promise<{ route?: string[]; amountOut?: string; distribution?: any } | null> {
    
    const routes = await this.routingEngine.findRoutes(tokenIn, tokenOut, chainId);
    if (routes.length === 0) {
      return null; // No routes found
    }

    const amountInBI = BigInt(amountIn);

    if (routes.length === 1) {
      const amountOut = await this.tradeSimulator.simulatePath(routes[0], amountInBI, chainId);
      if (!amountOut) {
        return null;
      }
      return {
        route: routes[0],
        amountOut: amountOut.toString(),
      };
    }

    const plan = await this.findOptimalSplit(routes, amountInBI, chainId);
    if (!plan) {
      return null;
    }

    return plan;
  }

  private async findOptimalSplit(
    routes: string[][],
    amountIn: bigint,
    chainId: number
  ): Promise<TradeExecutionPlan | null> {
    if (routes.length === 0) {
      return null;
    }

    const allocations: bigint[] = routes.map(() => 0n);
    const incrementSize = amountIn / BigInt(100); 

    if (incrementSize === 0n) {
      const amountOut = await this.tradeSimulator.simulatePath(routes[0], amountIn, chainId);
      if (!amountOut) {
        return null;
      }
      return {
        finalAmountOut: amountOut.toString(),
        distribution: [{ route: routes[0], amount: amountIn.toString() }],
      };
    }

    let remainingAmount = amountIn;

    while (remainingAmount > 0n) {
      const allocAmount = remainingAmount < incrementSize ? remainingAmount : incrementSize;
      let bestRouteIdx = -1;
      let bestMarginalOutput = -1n;

      for (let i = 0; i < routes.length; i++) {
        const currentAllocation = allocations[i];
        const testAllocation = currentAllocation + allocAmount;
        
        const [currentOutput, nextOutput] = await Promise.all([
            currentAllocation > 0n ? this.tradeSimulator.simulatePath(routes[i], currentAllocation, chainId) : Promise.resolve(0n),
            this.tradeSimulator.simulatePath(routes[i], testAllocation, chainId)
        ]);

        if (nextOutput) {
          const marginalOutput = nextOutput - (currentOutput || 0n);
          if (marginalOutput > bestMarginalOutput) {
            bestMarginalOutput = marginalOutput;
            bestRouteIdx = i;
          }
        }
      }

      if (bestRouteIdx !== -1) {
        allocations[bestRouteIdx] += allocAmount;
        remainingAmount -= allocAmount;
      } else {
        // No profitable route found for this increment, so break.
        break;
      }
    }

    let totalAmountOut = 0n;
    const distribution: { route: string[]; amount: string; output: string }[] = [];

    for (let i = 0; i < routes.length; i++) {
      if (allocations[i] > 0n) {
        const output = await this.tradeSimulator.simulatePath(routes[i], allocations[i], chainId);
        if (output) {
          distribution.push({
            route: routes[i],
            amount: allocations[i].toString(),
            output: output.toString(),
          });
          totalAmountOut += output;
        }
      }
    }

    if (distribution.length === 0) {
      return null;
    }

    return {
      finalAmountOut: totalAmountOut.toString(),
      distribution,
    };
  }
}
