# 🍣 MayfieldSwap - Decentralized Exchange (DEX)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.19-blue.svg)](https://soliditylang.org/)
[![Hardhat](https://img.shields.io/badge/Built%20with-Hardhat-orange.svg)](https://hardhat.org/)
[![Next.js](https://img.shields.io/badge/Frontend-Next.js-black.svg)](https://nextjs.org/)

A production-ready decentralized exchange built with SushiSwap architecture. Features comprehensive smart contracts, automated testing, and a modern React frontend with Web3 integration.

## 🚀 Live Demo
- **Frontend**: Start locally with `npm run dev`
- **Blockchain**: Local Hardhat network at `http://127.0.0.1:8545`
- **Chain ID**: `31337` (for MetaMask)

## 📋 Features

### Core Functionality
- **Token Swapping**: Swap between different ERC-20 tokens and ETH
- **Liquidity Provision**: Add and remove liquidity to earn trading fees
- **Automated Market Maker (AMM)**: Uses constant product formula (x * y = k)
- **Price Discovery**: Real-time price calculations and slippage protection
- **Wallet Integration**: Connect with MetaMask and other Web3 wallets

### Technical Features
- **Smart Contracts**: Factory, Pair, and Router contracts based on SushiSwap
- **Frontend**: Modern React/Next.js interface with Tailwind CSS
- **Web3 Integration**: wagmi + RainbowKit for seamless wallet connections
- **Testing**: Comprehensive test suite with 10 passing tests
- **Local Development**: Complete local blockchain setup with Hardhat

## 🚀 Quick Start

### Prerequisites
- Node.js (v18+)
- npm or yarn
- MetaMask or compatible Web3 wallet

### One-Command Setup
```bash
git clone https://github.com/christophermayfield/mayfieldswap.git
cd mayfieldswap
npm run setup  # Installs all dependencies
npm run dev    # Starts blockchain + frontend
```

### Manual Setup
```bash
# 1. Install dependencies
npm run setup

# 2. Start development (choose one):
# Option A: Everything at once
npm run dev

# Option B: Separate terminals
npm run node        # Terminal 1: Blockchain
npm run deploy      # Terminal 2: Deploy contracts  
cd frontend && npm run dev  # Terminal 3: Frontend
```

### MetaMask Configuration
- **Network**: `http://127.0.0.1:8545`
- **Chain ID**: `31337`
- **Test Account**: Import any private key from Hardhat output

## 📁 Project Structure

```
mayfieldswap/
├── contracts/              # Smart contracts
│   ├── SushiFactory.sol   # Creates and manages pairs
│   ├── SushiPair.sol      # Individual liquidity pools  
│   ├── SushiRouter.sol    # Main user interface contract
│   ├── TestToken.sol      # ERC-20 test tokens
│   ├── WETH.sol          # Wrapped Ether implementation
│   ├── interfaces/       # Contract interfaces
│   └── libraries/        # Utility libraries
├── frontend/             # React/Next.js frontend
│   ├── src/app/         # Next.js app directory
│   ├── src/components/  # React components
│   └── src/contracts/   # Contract configurations
├── test/               # Comprehensive test suite
├── scripts/           # Deployment scripts
├── docs/             # Documentation
│   ├── SETUP.md     # Quick setup guide
│   ├── ARCHITECTURE.md  # System architecture
│   └── CONTRIBUTING.md  # Contribution guidelines
├── deployments/      # Deployment artifacts
├── package.json     # Project configuration
├── hardhat.config.js # Hardhat configuration
└── README.md        # This file
```

## 🔧 Smart Contract Architecture

### Core Contracts

#### SushiFactory
- Creates new trading pairs
- Manages factory settings and fees
- Tracks all created pairs

#### SushiPair
- Individual AMM pools for token pairs
- Implements constant product formula
- Handles liquidity provision and trading
- ERC-20 LP tokens for liquidity providers

#### SushiRouter
- Main user interface for the protocol
- Handles multi-hop swaps
- Manages liquidity operations
- Provides price calculations and slippage protection

### Key Features
- **0.3% Trading Fee**: Standard AMM trading fee
- **Slippage Protection**: Configurable slippage tolerance
- **Multi-hop Swaps**: Automatic routing through intermediate pairs
- **LP Rewards**: Liquidity providers earn proportional trading fees

## 🖥️ Frontend Features

### Swap Interface
- Token selection dropdown
- Real-time price calculations
- Slippage tolerance settings
- Transaction status tracking
- Balance display

### Liquidity Interface
- Add/Remove liquidity modes
- Automatic pair creation
- LP token balance tracking
- Proportional liquidity removal

### Wallet Integration
- RainbowKit wallet connector
- Multiple wallet support
- Network switching
- Transaction confirmations

## 🧪 Testing

Run the comprehensive test suite:

```bash
npm test
```

### Test Coverage
- ✅ Factory pair creation
- ✅ Liquidity addition (tokens + ETH)
- ✅ Token swapping (all combinations)
- ✅ Liquidity removal
- ✅ Price calculations
- ✅ Router functions

## 📡 Deployment

### Local Development
Already configured for Hardhat local network (Chain ID: 31337)

### Testnet Deployment
1. Update `hardhat.config.js` with testnet settings
2. Add your private key to environment variables
3. Deploy: `npx hardhat run scripts/deploy.js --network <testnet>`

### Mainnet Deployment
1. Audit contracts thoroughly
2. Update contract addresses in frontend
3. Deploy with production settings

## 🛡️ Security Considerations

### Smart Contract Security
- **Reentrancy Protection**: All external calls protected
- **Integer Overflow**: SafeMath equivalent checks
- **Access Control**: Proper permission management
- **Slippage Protection**: User-defined minimum outputs

### Recommended Security Practices
- Get contracts audited before mainnet deployment
- Use timelock for administrative functions
- Implement emergency pause mechanisms
- Monitor for unusual trading patterns

## 🔄 Usage Examples

### Swapping Tokens
1. Connect your wallet
2. Select input and output tokens
3. Enter amount to swap
4. Set slippage tolerance
5. Confirm transaction

### Adding Liquidity
1. Switch to "Liquidity" tab
2. Select token pair
3. Enter amounts for both tokens
4. Approve token spending (if needed)
5. Add liquidity and receive LP tokens

### Removing Liquidity
1. Go to "Remove Liquidity" mode
2. Select percentage to remove
3. Confirm transaction
4. Receive proportional tokens back

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🔗 Resources

- [SushiSwap Documentation](https://docs.sushi.com/)
- [Uniswap V2 Whitepaper](https://uniswap.org/whitepaper.pdf)
- [Hardhat Documentation](https://hardhat.org/docs)
- [Next.js Documentation](https://nextjs.org/docs)
- [wagmi Documentation](https://wagmi.sh/)

## 📞 Support

For questions or issues:
1. Check the documentation
2. Review existing issues
3. Create a new issue with detailed description

---

**⚠️ Disclaimer**: This is educational software. Use at your own risk. Always audit smart contracts before deploying to mainnet.
