const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying V4 MayfieldSwap with:", deployer.address);
  console.log("Balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  console.log("\n1. Deploying WETH...");
  const WETH = await ethers.getContractFactory("WETH");
  const weth = await WETH.deploy();
  await weth.waitForDeployment();
  console.log("WETH:", weth.target);

  console.log("\n2. Deploying MayfieldPoolManager...");
  const MayfieldPoolManager = await ethers.getContractFactory("MayfieldPoolManager");
  const poolManager = await MayfieldPoolManager.deploy();
  await poolManager.waitForDeployment();
  console.log("PoolManager:", poolManager.target);

  console.log("\n3. Deploying MayfieldRouter...");
  const MayfieldRouter = await ethers.getContractFactory("MayfieldRouter");
  const router = await MayfieldRouter.deploy(poolManager.target, weth.target);
  await router.waitForDeployment();
  console.log("Router:", router.target);

  console.log("\n4. Deploying test tokens...");
  const TestToken = await ethers.getContractFactory("TestToken");
  const tokenA = await TestToken.deploy("Mayfield Token A", "MF-A", 18, ethers.parseEther("1000000"));
  await tokenA.waitForDeployment();
  const tokenB = await TestToken.deploy("Mayfield Token B", "MF-B", 18, ethers.parseEther("1000000"));
  await tokenB.waitForDeployment();
  console.log("Token A:", tokenA.target);
  console.log("Token B:", tokenB.target);

  console.log("\n5. Initializing pool + adding liquidity...");
  await router.initializePool(tokenA.target, tokenB.target, 3000, ethers.ZeroAddress);

  const deadline = Math.floor(Date.now() / 1000) + 600;
  const liquidityAmount = ethers.parseEther("10000");
  await tokenA.approve(router.target, liquidityAmount);
  await tokenB.approve(router.target, liquidityAmount);

  await router.addLiquidity(
    tokenA.target,
    tokenB.target,
    liquidityAmount,
    liquidityAmount,
    0,
    0,
    deployer.address,
    deadline
  );
  console.log("Initial liquidity added.");

  const deploymentInfo = {
    architecture: "uniswap-v4-style",
    network: (await ethers.provider.getNetwork()).name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    contracts: {
      WETH: weth.target,
      MayfieldPoolManager: poolManager.target,
      MayfieldRouter: router.target,
      TokenA: tokenA.target,
      TokenB: tokenB.target,
    },
  };

  fs.writeFileSync("deployment-v4.json", JSON.stringify(deploymentInfo, null, 2));

  // Keep frontend addresses in sync for local Hardhat deploys
  const frontendConfig = `// Contract addresses — update after \`npm run deploy:v4\` / localhost deploy
export const CONTRACT_ADDRESSES = {
  31337: {
    WETH: "${weth.target}",
    MayfieldPoolManager: "${poolManager.target}",
    MayfieldRouter: "${router.target}",
    TokenA: "${tokenA.target}",
    TokenB: "${tokenB.target}",
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
`;
  fs.writeFileSync("frontend/src/contracts/config.ts", frontendConfig);

  console.log("\n=== V4 DEPLOYMENT SUMMARY ===");
  console.log(JSON.stringify(deploymentInfo.contracts, null, 2));
  console.log("\nSaved to deployment-v4.json and frontend/src/contracts/config.ts");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
