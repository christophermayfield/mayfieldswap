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

- Default swap/liquidity UI uses the no-hook 0.30% pool; hooked pools via `poolKey` / `swapExactInputOnPool`
- Minimal ERC-721 (no royalties / permit extensions)

## Implemented since rewrite

- LP fee growth globals / tick fee growth outside / position tokens owed
- `collectFees` on the router (poke + collect + take)
- `getPendingFees` view for uncheckpointed fees
- Custom tick ranges (`addLiquidityWithRange`, liquidity UI presets)
- Example `DynamicFeeHook` (`getSwapFee` override)
- EIP-1153 transient lock / currency deltas / synced reserves (`tstore`/`tload`)
- `PositionManager` ERC-721 LP NFTs keyed by `salt = tokenId`
- Position NFT UI tab (mint / collect / burn MSLP tokens)
- Pool inspector UI (slot0, fee growth, range / in-range preview)

## Next extensions

- Closer ABI parity with official `@uniswap/v4-core`
- Custom-curve hooks
