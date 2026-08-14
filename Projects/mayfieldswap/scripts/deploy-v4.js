const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying MayfieldSwap V4 rewrite with", deployer.address);

  const weth = await (await ethers.getContractFactory("WETH")).deploy();
  await weth.waitForDeployment();

  const poolManager = await (await ethers.getContractFactory("PoolManager")).deploy();
  await poolManager.waitForDeployment();

  const router = await (await ethers.getContractFactory("MayfieldRouter")).deploy(
    poolManager.target,
    weth.target
  );
  await router.waitForDeployment();

  const quoter = await (await ethers.getContractFactory("Quoter")).deploy(poolManager.target);
  await quoter.waitForDeployment();

  const dynamicFeeHook = await (await ethers.getContractFactory("DynamicFeeHook")).deploy(10_000);
  await dynamicFeeHook.waitForDeployment();

  const TestToken = await ethers.getContractFactory("TestToken");
  const tokenA = await TestToken.deploy("Mayfield A", "MF-A", 18, ethers.parseEther("1000000"));
  await tokenA.waitForDeployment();
  const tokenB = await TestToken.deploy("Mayfield B", "MF-B", 18, ethers.parseEther("1000000"));
  await tokenB.waitForDeployment();

  const SQRT_PRICE_1_1 = 1n << 96n;
  await router.initializePool(tokenA.target, tokenB.target, SQRT_PRICE_1_1);

  const amount = ethers.parseEther("10000");
  await tokenA.approve(router.target, amount);
  await tokenB.approve(router.target, amount);
  const deadline = Math.floor(Date.now() / 1000) + 600;
  await router.addLiquidity(
    tokenA.target,
    tokenB.target,
    amount,
    amount,
    0,
    0,
    deployer.address,
    deadline
  );

  const contracts = {
    WETH: weth.target,
    PoolManager: poolManager.target,
    MayfieldRouter: router.target,
    Quoter: quoter.target,
    DynamicFeeHook: dynamicFeeHook.target,
    TokenA: tokenA.target,
    TokenB: tokenB.target,
  };

  fs.writeFileSync(
    "deployment-v4.json",
    JSON.stringify({ architecture: "uniswap-v4-clamm", contracts, deployer: deployer.address }, null, 2)
  );

  const config = `export const CONTRACT_ADDRESSES = {
  31337: {
    WETH: "${weth.target}",
    PoolManager: "${poolManager.target}",
    MayfieldRouter: "${router.target}",
    Quoter: "${quoter.target}",
    DynamicFeeHook: "${dynamicFeeHook.target}",
    TokenA: "${tokenA.target}",
    TokenB: "${tokenB.target}",
  },
  1: {
    WETH: "",
    PoolManager: "",
    MayfieldRouter: "",
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
  "function initializePool(address tokenA, address tokenB, uint160 sqrtPriceX96) external returns (int24 tick)",
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
`;
  fs.writeFileSync("frontend/src/contracts/config.ts", config);

  console.log("Deployed:", contracts);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
