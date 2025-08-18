const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SushiSwap DEX", function () {
  let factory, router, tokenA, tokenB, weth;
  let owner, addr1, addr2;

  before(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    // Deploy WETH
    const WETH = await ethers.getContractFactory("WETH");
    weth = await WETH.deploy();

    // Deploy Factory
    const SushiFactory = await ethers.getContractFactory("SushiFactory");
    factory = await SushiFactory.deploy(owner.address);

    // Deploy Router
    const SushiRouter = await ethers.getContractFactory("SushiRouter");
    router = await SushiRouter.deploy(factory.target, weth.target);

    // Deploy test tokens
    const TestToken = await ethers.getContractFactory("TestToken");
    tokenA = await TestToken.deploy("Token A", "TKA", 18, ethers.parseEther("1000000"));
    tokenB = await TestToken.deploy("Token B", "TKB", 18, ethers.parseEther("1000000"));

    // Transfer some tokens to test addresses
    await tokenA.transfer(addr1.address, ethers.parseEther("10000"));
    await tokenB.transfer(addr1.address, ethers.parseEther("10000"));
  });

  describe("Factory", function () {
    it("Should create a new pair", async function () {
      await factory.createPair(tokenA.target, tokenB.target);
      const pairAddress = await factory.getPair(tokenA.target, tokenB.target);
      expect(pairAddress).to.not.equal(ethers.ZeroAddress);
    });

    it("Should fail to create duplicate pair", async function () {
      await expect(
        factory.createPair(tokenA.target, tokenB.target)
      ).to.be.revertedWith("SushiFactory: PAIR_EXISTS");
    });

    it("Should return correct pairs count", async function () {
      const pairsCount = await factory.allPairsLength();
      expect(pairsCount).to.equal(1);
    });
  });

  describe("Router - Add Liquidity", function () {
    beforeEach(async function () {
      // Approve router to spend tokens
      await tokenA.connect(addr1).approve(router.target, ethers.parseEther("1000"));
      await tokenB.connect(addr1).approve(router.target, ethers.parseEther("1000"));
    });

    it("Should add liquidity to a new pair", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

      await router.connect(addr1).addLiquidity(
        tokenA.target,
        tokenB.target,
        ethers.parseEther("100"),
        ethers.parseEther("100"),
        ethers.parseEther("90"),
        ethers.parseEther("90"),
        addr1.address,
        deadline
      );

      const pairAddress = await factory.getPair(tokenA.target, tokenB.target);
      const Pair = await ethers.getContractFactory("SushiPair");
      const pair = Pair.attach(pairAddress);
      
      const liquidity = await pair.balanceOf(addr1.address);
      expect(liquidity).to.be.gt(0);
    });

    it("Should add liquidity with ETH", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;

      await router.connect(addr1).addLiquidityETH(
        tokenA.target,
        ethers.parseEther("50"),
        ethers.parseEther("45"),
        ethers.parseEther("0.9"),
        addr1.address,
        deadline,
        { value: ethers.parseEther("1") }
      );

      const pairAddress = await factory.getPair(tokenA.target, weth.target);
      expect(pairAddress).to.not.equal(ethers.ZeroAddress);
    });
  });

  describe("Router - Swap", function () {
    beforeEach(async function () {
      // Add initial liquidity
      const deadline = Math.floor(Date.now() / 1000) + 300;
      
      await tokenA.connect(addr1).approve(router.target, ethers.parseEther("1000"));
      await tokenB.connect(addr1).approve(router.target, ethers.parseEther("1000"));

      await router.connect(addr1).addLiquidity(
        tokenA.target,
        tokenB.target,
        ethers.parseEther("500"),
        ethers.parseEther("500"),
        0,
        0,
        addr1.address,
        deadline
      );
    });

    it("Should swap exact tokens for tokens", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const amountIn = ethers.parseEther("10");
      
      // Get initial balance
      const initialBalance = await tokenB.balanceOf(addr1.address);
      
      // Approve tokens for swap
      await tokenA.connect(addr1).approve(router.target, amountIn);

      // Perform swap
      await router.connect(addr1).swapExactTokensForTokens(
        amountIn,
        0, // Accept any amount of tokens out
        [tokenA.target, tokenB.target],
        addr1.address,
        deadline
      );

      // Check balance increased
      const finalBalance = await tokenB.balanceOf(addr1.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });

    it("Should swap ETH for tokens", async function () {
      // First add ETH/TokenA liquidity
      const deadline = Math.floor(Date.now() / 1000) + 300;
      
      await tokenA.connect(addr1).approve(router.target, ethers.parseEther("100"));
      await router.connect(addr1).addLiquidityETH(
        tokenA.target,
        ethers.parseEther("100"),
        0,
        0,
        addr1.address,
        deadline,
        { value: ethers.parseEther("1") }
      );

      // Get initial token balance
      const initialBalance = await tokenA.balanceOf(addr2.address);

      // Swap ETH for tokens
      await router.connect(addr2).swapExactETHForTokens(
        0,
        [weth.target, tokenA.target],
        addr2.address,
        deadline,
        { value: ethers.parseEther("0.1") }
      );

      // Check balance increased
      const finalBalance = await tokenA.balanceOf(addr2.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });
  });

  describe("Router - Remove Liquidity", function () {
    let pairAddress, pair;

    beforeEach(async function () {
      // Add liquidity first
      const deadline = Math.floor(Date.now() / 1000) + 300;
      
      await tokenA.connect(addr1).approve(router.target, ethers.parseEther("200"));
      await tokenB.connect(addr1).approve(router.target, ethers.parseEther("200"));

      await router.connect(addr1).addLiquidity(
        tokenA.target,
        tokenB.target,
        ethers.parseEther("200"),
        ethers.parseEther("200"),
        0,
        0,
        addr1.address,
        deadline
      );

      pairAddress = await factory.getPair(tokenA.target, tokenB.target);
      const Pair = await ethers.getContractFactory("SushiPair");
      pair = Pair.attach(pairAddress);
    });

    it("Should remove liquidity", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const liquidity = await pair.balanceOf(addr1.address);
      const halfLiquidity = liquidity / 2n;

      // Get initial token balances
      const initialBalanceA = await tokenA.balanceOf(addr1.address);
      const initialBalanceB = await tokenB.balanceOf(addr1.address);

      // Approve router to spend LP tokens
      await pair.connect(addr1).approve(router.target, halfLiquidity);

      // Remove liquidity
      await router.connect(addr1).removeLiquidity(
        tokenA.target,
        tokenB.target,
        halfLiquidity,
        0,
        0,
        addr1.address,
        deadline
      );

      // Check balances increased
      const finalBalanceA = await tokenA.balanceOf(addr1.address);
      const finalBalanceB = await tokenB.balanceOf(addr1.address);
      
      expect(finalBalanceA).to.be.gt(initialBalanceA);
      expect(finalBalanceB).to.be.gt(initialBalanceB);
    });
  });

  describe("Price Calculations", function () {
    it("Should return correct quote", async function () {
      const amountA = ethers.parseEther("100");
      const reserveA = ethers.parseEther("1000");
      const reserveB = ethers.parseEther("2000");

      const amountB = await router.quote(amountA, reserveA, reserveB);
      expect(amountB).to.equal(ethers.parseEther("200"));
    });

    it("Should calculate amount out correctly", async function () {
      const amountIn = ethers.parseEther("100");
      const reserveIn = ethers.parseEther("1000");
      const reserveOut = ethers.parseEther("1000");

      const amountOut = await router.getAmountOut(amountIn, reserveIn, reserveOut);
      
      // With 0.3% fee, amount out should be less than simple proportion
      expect(amountOut).to.be.lt(ethers.parseEther("100"));
      expect(amountOut).to.be.gt(ethers.parseEther("90"));
    });
  });
});
