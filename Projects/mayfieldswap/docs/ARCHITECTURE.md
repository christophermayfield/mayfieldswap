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

The router currently mints **full-range** positions (`min/max usable tick` for spacing 60). Each LP is keyed by a per-user `salt` under the router-owned position namespace. Swap fees accrue via fee-growth checkpoints; LPs call `collectFees` (or receive fees on remove).

## Flash accounting

During unlock, currency deltas accumulate. Callers must `settle` debts and `take` credits before unlock returns.

## Hooks

`IHooks` supports before/after initialize, add/remove liquidity, and swap. Pools may set `hooks = address(0)` or an `EmptyHooks` (or custom) contract.

## Quoting

`Quoter.quoteExactInput` runs a swap inside `unlock` and reverts with `QuoteAmount(amountOut)` so UIs can `eth_call` / `simulateContract` safely.
