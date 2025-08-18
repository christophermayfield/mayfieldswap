const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Deploy WETH
  console.log("\n1. Deploying WETH...");
  const WETH = await ethers.getContractFactory("WETH");
  const weth = await WETH.deploy();
  await weth.waitForDeployment();
  console.log("WETH deployed to:", weth.target);

  // Deploy Factory
  console.log("\n2. Deploying SushiFactory...");
  const SushiFactory = await ethers.getContractFactory("SushiFactory");
  const factory = await SushiFactory.deploy(deployer.address);
  await factory.waitForDeployment();
  console.log("SushiFactory deployed to:", factory.target);

  // Deploy Router
  console.log("\n3. Deploying SushiRouter...");
  const SushiRouter = await ethers.getContractFactory("SushiRouter");
  const router = await SushiRouter.deploy(factory.target, weth.target);
  await router.waitForDeployment();
  console.log("SushiRouter deployed to:", router.target);

  // Deploy test tokens for development
  console.log("\n4. Deploying Test Tokens...");
  const TestToken = await ethers.getContractFactory("TestToken");
  
  const tokenA = await TestToken.deploy("SushiToken A", "SUSH-A", 18, ethers.parseEther("1000000"));
  await tokenA.waitForDeployment();
  console.log("Token A deployed to:", tokenA.target);

  const tokenB = await TestToken.deploy("SushiToken B", "SUSH-B", 18, ethers.parseEther("1000000"));
  await tokenB.waitForDeployment();
  console.log("Token B deployed to:", tokenB.target);

  // Create initial pair
  console.log("\n5. Creating initial pair...");
  await factory.createPair(tokenA.target, tokenB.target);
  const pairAddress = await factory.getPair(tokenA.target, tokenB.target);
  console.log("Pair created at:", pairAddress);

  // Add initial liquidity
  console.log("\n6. Adding initial liquidity...");
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now
  const liquidityAmount = ethers.parseEther("10000");

  // Approve router to spend tokens
  await tokenA.approve(router.target, liquidityAmount);
  await tokenB.approve(router.target, liquidityAmount);

  // Add liquidity
  const tx = await router.addLiquidity(
    tokenA.target,
    tokenB.target,
    liquidityAmount,
    liquidityAmount,
    0, // Accept any amount of tokens
    0, // Accept any amount of tokens
    deployer.address,
    deadline
  );
  await tx.wait();
  console.log("Initial liquidity added successfully!");

  // Summary
  console.log("\n=== DEPLOYMENT SUMMARY ===");
  console.log("WETH:", weth.target);
  console.log("Factory:", factory.target);
  console.log("Router:", router.target);
  console.log("Token A:", tokenA.target);
  console.log("Token B:", tokenB.target);
  console.log("Pair Address:", pairAddress);
  
  // Save deployment addresses
  const network = await ethers.provider.getNetwork();
  const deploymentInfo = {
    network: network.name,
    chainId: network.chainId.toString(),
    deployer: deployer.address,
    contracts: {
      WETH: weth.target,
      SushiFactory: factory.target,
      SushiRouter: router.target,
      TokenA: tokenA.target,
      TokenB: tokenB.target,
      InitialPair: pairAddress
    }
  };

  const fs = require('fs');
  fs.writeFileSync('deployment.json', JSON.stringify(deploymentInfo, null, 2));
  console.log("\nDeployment info saved to deployment.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
