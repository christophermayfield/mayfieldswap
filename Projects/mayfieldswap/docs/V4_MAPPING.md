# Uniswap V4 rewrite notes

MayfieldSwap was rewritten from a SushiSwap/Uniswap V2 Factory–Pair–Router design to a Uniswap V4–style stack.

## What changed

| Old (V2) | New (V4-style) |
|---|---|
| One pair contract per market | Singleton `PoolManager` |
| Constant product only | Concentrated liquidity (`sqrtPriceX96`, ticks) |
| Tokens held in pairs | Tokens held in manager; flash accounting |
| Pair `lock` | `unlock` + `unlockCallback` |
| No hooks | `IHooks` |
| ERC-20 LP tokens per pair | ERC-721 positions (`PositionManager`) or router `salt` positions |

## Intentional simplifications (educational)

- No Position NFT manager (router owns pool positions; per-user `salt`)
- Frontend liquidity UI uses full-range ticks only

## Implemented since rewrite

- LP fee growth globals / tick fee growth outside / position tokens owed
- `collectFees` on the router (poke + collect + take)
- `getPendingFees` view for uncheckpointed fees
- EIP-1153 transient lock / currency deltas / synced reserves (`tstore`/`tload`)

## Next extensions

- Custom tick ranges in the UI
- Example dynamic-fee / custom-curve hooks
- Closer ABI parity with official `@uniswap/v4-core`
- Custom-curve hooks
