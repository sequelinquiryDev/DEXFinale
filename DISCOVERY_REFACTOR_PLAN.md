### **`DISCOVERY_REFACTOR_PLAN.md`**

#### **1. Objective**

The primary objective of this refactoring is to address a critical design limitation in the `TokenDiscoveryManager`. The current implementation fails to create pricing routes for tokens that do not have a direct liquidity pool with a small, hardcoded set of primary base tokens (USDC, WETH, etc.).

This plan will overhaul the discovery and pricing logic to enable robust, multi-hop route finding, ensuring that any token with a viable pricing path through the known liquidity pools can be correctly priced.

#### **2. Guiding Principles & Absolute Rules**

This operation will be governed by the following strict rules, as mandated:

1.  **No Assumptions:** I will not make assumptions about the codebase. If a component's function or location is unclear, I will analyze the code until its purpose is certain and document my findings. I will not guess.
2.  **No Stubs or Simplifications:** All code modifications will be complete and production-ready. No `// TODO`, placeholder logic, or simplified implementations will be used.
3.  **Comprehensive Analysis & No Duplication:** Before editing any file, I will conduct a thorough analysis of all related files and dependencies. This is to ensure a deep understanding of the impact of my changes, to avoid duplicating existing logic, and to maintain a cohesive architecture.
4.  **Atomic & Documented Changes:** Each file modification will be a discrete, logical step. This document will be updated *immediately* after every file write, detailing the exact change, its rationale, and how it was validated.
5.  **Living Document & Checklist:** This document is the active journal for this task. The checklist at the end will be updated in real-time to reflect the current status of the operation.

#### **3. Detailed Implementation Plan**

This refactoring is a precise, multi-phase operation targeting the core of the application's pricing logic.

---

**Phase 1: Redefine the `PoolRegistry` Data Structure**

*   **File to Edit:** `server/domain/types.ts`
*   **Analysis:** The current `PoolRegistry` type uses a `pricingRoutes` object that maps a token address to a flat array of `PricingRoute` objects. This structure is inefficient for looking up routes by a specific base currency and does not facilitate multi-hop calculations.
*   **Exact Edit:** I will redefine the `pricingRoutes` property within the `PoolRegistry` interface.
    *   **From:**
        ```typescript
        pricingRoutes: { [tokenAddress: string]: PricingRoute[] };
        ```
    *   **To:**
        ```typescript
        pricingRoutes: {
          [tokenAddress: string]: {
            [baseSymbol: string]: string[]; // Array of pool addresses
          }
        };
        ```
    I will also delete the now-obsolete `PricingRoute` interface.
*   **Affected Dependencies:** This is a foundational change that will intentionally cause type errors across the application, which subsequent phases will resolve. The files that will be immediately affected by this change are:
    *   `server/application/services/TokenDiscoveryManager.ts`
    *   `server/application/services/MarketViewerService.ts`
    *   `server/application/services/SpotPricingEngine.ts`
    *   `server/controllers/PoolController.ts`
    *   `server/application/services/StorageService.ts`

---

**Phase 2: Refactor the `TokenDiscoveryManager`**

*   **File to Edit:** `server/application/services/TokenDiscoveryManager.ts`
*   **Analysis:** This is the heart of the discovery logic. The `discoverPoolsForTokens` method iterates through tokens, while `addPoolToRegistry` populates the registry. The current logic finds all pairs at once and does not group them by the base token.
*   **Exact Edits:** I will rewrite the core discovery loop and the registry population logic.
    1.  The `discoverPoolsForTokens` method will be updated to orchestrate a per-base-token discovery process.
    2.  The `addPoolToRegistry` function will be completely rewritten to populate the new nested `pricingRoutes` structure.
    3.  The new logic will operate as follows:
        *   For each token being discovered, I will iterate through the `BASE_TOKENS` list for the corresponding chain.
        *   For each `baseToken` in the list, I will execute a specific subgraph query to find pools pairing the `tokenToDiscover` with that `baseToken`.
        *   I will apply the 90% liquidity filter *only to the pools found for that specific pair* (e.g., just the `XYZ/USDC` pools).
        *   The pools that pass this filter will be stored under the new `pricingRoutes` structure (e.g., `registry.pricingRoutes[tokenAddress][baseSymbol] = [pool1, pool2]`).
        *   This ensures that we capture the best pools for *each available pricing path* instead of lumping them all together.

---

**Phase 3: Update Services to Use the New `pricingRoutes` Structure**

*   **Files to Edit:**
    *   `server/application/services/MarketViewerService.ts`
    *   `server/application/services/SpotPricingEngine.ts`
