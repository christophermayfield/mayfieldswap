# MayfieldSwap: Uniswap V2 → V4 Architecture Mapping

This document maps the existing SushiSwap/Uniswap V2 layout to a Uniswap V4–style architecture.
Phase 1 adopts V4 **structure and call flow**; pool pricing still uses constant-product (`x * y = k`) so the system stays teachable and testable. Concentrated liquidity (tick math) is a later phase.

## Concept map

| V2 / Sushi (current) | V4 (target) | Phase 1 status |
|---|---|---|
| `SushiFactory` | `PoolManager.initialize` + `PoolKey` registry | Done |
| `SushiPair` (one contract per pair) | Pool state inside singleton `PoolManager` | Done |
| `SushiRouter` | Periphery (`MayfieldRouter`) via `unlock` callback | Done |
| `getPair(tokenA, tokenB)` | `PoolId = keccak256(PoolKey)` | Done |
| Pair ERC-20 LP tokens | `liquidityOf[poolId][owner]` shares on manager | Done (simplified) |
| Tokens sit in each Pair | Tokens sit in `PoolManager`; settled via flash accounting | Done |
| `lock` on Pair | `unlock` / `unlockCallback` on PoolManager | Done |
| N/A | `IHooks` before/after swap & liquidity | Stub (no-op / address(0)) |
| N/A | Transient currency deltas (EIP-1153) | Storage deltas during unlock (V4 uses `tstore`) |
| Constant product | Concentrated liquidity + hooks-custom curves | CPMM math for now |

## Pool identity

V2 pairs are `(token0, token1)`.

V4 pools are a `PoolKey`:

```text
currency0 | currency1 | fee | tickSpacing | hooks
```

Multiple pools can share the same token pair with different fees or hooks.

## Call flow

### V2 swap
1. User → Router
2. Router pulls tokens → Pair
3. Pair `swap()` updates reserves
4. Pair sends output tokens

### V4-style swap (Phase 1)
1. User → `MayfieldRouter`
2. Router → `PoolManager.unlock(data)`
3. Manager → `Router.unlockCallback(data)`
4. Callback → `PoolManager.swap(...)` (updates pool + currency deltas)
5. Callback → `settle` (pay debts) / `take` (receive credits)
6. Unlock ends only if all currency deltas are zero

## File layout

```text
contracts/
├── legacy/          # V2 SushiFactory / SushiPair / SushiRouter (kept for reference)
├── v4/
│   ├── types/       # Currency, PoolKey, PoolId, BalanceDelta
│   ├── interfaces/  # IPoolManager, IUnlockCallback, IHooks
│   ├── libraries/   # PoolIdLibrary, CurrencyLibrary, CPMM math helpers
│   ├── hooks/       # Base / empty hooks
│   ├── PoolManager.sol
│   └── periphery/MayfieldRouter.sol
├── TestToken.sol
└── WETH.sol
```

## Phase plan

1. **Phase 1 (this PR):** Singleton manager, unlock/settle/take, PoolKey, hooks interface, periphery router, tests, deploy path.
2. **Phase 2:** Hook examples (dynamic fee, custom curve guardrails).
3. **Phase 3:** Replace CPMM with concentrated-liquidity state (`sqrtPriceX96`, ticks).
4. **Phase 4:** Align ABIs more closely with official `@uniswap/v4-core` / periphery packages.

## Naming

Public contracts use **Mayfield\*** names (`MayfieldPoolManager`, `MayfieldRouter`) while following Uniswap V4 patterns so the educational fork stays distinct from production Uniswap deployments.
