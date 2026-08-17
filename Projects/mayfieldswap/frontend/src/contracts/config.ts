export const CONTRACT_ADDRESSES = {
  31337: {
    WETH: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    PoolManager: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    MayfieldRouter: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    PositionManager: "",
    Quoter: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    DynamicFeeHook: "",
    TokenA: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    TokenB: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
  },
  1: {
    WETH: "",
    PoolManager: "",
    MayfieldRouter: "",
    PositionManager: "",
    Quoter: "",
    DynamicFeeHook: "",
    TokenA: "",
    TokenB: "",
  },
} as const;

export const ROUTER_ABI = [
  "function swapExactTokensForTokens(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, address recipient, uint256 deadline) external returns (uint256 amountOut)",
  "function swapExactETHForTokens(address tokenOut, uint256 amountOutMin, address recipient, uint256 deadline) external payable returns (uint256 amountOut)",
  "function swapExactTokensForETH(address tokenIn, uint256 amountIn, uint256 amountOutMin, address recipient, uint256 deadline) external returns (uint256 amountOut)",
  "function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address recipient, uint256 deadline) external returns (uint256 amount0, uint256 amount1, uint128 liquidity)",
  "function addLiquidityWithRange(address tokenA, address tokenB, int24 tickLower, int24 tickUpper, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address recipient, uint256 deadline) external returns (uint256 amount0, uint256 amount1, uint128 liquidity)",
  "function removeLiquidity(address tokenA, address tokenB, uint128 liquidity, uint256 amountAMin, uint256 amountBMin, address recipient, uint256 deadline) external returns (uint256 amount0, uint256 amount1)",
  "function removeLiquidityWithRange(address tokenA, address tokenB, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 amountAMin, uint256 amountBMin, address recipient, uint256 deadline) external returns (uint256 amount0, uint256 amount1)",
  "function collectFees(address tokenA, address tokenB, address recipient, uint256 deadline) external returns (uint256 amount0, uint256 amount1)",
  "function collectFeesWithRange(address tokenA, address tokenB, int24 tickLower, int24 tickUpper, address recipient, uint256 deadline) external returns (uint256 amount0, uint256 amount1)",
  "function getLiquidity(address tokenA, address tokenB, address owner) external view returns (uint128)",
  "function getLiquidityAt(address tokenA, address tokenB, address owner, int24 tickLower, int24 tickUpper) external view returns (uint128)",
  "function getPendingFees(address tokenA, address tokenB, address owner) external view returns (uint128 amount0, uint128 amount1)",
  "function getPendingFeesAt(address tokenA, address tokenB, address owner, int24 tickLower, int24 tickUpper) external view returns (uint128 amount0, uint128 amount1)",
  "function getPoolState(address tokenA, address tokenB) external view returns (uint160 sqrtPriceX96, int24 tick, uint128 liquidity)",
  "function fullRangeTicks() external pure returns (int24 tickLower, int24 tickUpper)",
  "function defaultKey(address tokenA, address tokenB) external pure returns (tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks))",
  "function poolKey(address tokenA, address tokenB, uint24 fee, int24 tickSpacing, address hooks) external pure returns (tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks))",
  "function swapExactInputOnPool(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, address tokenIn, uint256 amountIn, uint256 amountOutMin, address recipient, uint256 deadline) external returns (uint256 amountOut)",
] as const;

export const HOOK_ABI = [
  "function feePips() external view returns (uint24)",
] as const;

export const POSITION_MANAGER_ABI = [
  "function mint(address tokenA, address tokenB, int24 tickLower, int24 tickUpper, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address recipient, uint256 deadline) external returns (uint256 tokenId, uint128 liquidity)",
  "function decreaseLiquidity(uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) external returns (uint256 amount0, uint256 amount1)",
  "function burn(uint256 tokenId, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) external returns (uint256 amount0, uint256 amount1)",
  "function collect(uint256 tokenId, address recipient, uint256 deadline) external returns (uint256 amount0, uint256 amount1)",
  "function transferFrom(address from, address to, uint256 tokenId) external",
  "function approve(address to, uint256 tokenId) external",
  "function setApprovalForAll(address operator, bool approved) external",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function nextTokenId() external view returns (uint256)",
  "function getLiquidity(uint256 tokenId) external view returns (uint128)",
  "function getPendingFees(uint256 tokenId) external view returns (uint128 amount0, uint128 amount1)",
  "function positionInfo(uint256 tokenId) external view returns (tuple(address owner, int24 tickLower, int24 tickUpper, uint128 liquidity, uint128 pendingFees0, uint128 pendingFees1))",
  "function positions(uint256 tokenId) external view returns (tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, int24 tickLower, int24 tickUpper)",
] as const;

export const QUOTER_ABI = [
  "function quoteExactInput(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, bool zeroForOne, uint256 amountIn) external returns (uint256 amountOut)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
] as const;
