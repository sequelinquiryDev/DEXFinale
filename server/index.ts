import express from 'express';
import { registerRoutes } from './routes.ts';
import { EthersAdapter } from './infrastructure/adapters/EthersAdapter';
import { DiscoveryService } from './application/services/DiscoveryService';
import { StorageService } from './application/services/StorageService';
import http from 'http';
import { priceViewerService } from './application/services/PriceViewerService.ts';
import { sharedStateCache } from './application/services/SharedStateCache.ts';
import { SwapController } from './application/services/SwapController.ts';

const app = express();
const server = http.createServer(app);

// Replace body-parser with express.json()
app.use(express.json());
app.use(express.static('dist/public'));

// Provide public RPC fallbacks for resilience
const { ALCHEMY_API_KEY, INFURA_API_KEY, POLYGON_RPC_URL } = process.env;

if (!INFURA_API_KEY) {
  console.warn(
    'INFURA_API_KEY not found, using public RPC. This may result in rate-limiting.'
  );
}
if (!ALCHEMY_API_KEY) {
  console.warn(
    'ALCHEMY_API_KEY not found, using public RPC. This may result in rate-limiting.'
  );
}
if (!POLYGON_RPC_URL) {
  console.warn(
    'POLYGON_RPC_URL not found, using public RPC. This may result in rate-limiting.'
  );
}

const ethProviders = [
  `https://mainnet.infura.io/v3/${INFURA_API_KEY || '84842078b09946638c03157f83405213'}`,
  `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY || 'demo'}`,
];

const polygonProviders = [
  POLYGON_RPC_URL || 'https://polygon-rpc.com',
];

const rpcProviders: { [chainId: number]: string } = {
  1: ethProviders[0],
  137: polygonProviders[0],
};

const ethersAdapter = new EthersAdapter(rpcProviders);
const storageService = new StorageService();

app.locals.storageService = storageService;

const discoveryService = new DiscoveryService(storageService, ethersAdapter);

// Run pool discovery in the background
(async () => {
  try {
    await discoveryService.discoverAndPrimeCache();
    console.log('Initial pool discovery complete.');
  } catch (error) {
    console.error('Error during initial pool discovery:', error);
  }
})();

const swapController = new SwapController(sharedStateCache);

// Register the routes
registerRoutes(app, priceViewerService, swapController);

const port = process.env.PORT || 3002;
server.listen(port, () =>
  console.log(`Server is running on port ${port}`)
);
