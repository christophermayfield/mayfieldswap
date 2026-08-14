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
| ERC-20 LP tokens per pair | Router-owned positions keyed by per-user `salt` + tick range |

## Intentional simplifications (educational)

- No Position NFT manager (router owns pool positions; per-user `salt`)
- Transient storage not used (storage deltas during unlock)
- Default swap/liquidity UI uses the no-hook 0.30% pool; hooked pools are available via `poolKey` / `swapExactInputOnPool`

## Implemented since rewrite

- LP fee growth globals / tick fee growth outside / position tokens owed
- `collectFees` on the router (poke + collect + take)
- `getPendingFees` view for uncheckpointed fees
- Custom tick ranges (`addLiquidityWithRange`, liquidity UI presets)
- Example `DynamicFeeHook` (`getSwapFee` override)

## Next extensions

- EIP-1153 transient delta storage
- Closer ABI parity with official `@uniswap/v4-core`
- Position NFT manager / custom-curve hooks
