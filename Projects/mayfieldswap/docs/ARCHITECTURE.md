# Architecture

MayfieldSwap is a from-scratch **Uniswap V4–style** DEX.

## Core flow

```
User → MayfieldRouter.unlock path → PoolManager.unlock
         → Router.unlockCallback
              → modifyLiquidity / swap
              → sync → transfer → settle / take
         ← deltas must be zero
```

## Concentrated liquidity

Each pool stores:

- `slot0`: `sqrtPriceX96`, `tick`
- active `liquidity`
- tick net/gross + tick bitmap
- positions keyed by `(owner, tickLower, tickUpper)`

The router mints positions at caller-chosen ticks (UI presets: full range, narrow ±120, medium ±600, or custom). Each LP is keyed by a per-user `salt` under the router-owned position namespace. Swap fees accrue via `feeGrowthGlobal` / tick `feeGrowthOutside` / position checkpoints **only while the pool tick is inside the position**. LPs call `collectFees` / `collectFeesWithRange` (or receive fees on remove). `getPendingFeesAt` includes uncheckpointed growth so the UI does not need a poke.

## Flash accounting

During unlock, currency deltas accumulate. Callers must `settle` debts and `take` credits before unlock returns.

## Hooks

`IHooks` supports before/after initialize, add/remove liquidity, and swap, plus `getSwapFee` (return 0 to keep the pool fee). Pools may set `hooks = address(0)`, `EmptyHooks`, or `DynamicFeeHook` (owner-settable fee override — the V4 lesson).

## Quoting

`Quoter.quoteExactInput` runs a swap inside `unlock` and reverts with `QuoteAmount(amountOut)` so UIs can `eth_call` / `simulateContract` safely.
