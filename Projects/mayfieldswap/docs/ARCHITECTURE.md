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

During unlock, currency deltas accumulate in **EIP-1153 transient storage** (`tstore` / `tload`). Callers must `settle` debts and `take` credits before unlock returns. The lock, per-currency deltas, and synced reserves are discarded at the end of the transaction, so they cannot leak into the next one.

## Hooks

`IHooks` supports before/after initialize, add/remove liquidity, and swap, plus `getSwapFee` (return 0 to keep the pool fee). Pools may set `hooks = address(0)`, `EmptyHooks`, or `DynamicFeeHook` (owner-settable fee override — the V4 lesson).

## Quoting

`Quoter.quoteExactInput` runs a swap inside `unlock` and reverts with `QuoteAmount(amountOut)` so UIs can `eth_call` / `simulateContract` safely.

## Position NFTs

`PositionManager` (symbol `MSLP`) wraps concentrated positions as ERC-721 tokens. Each NFT stores the pool `PoolKey` and tick range; the on-chain position uses `salt = bytes32(tokenId)` under the manager contract as locker. Owners can `mint`, `decreaseLiquidity`, `burn`, `collect`, and `transferFrom` — fee-collect rights follow the NFT holder. The router still supports direct `salt = address(user)` positions for simpler UX.

## Pool inspector (frontend)

The **Pool** tab reads `PoolManager.getSlot0`, `getFeeGrowthGlobals`, and router position views to show current tick/price, active liquidity, fee growth globals, effective swap fee (including hook override), and an in-range preview for a chosen tick band.
