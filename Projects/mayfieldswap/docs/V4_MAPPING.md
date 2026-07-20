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
| ERC-20 LP tokens per pair | Router-tracked liquidity shares (full-range UX) |

## Intentional simplifications (educational)

- Fee growth / LP fee claims not fully tracked
- No Position NFT manager (router owns pool positions)
- Transient storage not used (storage deltas during unlock)
- Frontend liquidity UI uses full-range ticks only

## Next extensions

- Custom tick ranges in the UI
- Example dynamic-fee / custom-curve hooks
- EIP-1153 transient delta storage
- Closer ABI parity with official `@uniswap/v4-core`
