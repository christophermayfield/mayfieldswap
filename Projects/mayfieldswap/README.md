# MayfieldSwap

A Uniswap V4-style decentralized exchange built from scratch in Solidity. Features a singleton `PoolManager`, concentrated liquidity with tick ranges, EIP-1153 flash accounting, and a hooks system for pluggable swap-fee logic. Includes a full Next.js frontend and a complete test suite.

> Educational software — not audited. Do not use with real funds.

---

## Stack

| Layer | Technology |
|---|---|
| Smart contracts | Solidity 0.8.26 (Cancun / EIP-1153), Hardhat |
| Testing | Mocha/Chai |
| Frontend | Next.js, React, TypeScript |
| Web3 | wagmi v2, viem, RainbowKit |
| Styling | Tailwind CSS |

---

## Architecture

All pools live inside a single `PoolManager` contract. Users interact through periphery contracts (`MayfieldRouter`, `PositionManager`) that use the unlock/flash-accounting pattern to settle currency deltas atomically.

| Contract | Role |
|---|---|
| `PoolManager` | Singleton pool registry. Owns all token balances. Entry point is `unlock()` — callers must implement `IUnlockCallback`. |
| `Pool` (library) | Concentrated liquidity math: tick bitmaps, positions, fee-growth accumulators. |
| `MayfieldRouter` | User-facing periphery. Wraps swaps and liquidity operations inside `unlockCallback`. |
| `PositionManager` | Wraps LP positions as ERC-721 NFTs (symbol: `MSLP`). |
| `Quoter` | Returns expected swap output via `eth_call` — triggers a revert to read the result without mutating state. |
| `EmptyHooks` | No-op base hook contract. |
| `DynamicFeeHook` | Owner-settable swap-fee override. Demonstrates the V4 hooks pattern. |
| `WETH` | Wrapped ETH, used for ETH/token pairs. |
| `TestToken` | Mintable ERC-20 for local testing. |

Pools are identified by a `PoolKey`: `(currency0, currency1, fee, tickSpacing, hooks)`.

### Key design patterns

**Unlock / flash accounting** — Every state-mutating operation is wrapped in `poolManager.unlock(data)`. The router's `unlockCallback` executes the swap or liquidity change, accumulating signed currency deltas (via EIP-1153 transient storage). All deltas must be settled before `unlock` returns.

**Concentrated liquidity** — LPs choose a `tickLower` and `tickUpper`. Fees only accrue to a position when the current pool price falls within that range.

**Fee accounting** — `feeGrowthGlobal0X128` / `feeGrowthGlobal1X128` accumulate at the pool level. Per-tick `feeGrowthOutside` values let positions calculate their share of fees without iterating all ticks.

**Hooks** — Each `PoolKey` references a hooks contract address. The `DynamicFeeHook` overrides the static fee at swap time; any V4-compatible hook can implement before/after callbacks for init, swap, and liquidity operations.

---

## Project structure

```
mayfieldswap/
├── contracts/
│   ├── PoolManager.sol               # Core singleton
│   ├── TestToken.sol
│   ├── WETH.sol
│   ├── hooks/
│   │   ├── EmptyHooks.sol
│   │   └── DynamicFeeHook.sol
│   ├── interfaces/
│   │   ├── IPoolManager.sol
│   │   ├── IHooks.sol
│   │   └── IUnlockCallback.sol
│   ├── libraries/
│   │   ├── Pool.sol                  # Concentrated liquidity math
│   │   ├── TickMath.sol
│   │   ├── SqrtPriceMath.sol
│   │   ├── SwapMath.sol
│   │   ├── TickBitmap.sol
│   │   ├── Tick.sol
│   │   ├── LiquidityAmounts.sol
│   │   ├── FullMath.sol
│   │   ├── TransientDelta.sol        # EIP-1153 flash accounting
│   │   └── TransientLock.sol
│   ├── periphery/
│   │   ├── MayfieldRouter.sol        # Swap + liquidity entry point
│   │   ├── PositionManager.sol       # ERC-721 LP positions
│   │   └── Quoter.sol
│   └── types/
│       ├── PoolKey.sol
│       ├── PoolId.sol
│       ├── Currency.sol
│       └── BalanceDelta.sol
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx              # Swap / Liquidity / NFTs / Pool tabs
│       │   └── providers.tsx         # wagmi + RainbowKit setup
│       ├── components/
│       │   ├── SwapInterface.tsx
│       │   ├── LiquidityInterface.tsx
│       │   ├── PositionNFTInterface.tsx
│       │   └── PoolInspectorInterface.tsx
│       ├── contracts/
│       │   └── config.ts             # Deployed addresses + ABIs
│       └── hooks/
│           └── useTokenApproval.ts
├── scripts/
│   └── deploy-v4.js
├── test/
│   ├── MayfieldSwap.v4.test.js       # Core swap + liquidity
│   ├── FeeGrowth.test.js             # LP fee accumulation
│   ├── ConcentratedLiquidity.test.js # Tick ranges
│   ├── DynamicFeeHook.test.js        # Hook fee override
│   ├── PositionManager.test.js       # ERC-721 positions
│   └── TransientAccounting.test.js   # Flash accounting
├── docs/
│   ├── ARCHITECTURE.md
│   └── V4_MAPPING.md                 # V2 → V4 concept mapping
├── .env.example
├── hardhat.config.js
└── package.json
```

