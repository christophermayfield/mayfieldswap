# MayfieldSwap

Uniswap **V4–style** educational DEX: singleton `PoolManager`, concentrated liquidity, unlock/flash accounting, and hooks.

## Stack

- **Solidity 0.8.19** + Hardhat
- **Next.js** frontend (wagmi + RainbowKit)
- Local chain `31337`

## Architecture

| Piece | Role |
|---|---|
| `PoolManager` | Singleton pools, `unlock`, `modifyLiquidity`, `swap`, `settle`/`take` |
| `Pool` library | Concentrated liquidity state (`sqrtPriceX96`, ticks, bitmap) |
| `MayfieldRouter` | Periphery via `IUnlockCallback` |
| `Quoter` | Exact-input quotes via eth_call + revert |
| `EmptyHooks` | No-op `IHooks` implementation |

Pools are identified by `PoolKey` `(currency0, currency1, fee, tickSpacing, hooks)`.

## Quick start

```bash
npm run setup
npm run node                 # terminal 1
npm run deploy:localhost     # terminal 2
cd frontend && npm run dev   # terminal 3
```

MetaMask: RPC `http://127.0.0.1:8545`, chain ID `31337`.

## Scripts

```bash
npm test
npm run compile
npm run deploy:v4
```

## Layout

```
contracts/
  PoolManager.sol
  types/ interfaces/ libraries/ hooks/ periphery/
  TestToken.sol WETH.sol
frontend/
scripts/deploy-v4.js
test/MayfieldSwap.v4.test.js
docs/
```

## Docs

- [ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [V4_MAPPING.md](docs/V4_MAPPING.md)

## License

MIT — educational software; audit before any mainnet use.
