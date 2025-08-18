// Contract addresses - Update these with your deployed contract addresses
export const CONTRACT_ADDRESSES = {
  31337: { // Hardhat local network
    WETH: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    SushiFactory: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    SushiRouter: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    TokenA: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    TokenB: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9"
  },
  1: { // Mainnet - Add your mainnet addresses here
    WETH: "",
    SushiFactory: "",
    SushiRouter: "",
    TokenA: "",
    TokenB: ""
  }
};

// ABI snippets for the contracts
export const ROUTER_ABI = [
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)",
  "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)",
  "function removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB)",
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts)"
];

export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

export const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  "function createPair(address tokenA, address tokenB) external returns (address pair)"
];

export const PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function balanceOf(address owner) external view returns (uint)"
];
