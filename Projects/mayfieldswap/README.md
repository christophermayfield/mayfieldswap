# 🍣 MayfieldSwap - Decentralized Exchange (DEX)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.19-blue.svg)](https://soliditylang.org/)
[![Hardhat](https://img.shields.io/badge/Built%20with-Hardhat-orange.svg)](https://hardhat.org/)
[![Next.js](https://img.shields.io/badge/Frontend-Next.js-black.svg)](https://nextjs.org/)

A decentralized exchange mapped to **Uniswap V4–style architecture** (singleton `PoolManager`, unlock/flash accounting, `PoolKey`, hooks). Phase 1 keeps constant-product pricing inside pools so the system stays approachable while the call graph matches V4.

> Legacy SushiSwap/Uniswap V2 contracts remain under `contracts/legacy/` for reference. See [docs/V4_MAPPING.md](docs/V4_MAPPING.md).

## 🚀 Live Demo
- **Frontend**: Start locally with `npm run dev`
- **Blockchain**: Local Hardhat network at `http://127.0.0.1:8545`
- **Chain ID**: `31337` (for MetaMask)

## 📋 Features

### Core Functionality
- **Token Swapping**: Swap ERC-20 tokens and ETH via V4-style unlock callbacks
- **Liquidity Provision**: Add and remove pool shares on the singleton manager
- **Pool identity**: `PoolKey` (currencies, fee, tickSpacing, hooks) → `PoolId`
- **Hooks**: `IHooks` surface with `EmptyHooks` no-op implementation
- **Wallet Integration**: MetaMask and other wallets via wagmi + RainbowKit

### Technical Features
- **Smart Contracts**: `MayfieldPoolManager` + `MayfieldRouter` periphery
- **Frontend**: React/Next.js + Tailwind CSS
- **Testing**: Legacy V2 suite + new V4 suite
- **Local Development**: Hardhat node + deploy scripts

## 🚀 Quick Start

### Prerequisites
- Node.js (v18+)
- npm or yarn
- MetaMask or compatible Web3 wallet

### Setup
```bash
git clone https://github.com/christophermayfield/mayfieldswap.git
cd mayfieldswap
npm run setup
```

```bash
npm run node                 # Terminal 1: Blockchain
npm run deploy:localhost     # Terminal 2: Deploy V4 contracts
cd frontend && npm run dev   # Terminal 3: Frontend
```

### MetaMask Configuration
- **Network**: `http://127.0.0.1:8545`
- **Chain ID**: `31337`
- **Test Account**: Import any private key from Hardhat output

## 📁 Project Structure

```
mayfieldswap/
├── contracts/
│   ├── v4/                 # Uniswap V4–style core + periphery
│   │   ├── PoolManager.sol
│   │   ├── periphery/MayfieldRouter.sol
│   │   ├── hooks/
│   │   ├── interfaces/
│   │   ├── libraries/
│   │   └── types/
│   ├── legacy/             # SushiSwap / Uniswap V2 reference
│   ├── TestToken.sol
│   └── WETH.sol
├── frontend/
├── scripts/
│   ├── deploy-v4.js        # Primary deploy path
│   └── deploy.js           # Legacy V2 deploy
├── test/
│   ├── V4PoolManager.test.js
│   └── SushiSwap.test.js
└── docs/
    ├── V4_MAPPING.md
    └── ARCHITECTURE.md
```

## 🧪 Testing

```bash
npm test          # All suites
npm run test:v4   # V4 only
```

## 📖 Architecture

1. User calls `MayfieldRouter`
2. Router calls `PoolManager.unlock(data)`
3. Manager invokes `unlockCallback` on the router
4. Callback performs `swap` / `addLiquidity` / `removeLiquidityFor`
5. Router `sync` → transfer → `settle` debts and `take` credits
6. Unlock completes only when all currency deltas are zero

Pool math is still constant-product (`x * y = k`) until the concentrated-liquidity phase. See [docs/V4_MAPPING.md](docs/V4_MAPPING.md).

## 📄 License

MIT License - see LICENSE file for details

## 🔗 Resources

- [docs/V4_MAPPING.md](docs/V4_MAPPING.md)
- [Uniswap V4 docs](https://docs.uniswap.org/contracts/v4/overview)
- [Hardhat Documentation](https://hardhat.org/docs)

---

**⚠️ Disclaimer**: This is educational software. Use at your own risk. Always audit smart contracts before deploying to mainnet.
