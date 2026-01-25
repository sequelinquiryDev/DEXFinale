import { sharedStateCache } from './SharedStateCache';

export class RoutingEngine {
  /**
   * Finds all possible trading routes between two tokens.
   * @param tokenIn The address of the input token.
   * @param tokenOut The address of the output token.
   * @param maxDepth The maximum number of hops in a route.
   * @returns An array of possible routes, where each route is an array of token addresses.
   */
  public findRoutes(tokenIn: string, tokenOut: string, maxDepth: number = 3): string[][] {
    const routes: string[][] = [];
    const queue: { token: string; path: string[] }[] = [{ token: tokenIn, path: [tokenIn] }];
    const visited = new Set<string>([tokenIn]);

    while (queue.length > 0) {
      const { token, path } = queue.shift()!;

      if (path.length > maxDepth) {
        continue;
      }

      const pools = sharedStateCache.getPoolsForToken(token);

      for (const pool of pools) {
        const otherToken = pool.token0 === token ? pool.token1 : pool.token0;

        if (otherToken === tokenOut) {
          routes.push([...path, tokenOut]);
        }

        if (otherToken && !visited.has(otherToken)) {
          visited.add(otherToken);
          queue.push({ token: otherToken, path: [...path, otherToken] });
        }
      }
    }

    return routes;
  }
}
