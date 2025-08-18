# 🚀 MayfieldSwap Setup Guide

Quick setup guide to get your DEX running locally.

## Prerequisites
- Node.js v18+
- MetaMask browser extension
- Git

## 🏁 Quick Start

### 1. Clone & Install
```bash
git clone <your-repo-url>
cd mayfieldswap
npm run setup  # Installs all dependencies
```

### 2. Start Development Environment
```bash
# Option A: Start everything at once
npm run dev

# Option B: Start manually in separate terminals
# Terminal 1: Blockchain
npm run node

# Terminal 2: Deploy contracts
npm run deploy

# Terminal 3: Frontend
cd frontend && npm run dev
```

### 3. Configure MetaMask
- **Network Name**: Hardhat Local
- **RPC URL**: `http://127.0.0.1:8545`
- **Chain ID**: `31337`
- **Currency**: ETH

### 4. Import Test Account
Use any private key from the Hardhat output:
```
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Balance: 10,000 ETH
```

### 5. Access Your DEX
Open `http://localhost:3000` and start trading!

## 🧪 Testing
```bash
npm test  # Run all smart contract tests
```

## 📱 Available Scripts
- `npm run compile` - Compile smart contracts
- `npm run deploy` - Deploy to local network
- `npm run test` - Run tests
- `npm run clean` - Clean Hardhat cache
- `npm run setup` - Install all dependencies

## 🔗 URLs
- Frontend: http://localhost:3000
- Blockchain RPC: http://127.0.0.1:8545
- Chain ID: 31337

## 📋 Features
- ✅ Token swapping (ETH ↔ Tokens, Token ↔ Token)
- ✅ Liquidity provision/removal
- ✅ Real-time price calculations
- ✅ Wallet integration
- ✅ Slippage protection

## 🆘 Troubleshooting

### Frontend won't start
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run dev
```

### MetaMask issues
1. Reset MetaMask account (Settings → Advanced → Reset Account)
2. Re-import the test account
3. Make sure you're on the Hardhat Local network

### Contract deployment fails
```bash
npm run clean
npm run compile
npm run deploy
```

For detailed documentation, see `README_DEX.md`.
