import type { Express } from "express";
import { type Server } from "http";
import { api } from "../shared/routes.ts";
import { priceViewerService } from "./application/services/PriceViewerService.ts";
import { SwapController } from "./application/services/SwapController.ts";

export async function registerRoutes(
  app: Express,
  priceViewerService: any,
  swapController: any,
): Promise<Server> {

  app.get(api.tokens.getAll.path, async (_req, res) => {
    try {
      const tokens = await app.locals.storageService.read('tokens.json');
      res.json({ tokens });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post(api.quote.get.path, async (req, res) => {
    try {
      const { tokenIn, tokenOut, amount } = req.body;

      if (!tokenIn || !tokenOut || !amount) {
        return res.status(400).json({ message: "Missing required parameters" });
      }

      const quote = await swapController.getQuote(tokenIn, tokenOut, amount);
      res.json(quote);

    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get(`${api.snapshots.getLatest.path}/:chain`, async (req, res) => {
    try {
      const tokenAddresses = req.body.tokens;
      const chain = Number(req.params.chain);
      if (!tokenAddresses) {
        return res.status(400).json({ message: "Missing required parameter: tokens" });
      }
      const prices = priceViewerService.getSnapshots(tokenAddresses, chain);
      res.json(prices);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return app;
}
