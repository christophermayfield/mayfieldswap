# MayfieldSwap Setup Guide

Quick setup guide to get the educational DEX running locally.

## Prerequisites

- Node.js v18+
- MetaMask browser extension
- Git

## Quick start

### 1. Clone & install

```bash
git clone <your-repo-url>
cd Projects/mayfieldswap
npm run setup
```

### 2. Run the stack

Use three terminals (deploy needs a running node):

```bash
# Terminal 1: local chain
npm run node

# Terminal 2: deploy PoolManager, router, quoter, and test tokens
npm run deploy:localhost

# Terminal 3: frontend
cd frontend && npm run dev
```

`npm run dev` starts the Hardhat node and Next.js together but **does not deploy**. Run `deploy:localhost` once the node is up.

### 3. Configure MetaMask

- **Network Name**: Hardhat Local
- **RPC URL**: `http://127.0.0.1:8545`
- **Chain ID**: `31337`
- **Currency**: ETH

### 4. Import a test account

Use a private key from the Hardhat node output, for example:

```
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

### 5. Open the UI

Open `http://localhost:3000`. Swap, add full-range liquidity, and collect the 0.30% swap fee after trades.

## Testing

```bash
npm test
```

## Scripts

- `npm run compile` — compile contracts
- `npm run node` — local Hardhat chain
- `npm run deploy:localhost` — deploy V4 stack to localhost and write `frontend/src/contracts/config.ts`
- `npm run deploy:v4` / `npm run deploy` — deploy using the Hardhat network from config
- `npm test` — contract tests
- `npm run clean` — clear Hardhat cache
- `npm run setup` — install root and frontend dependencies

## URLs

- Frontend: http://localhost:3000
- Blockchain RPC: http://127.0.0.1:8545
- Chain ID: 31337

## Features

- Token swapping (ETH ↔ tokens, token ↔ token)
- Full-range liquidity add/remove
- LP swap-fee accrual and collect
- Wallet connection (RainbowKit)
- Slippage protection on swaps

## Troubleshooting

### Frontend won't start

```bash
cd frontend
rm -rf node_modules
npm install
npm run dev
```

### MetaMask nonce errors

1. Reset the account (Settings → Advanced → Reset Account)
2. Re-import the test account
3. Confirm you are on Hardhat Local (`31337`)

### Contract deployment fails

```bash
npm run clean
npm run compile
npm run deploy:localhost
```

See [ARCHITECTURE.md](ARCHITECTURE.md) and [V4_MAPPING.md](V4_MAPPING.md) for protocol details.
