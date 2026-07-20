# MayfieldSwap Architecture

## System Overview

MayfieldSwap is migrating from a Uniswap V2 / SushiSwap layout to a **Uniswap V4–style** singleton architecture. Phase 1 implements V4 structure and flash accounting while keeping constant-product pool math.

```
┌─────────────────┐    ┌──────────────────────┐    ┌─────────────────┐
│   Frontend      │    │  Smart Contracts     │    │   Blockchain    │
│  (React/Next)   │────│  PoolManager + Router│────│   (Hardhat)     │
└─────────────────┘    └──────────────────────┘    └─────────────────┘
```

See [V4_MAPPING.md](./V4_MAPPING.md) for the full V2 → V4 concept map.

## Smart Contract Architecture (V4 Phase 1)

### MayfieldPoolManager
- Singleton that stores all pool state
- `unlock` / callback flash accounting (`settle`, `take`, `sync`)
- `initialize(PoolKey)`, `addLiquidity`, `removeLiquidityFor`, `swap`

### MayfieldRouter
- User-facing periphery implementing `IUnlockCallback`
- Encodes actions, settles currency deltas, unwraps WETH when needed

### PoolKey / PoolId
- Pools identified by `(currency0, currency1, fee, tickSpacing, hooks)`
- `PoolId = keccak256(abi.encode(PoolKey))`

### Hooks
- `IHooks` before/after initialize, liquidity, and swap
- `EmptyHooks` no-op; `address(0)` skips hook calls

### Legacy (V2)
- `SushiFactory` / `SushiPair` / `SushiRouter` under `contracts/legacy/`

## Frontend Architecture

- **Framework**: Next.js App Router
- **Web3**: wagmi + viem + RainbowKit
- **Config**: `frontend/src/contracts/config.ts` points at V4 router/manager

## Data Flow (swap)

1. User selects tokens and amount
2. Frontend quotes via `MayfieldRouter.getAmountsOut`
3. User approves ERC-20 spending if needed
4. Router unlocks PoolManager and executes swap in callback
5. Tokens are settled/taken; UI refreshes balances

## Testing

- `test/V4PoolManager.test.js` — V4 initialize, liquidity, swap, remove
- `test/SushiSwap.test.js` — legacy V2 suite (still green)

## Phase plan

1. **Phase 1 (current):** V4 structure + CPMM math
2. **Phase 2:** Example custom hooks
3. **Phase 3:** Concentrated liquidity (`sqrtPriceX96`, ticks)
4. **Phase 4:** Closer ABI alignment with official Uniswap V4 packages
