// Contract addresses — update after `npm run deploy:v4` / localhost deploy
export const CONTRACT_ADDRESSES = {
  31337: {
    // Hardhat local network (populated by deploy-v4)
    WETH: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    MayfieldPoolManager: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    MayfieldRouter: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    TokenA: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    TokenB: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
  },
  1: {
    WETH: "",
    MayfieldPoolManager: "",
    MayfieldRouter: "",
    TokenA: "",
    TokenB: "",
  },
} as const;

export const ROUTER_ABI = [
  "function swapExactTokensForTokens(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, address recipient, uint256 deadline) external returns (uint256 amountOut)",
  "function swapExactETHForTokens(address tokenOut, uint256 amountOutMin, address recipient, uint256 deadline) external payable returns (uint256 amountOut)",
  "function swapExactTokensForETH(address tokenIn, uint256 amountIn, uint256 amountOutMin, address recipient, uint256 deadline) external returns (uint256 amountOut)",
  "function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address recipient, uint256 deadline) external returns (uint256 amount0, uint256 amount1, uint256 liquidity)",
  "function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address recipient, uint256 deadline) external returns (uint256 amount0, uint256 amount1)",
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
  "function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut)",
  "function getLiquidity(address tokenA, address tokenB, address owner) external view returns (uint256)",
  "function getReserves(address tokenA, address tokenB) external view returns (uint128 reserve0, uint128 reserve1)",
  "function initializePool(address tokenA, address tokenB, uint24 fee, address hooks) external returns (bytes32 id)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
] as const;

export const POOL_MANAGER_ABI = [
  "function isInitialized(bytes32 id) external view returns (bool)",
  "function getReserves(bytes32 id) external view returns (uint128 reserve0, uint128 reserve1)",
  "function getLiquidity(bytes32 id, address owner) external view returns (uint256)",
] as const;
