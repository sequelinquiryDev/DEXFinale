

Program Workflow Explanation

Goal: Maintain accurate pool and token data for spot pricing and swaps, using a combination of discovery, identity, topology, and state layers.


---

1️⃣ Discovery Layer (Token Discovery)

Source: External APIs like CoinGecko (or similar) to get new token addresses.

Responsibility: Identify new tokens on a network.

Workflow:

1. Fetch candidate token addresses.


2. filter by network support. 


3. Add to appropriate *_tokens.json file. 



Notes:

Discovery is decoupled from on-chain data.

Only updates when new tokens appear.

No heavy queries; external APIs handle metadata.




---

2️⃣ Identity Layer (Token Metadata)

Source: Blockchain explorers (Etherscan, Polygonscan).

Responsibility: Fetch token metadata (symbol, name, ticker, logo URL) on demand for quarantine or on startup for all the incomplete tokens in the relevant json.

Workflow:

0. At server startup, for tokens witha stale Timestamp or none-existent Timestamp in the relevant json file. 

1. Given a token address, query the explorer API.


2. Retrieve name, symbol, and other metadata.


3. Store in the appropriate *tokens.json file. Alongside a Timestamp identifier. 

_________LOGOS_______
Logo URL storage is part of the startup sequence, but the process of fetching the logo itself happens on demand on user request, logo gets cached and all further users requests will get the logo form the CacheLayer and send to the user so they can cache it in their browser. 


Notes:

Queries are limited; only fetch when necessary. Timestamps are important. 

Ensures the frontend can display token info without touching subgraphs or RPC calls.

Public fallbacks are necessary in this stage for identity specifically. 


---

3️⃣ Topology Layer (Pool Registry)

Source: custom subgraphs:

Ethereum → mine (indexes Uniswap V3, Uniswap V2, SushiSwap V2)

Polygon → mine-P (indexes SushiSwap V2, QuickSwap V2)


Responsibility: Determine which pools exist for each token and which ones to use for spot price calculation.

Workflow:

0. At server startup. 

1. For each token with stale registery timestamp or none-existent timestamp, query the network subgraph once.


2. Subgraph returns all pools from all factories it indexes.


3. For each pool:

Identify DEX type automatically via feeTier field:

Present → V3

Absent → V2


Determine base token (USDC, USDT, DAI, WETH).


4. Global filtering:

Combine all pools across base tokens and factories.

Apply a 90% liquidity filter, keep the top pools only.



6. Store results in PoolRegistry:

Stored in the appropriate registery file. 

Pools keyed by address, and their dex typ(V2/V3) 

pricingRoutes of token -> baseTokenSymbol = list of pool addresses.

Topology TTL timestamp per token, not per pool, not per pair. indicating that this specific token won't get requested form the subgraph in the incoming runs. 


Notes:

Polygon subgraph returns only V2 pools; V3 logic exists but isn’t used there.

The backend never queries individual factories directly — the subgraph abstracts this.

This allows 1 query per token per network for all pools.

---

4️⃣ State Layer (RPC / Infura / Alchemy)

Source: Ethereum or Polygon RPC providers.

Responsibility: Fetch real-time pool data (reserves, liquidity, fees, ticks) to calculate spot price or simulate routing swaps.

Workflow:

0- Upon User request, guarded and managed by many different services. 

1. Take info from registery.


2. Query on-chain data using RPC.


3. For spot price: use top pools for base tokens only, accuracy is imperative. 


4. For swapper: no topology is derived from the subgraphs all topology and state is derived from the RPC endpoint upon request, dynamically splitting routes to minimize slippage and maximize output.



Notes:

Spot price uses RPC only after topology filters pools.

Swapper may query multiple pools across multiple hops per swap.



---

5️⃣ System Summary

Discovery (Coingecko / external API) → finds new tokens.

Identity (Explorer APIs) → fetch logos and metadata. (alongside public fallback resources). 

Topology (Subgraphs) → discover pools for tokens. 


State (RPC) → fetch info to calculate:

Spot price (token ↔ base tokens from the top pools stored in the topology)

Swap execution (token ↔ token through best paths gotten from the RPC)




---

6️⃣ Special Notes

Polygon subgraph: only V2 pools, no V3 queries.

Ethereum subgraph: supports V2 + V3 pools.

No need for multiple queries per factory. Subgraph returns all relevant pools.

Topology filters prevent storing millions of pools; only pools contributing to 90% liquidity are retained.

Token Registeries only store the pools requested by the tokens files when needed at startup. 

Spot viewer and swapper branch here:

Spot viewer uses topology(subgraph) → state(RPC) for token pricing.

Swapper uses topology (RPC) + state (RPC) for multi-hop routing and dynamic slippage calculation. 


