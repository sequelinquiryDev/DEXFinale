import type { Express } from "express";
import { api } from "../shared/routes.ts";
import { priceViewerService } from "./application/services/PriceViewerService.ts";
import { SwapController } from "./application/services/SwapController.ts";
import { sharedStateCache } from "./application/services/SharedStateCache.ts";
import { MarketViewerService, createMarketViewerService } from "./application/services/MarketViewerService.ts";
import { getApiCallLogger } from "./infrastructure/logging/ApiCallLogger.ts";
import type { QuoteResponse, SwapQuote, MarketOverview } from "../shared/schema.ts";

export async function registerRoutes(
  app: Express,
  priceViewerService: any,
  swapController: any,
): Promise<Express> {
  // Initialize services
  const marketViewerService = createMarketViewerService(app.locals.storageService);
  const apiLogger = getApiCallLogger();

  app.get(api.tokens.getAll.path, async (req, res) => {
    try {
      // Get chainId from query parameter (default to Polygon if not specified)
      const chainId = req.query.chainId ? Number(req.query.chainId) : 137;
      
      // COLD PATH: Fetch tokens and attach pool metadata
      const tokens = await app.locals.storageService.getTokensByNetwork(chainId);
      const poolRegistry = await app.locals.storageService.getPoolRegistry(chainId);
      
      // Attach pricing pools to each token (cold path responsibility)
      const tokensWithPools = tokens.map(token => ({
        ...token,
        pricingPools: poolRegistry.pricingRoutes[token.address.toLowerCase()] || [],
      }));
      
      res.json({ tokens: tokensWithPools, chainId });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // MARKET VIEWER ENDPOINTS
  
  /**
   * GET /api/market/overview?chainId=1
   * Get market overview for all tokens on a network
   * Returns: MarketOverview with all tokens and aggregate metrics
   */
  app.get('/api/market/overview', async (req, res) => {
    try {
      const chainId = req.query.chainId ? Number(req.query.chainId) : 137;
      
      const startTime = Date.now();
      const overview = await marketViewerService.getMarketOverview(chainId);
      const durationMs = Date.now() - startTime;
      
      apiLogger.logSuccess('MarketViewer', `/api/market/overview`, chainId, durationMs, {
        requestedBy: 'Dashboard',
        purpose: 'market-overview',
      });
      
      res.json(overview);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching market overview" });
    }
  });

  /**
   * GET /api/market/token/:tokenAddress?chainId=1
   * Get detailed market data for a single token
   * Returns: TokenMarketData with price, liquidity, volume, and data source attribution
   */
  app.get('/api/market/token/:tokenAddress', async (req, res) => {
    try {
      const { tokenAddress } = req.params;
      const chainId = req.query.chainId ? Number(req.query.chainId) : 137;
      const forceRefresh = req.query.forceRefresh === 'true';
      
      const startTime = Date.now();
      const marketData = await marketViewerService.getTokenMarketData(
        tokenAddress,
        chainId,
        { forceRefresh }
      );
      const durationMs = Date.now() - startTime;
      
      apiLogger.logSuccess('MarketViewer', `/api/market/token/${tokenAddress}`, chainId, durationMs, {
        requestedBy: 'TokenDetails',
        purpose: `token-market-data`,
        cached: !forceRefresh,
      });
      
      res.json(marketData);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching token market data" });
    }
  });

  /**
   * GET /api/market/search?q=USDC&chainId=1
   * Search for tokens by symbol, name, or address
   * Returns: TokenSearchResult[] - matching tokens sorted by relevance
   */
  app.get('/api/market/search', async (req, res) => {
    try {
      const query = req.query.q as string;
      const chainId = req.query.chainId ? Number(req.query.chainId) : 137;
      
      if (!query || query.length === 0) {
        return res.status(400).json({ message: "Search query required (q parameter)" });
      }
      
      const startTime = Date.now();
      const results = await marketViewerService.searchTokens(query, chainId);
      const durationMs = Date.now() - startTime;
      
      apiLogger.logSuccess('MarketViewer', `/api/market/search?q=${query}`, chainId, durationMs, {
        requestedBy: 'TokenSelector',
        purpose: 'token-search',
      });
      
      res.json(results);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error searching tokens" });
    }
  });

  /**
   * GET /api/market/cache/status
   * Get cache statistics for debugging and monitoring
   * Returns: Cache status info
   */
  app.get('/api/market/cache/status', async (req, res) => {
    try {
      const status = marketViewerService.getCacheStatus();
      res.json(status);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error getting cache status" });
    }
  });

  /**
   * DELETE /api/market/cache
   * Clear market viewer cache (for testing/manual refresh)
   */
  app.delete('/api/market/cache', async (req, res) => {
    try {
      marketViewerService.clearCache();
      res.json({ message: "Cache cleared successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error clearing cache" });
    }
  });

  // SWAPPER ENDPOINTS
  
  /**
   * POST /api/swap/quote
   * Get quote for a swap
   * Request: { tokenIn, tokenOut, amountIn, chainId }
   * Returns: QuoteResponse with route and amount details
   */
  app.post('/api/swap/quote', async (req, res) => {
    try {
      const { tokenIn, tokenOut, amountIn, chainId } = req.body;

      if (!tokenIn || !tokenOut || !amountIn) {
        return res.status(400).json({ message: "Missing required parameters: tokenIn, tokenOut, amountIn" });
      }

      const startTime = Date.now();
      const quote = await swapController.getQuote(tokenIn, tokenOut, amountIn);
      const durationMs = Date.now() - startTime;
      
      const chainIdValue = chainId || 137;
      apiLogger.logSuccess('SwapController', `/api/swap/quote`, chainIdValue, durationMs, {
        requestedBy: 'SwapInterface',
        purpose: 'quote',
      });

      const response: QuoteResponse = {
        success: quote !== null,
        quote: quote
          ? {
              tokenIn,
              tokenOut,
              amountIn,
              ...(quote.route && { route: quote.route }),
              ...(quote.amountOut && { amountOut: quote.amountOut }),
              ...(quote.distribution && { distribution: quote.distribution }),
              ...(quote.finalAmountOut && { finalAmountOut: quote.finalAmountOut }),
              timestamp: Date.now(),
              chainId: chainIdValue,
            }
          : undefined,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(error);
      res.status(500).json({
        success: false,
        error: errorMsg,
        timestamp: Date.now(),
      });
    }
  });

  app.post(`${api.snapshots.getLatest.path}/:chain`, async (req, res) => {
    try {
      const tokenAddresses = req.body.tokens;
      const chain = Number(req.params.chain);
      if (!tokenAddresses || !Array.isArray(tokenAddresses)) {
        return res.status(400).json({ message: "Missing required parameter: tokens (must be an array)" });
      }
      const prices = priceViewerService.getSnapshots(tokenAddresses, chain);
      res.json(prices);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Test endpoint to populate mock pool data for UI testing
  app.post('/api/test/populate-pools', async (req, res) => {
    try {
      // Polygon USDC address
      const USDC = '0x2791Bca1f2de4661ED88A30C99a7a9449Aa84174';
      // Polygon WETH address
      const WETH = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619';
      // Polygon WMATIC address
      const WMATIC = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
      // Polygon USDT address
      const USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';

      // Mock pool: USDC-WETH
      sharedStateCache.setPoolState('0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640', {
        address: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
        token0: USDC,
        token1: WETH,
        liquidity: BigInt('1000000000000000000000'),
        sqrtPriceX96: BigInt('1766847064778384329583297500742918515827483896875618543824'),
        fee: 3000,
        timestamp: Math.floor(Date.now() / 1000),
      });

      // Mock pool: WMATIC-USDC
      sharedStateCache.setPoolState('0xA374094527e1673A86dE625aa59517c5dE346d32', {
        address: '0xA374094527e1673A86dE625aa59517c5dE346d32',
        token0: WMATIC,
        token1: USDC,
        liquidity: BigInt('500000000000000000000'),
        sqrtPriceX96: BigInt('1000000000000000000000'),
        fee: 3000,
        timestamp: Math.floor(Date.now() / 1000),
      });

      // Mock pool: WETH-USDT
      sharedStateCache.setPoolState('0x781067Ef296E5C4A4203F81C593274824b7C185d', {
        address: '0x781067Ef296E5C4A4203F81C593274824b7C185d',
        token0: WETH,
        token1: USDT,
        liquidity: BigInt('800000000000000000000'),
        sqrtPriceX96: BigInt('1500000000000000000000'),
        fee: 3000,
        timestamp: Math.floor(Date.now() / 1000),
      });

      // Set token metadata
      sharedStateCache.setTokenMetadata(USDC, { symbol: 'USDC', name: 'USD Coin', decimals: 6 });
      sharedStateCache.setTokenMetadata(WETH, { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 });
      sharedStateCache.setTokenMetadata(WMATIC, { symbol: 'WMATIC', name: 'Wrapped Matic', decimals: 18 });
      sharedStateCache.setTokenMetadata(USDT, { symbol: 'USDT', name: 'Tether USD', decimals: 6 });

      res.json({ message: 'Mock pools populated successfully', poolsCount: 3 });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error populating test data" });
    }
  });

  /**
   * GET /api/logs/status
   * Get API call logging statistics (for debugging/monitoring)
   */
  app.get('/api/logs/status', (req, res) => {
    try {
      const stats = apiLogger.getStats();
      res.json(stats);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error getting logs" });
    }
  });

  /**
   * GET /api/logs/recent
   * Get recent API call logs
   */
  app.get('/api/logs/recent', (req, res) => {
    try {
      const count = req.query.count ? Number(req.query.count) : 50;
      const logs = apiLogger.getRecentLogs(count);
      res.json(logs);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error getting recent logs" });
    }
  });

  return app;
}