*   **Analysis:** These services consume the `PoolRegistry`. `MarketViewerService` is responsible for the "hot path" logic that finds a price for a token on demand. `SpotPricingEngine` performs the final price calculation.
*   **Exact Edits:**
    *   **In `MarketViewerService.ts`:** I will refactor the `findBestPoolForToken` function (or its equivalent). Instead of iterating a flat list, it will now directly access routes for preferred base currencies using the new structure (e.g., `registry.pricingRoutes[tokenAddress]['USDC']`). This makes the lookup more efficient and explicit.
    *   **In `SpotPricingEngine.ts`:** I will overhaul the `computePriceFromPool` (or equivalent) logic. The service will now be able to implement the documented multi-hop strategy correctly.
        1.  It will first attempt to find a pricing path to a primary stablecoin (USDC, USDT).
        2.  If no direct primary route exists, it will search for a route against `WETH`.
        3.  If a `TOKEN/WETH` route is found, it will then use the registry *again* to find the best `WETH/USDC` pool.
        4.  Finally, it will call the `computeMultiHopPrice` function with the two required pools to get the final price. This implements the intended but previously non-functional multi-hop capability.

---

**Phase 4: Adapt Controller and Storage Layers**

*   **Files to Edit:**
    *   `server/controllers/PoolController.ts`
    *   `server/application/services/StorageService.ts`
*   **Analysis:** These are the final pieces that need to be aligned with the new data structure. The controller is the API entry point, and the storage service handles persistence.
*   **Exact Edits:**
    *   **In `StorageService.ts`:** I will verify that the `getPoolRegistry` and `savePoolRegistry` methods correctly serialize and deserialize the new `PoolRegistry` object structure to and from the JSON files. The change is primarily in the in-memory type definition, so minimal logic changes are expected here, but verification is critical.
    *   **In `PoolController.ts`:** I will adjust the `handleTokenInterest` function. It needs to correctly interpret the output from the refactored `MarketViewerService` and format the API response. The controller's responsibility is to be the clean interface to the outside world, so it must adapt to the new, richer data provided by the service layer.

---

#### **4. Validation Strategy**

I will perform rigorous validation at each step.

1.  **Post-Phase 1:** I will run `npm test` to confirm that type errors have appeared in all the expected files. This confirms the change has propagated correctly.
2.  **Post-Phase 2:** After refactoring the `TokenDiscoveryManager`, I will clear the registries and re-run the discovery process. I will then manually inspect the generated `.json` files to confirm:
    *   The `pricingRoutes` object has the new nested structure: `{ "tokenAddress": { "USDC": [...], "WETH": [...] } }`.
    *   Tokens that previously had no routes now have them.
3.  **Post-Phase 3 & 4:** With the full flow refactored, I will conduct end-to-end tests using `curl`:
    *   **Test Case 1 (Direct Route):** Request the price of a token with a direct USDC pool. I expect a successful price calculation using a single hop.
    *   **Test Case 2 (Multi-Hop Route):** Request the price of a token that has **only** a WETH pool. I expect a successful price calculation by hopping through `TOKEN -> WETH -> USDC`. This is the critical test case that is currently failing.
    *   **Test Case 3 (No Route):** Request the price of a token with no viable pools. I expect a graceful "insufficient data" error, not a system crash.

---

#### **5. Implementation Checklist**

*   [ ] **Phase 1: Data Structure Redefinition**
    *   [ ] Read `server/domain/types.ts`.
    *   [ ] Redefine the `PoolRegistry.pricingRoutes` interface.
    *   [ ] Delete the `PricingRoute` interface.
    *   [ ] Write the updated `server/domain/types.ts` file.
    *   [ ] **Validation:** Run tests and confirm type errors appear in expected dependent files.
*   [ ] **Phase 2: Discovery Logic Refactoring**
    *   [ ] Read `server/application/services/TokenDiscoveryManager.ts`.
    *   [ ] Rewrite `discoverPoolsForTokens` and `addPoolToRegistry` to use the new per-base-token discovery logic.
    *   [ ] Write the updated `server/application/services/TokenDiscoveryManager.ts` file.
    *   [ ] **Validation:** Clear registries, run discovery, and inspect the generated `.json` files for the correct structure and data.
*   [ ] **Phase 3: Core Pricing Logic Refactoring**
    *   [ ] Read `server/application/services/MarketViewerService.ts`.
    *   [ ] Refactor `findBestPoolForToken` (or equivalent) to use the new `pricingRoutes` structure.
    *   [ ] Write the updated `server/application/services/MarketViewerService.ts` file.
    *   [ ] Read `server/application/services/SpotPricingEngine.ts`.
    *   [ ] Refactor the core price computation logic to enable multi-hop pricing.
    *   [ ] Write the updated `server/application/services/SpotPricingEngine.ts` file.
*   [ ] **Phase 4: Adapt Controller and Storage Layers**
    *   [ ] Read `server/application/services/StorageService.ts`.
    *   [ ] Verify and update `getPoolRegistry` and `savePoolRegistry` for the new data structure.
    *   [ ] Write the updated `server/application/services/StorageService.ts` file.
    *   [ ] Read `server/controllers/PoolController.ts`.
    *   [ ] Update `handleTokenInterest` to align with the new service layer response.
    *   [ ] Write the updated `server/controllers/PoolController.ts` file.
*   [ ] **Final Validation**
    *   [ ] Perform end-to-end `curl` tests for direct, multi-hop, and no-route scenarios.
    *   [ ] Document all results.