---

## Local development

### Prerequisites

- Node.js 18+
- MetaMask or any Web3 wallet

### Setup

```bash
npm run setup        # installs root + frontend dependencies
```

### Run

```bash
npm run node                 # terminal 1 — Hardhat blockchain (port 8545)
npm run deploy:localhost     # terminal 2 — deploy all contracts
cd frontend && npm run dev   # terminal 3 — Next.js (port 3000)
```

Or run both the blockchain and frontend together:

```bash
npm run dev
```

Then run the deploy script in a separate terminal after the node is ready.

### MetaMask configuration

| Setting | Value |
|---|---|
| Network name | Hardhat Local |
| RPC URL | http://127.0.0.1:8545 |
| Chain ID | 31337 |
| Currency | ETH |

Import a test account by copying one of the private keys printed by `npm run node`.

### What gets deployed

`deploy-v4.js` deploys in this order:

1. WETH
2. PoolManager
3. MayfieldRouter (params: PoolManager, WETH)
4. Quoter (params: PoolManager)
5. PositionManager (params: PoolManager, MayfieldRouter)
6. DynamicFeeHook (initial fee: 1%)
7. TestToken A and TestToken B

It then initializes two pools at a 1:1 price (one with no hooks, one with DynamicFeeHook), adds full-range liquidity, and writes `deployment-v4.json` and the updated `frontend/src/contracts/config.ts`.

---

## Frontend

The app has four tabs:

| Tab | What it does |
|---|---|
| Swap | Exact-input token swaps. Shows expected output via the `Quoter` contract. |
| Liquidity | Add or remove liquidity. Supports full-range and custom tick ranges. |
| NFTs | View and manage ERC-721 LP positions. Collect accrued fees per position. |
| Pool | Read-only pool inspector — current tick, sqrt price, total liquidity, fee growth globals, and hook fee. |

---

## Testing

```bash
npm test
```

| File | What it covers |
|---|---|
| `MayfieldSwap.v4.test.js` | Pool initialization, full-range swaps, liquidity add/remove |
| `FeeGrowth.test.js` | Fee accumulation across swaps; multi-LP fee distribution |
| `ConcentratedLiquidity.test.js` | In-range vs. out-of-range positions; tick-based fee accrual |
| `DynamicFeeHook.test.js` | Hook invocation on swap; owner fee override |
| `PositionManager.test.js` | ERC-721 mint/burn, fee collection, position metadata |
| `TransientAccounting.test.js` | Flash-accounting delta settlement via EIP-1153 |

---

## Testnet deployment (Base Sepolia)

### 1. Set up environment variables

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `PRIVATE_KEY` | Deployer wallet private key — needs Base Sepolia ETH |
| `BASE_SEPOLIA_RPC_URL` | Default: `https://sepolia.base.org` |
| `BASESCAN_API_KEY` | From [basescan.org/myapikey](https://basescan.org/myapikey) — needed for contract verification |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | From [cloud.walletconnect.com](https://cloud.walletconnect.com) |

### 2. Get testnet ETH

Fund your deployer wallet from the [Base Sepolia faucet](https://faucet.quicknode.com/base/sepolia).

### 3. Deploy

```bash
npm install
npm run deploy:baseSepolia
```

### 4. Update frontend addresses

Paste the printed contract addresses into `frontend/src/contracts/config.ts` under the `84532` key.

### 5. Verify contracts (optional)

```bash
npm run verify:baseSepolia -- <CONTRACT_ADDRESS> <...constructor args>
```

---

## Available scripts

| Script | Description |
|---|---|
| `npm run setup` | Install all dependencies (root + frontend) |
| `npm run node` | Start local Hardhat blockchain |
| `npm run dev` | Start blockchain + frontend concurrently |
| `npm run compile` | Compile contracts |
| `npm test` | Run full test suite |
| `npm run deploy` | Deploy to default Hardhat network |
| `npm run deploy:localhost` | Deploy to running local node |
| `npm run deploy:baseSepolia` | Deploy to Base Sepolia testnet |
| `npm run verify:baseSepolia` | Verify a contract on Basescan |
| `npm run clean` | Clear build artifacts |

---

## Docs

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — detailed contract design
- [V4_MAPPING.md](docs/V4_MAPPING.md) — how V2 concepts map to V4

---

## License

MIT
