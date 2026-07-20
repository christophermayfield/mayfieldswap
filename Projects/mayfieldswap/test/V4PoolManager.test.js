const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MayfieldSwap V4 PoolManager", function () {
  let poolManager, router, tokenA, tokenB, weth;
  let owner, addr1;

  before(async function () {
    [owner, addr1] = await ethers.getSigners();

    const WETH = await ethers.getContractFactory("WETH");
    weth = await WETH.deploy();

    const MayfieldPoolManager = await ethers.getContractFactory("MayfieldPoolManager");
    poolManager = await MayfieldPoolManager.deploy();

    const MayfieldRouter = await ethers.getContractFactory("MayfieldRouter");
    router = await MayfieldRouter.deploy(poolManager.target, weth.target);

    const TestToken = await ethers.getContractFactory("TestToken");
    tokenA = await TestToken.deploy("Token A", "TKA", 18, ethers.parseEther("1000000"));
    tokenB = await TestToken.deploy("Token B", "TKB", 18, ethers.parseEther("1000000"));

    await tokenA.transfer(addr1.address, ethers.parseEther("10000"));
    await tokenB.transfer(addr1.address, ethers.parseEther("10000"));
  });

  describe("Pool initialize", function () {
    it("initializes a pool via router", async function () {
      const tx = await router.initializePool(tokenA.target, tokenB.target, 3000, ethers.ZeroAddress);
      await expect(tx).to.emit(poolManager, "Initialize");

      const key = await router.poolKeyFor(tokenA.target, tokenB.target);
      const id = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(address,address,uint24,int24,address)"],
          [[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]]
        )
      );
      expect(await poolManager.isInitialized(id)).to.equal(true);
    });

    it("reverts on duplicate initialize", async function () {
      await expect(
        router.initializePool(tokenA.target, tokenB.target, 3000, ethers.ZeroAddress)
      ).to.be.revertedWith("PoolManager: ALREADY_INITIALIZED");
    });
  });

  describe("Add liquidity", function () {
    beforeEach(async function () {
      await tokenA.connect(addr1).approve(router.target, ethers.parseEther("10000"));
      await tokenB.connect(addr1).approve(router.target, ethers.parseEther("10000"));
    });

    it("adds liquidity through unlock/settle", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
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

      const key = await router.poolKeyFor(tokenA.target, tokenB.target);
      const id = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(address,address,uint24,int24,address)"],
          [[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]]
        )
      );
      const liq = await poolManager.getLiquidity(id, addr1.address);
      expect(liq).to.be.gt(0);

      const [r0, r1] = await poolManager.getReserves(id);
      expect(r0).to.equal(ethers.parseEther("100"));
      expect(r1).to.equal(ethers.parseEther("100"));
    });
  });

  describe("Swap", function () {
    it("swaps exact tokens for tokens", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const amountIn = ethers.parseEther("1");
      const expectedOut = await router.getAmountOut(tokenA.target, tokenB.target, amountIn);

      const balBefore = await tokenB.balanceOf(addr1.address);
      await router.connect(addr1).swapExactTokensForTokens(
        tokenA.target,
        tokenB.target,
        amountIn,
        expectedOut,
        addr1.address,
        deadline
      );
      const balAfter = await tokenB.balanceOf(addr1.address);
      expect(balAfter - balBefore).to.equal(expectedOut);
    });

    it("getAmountsOut returns a path quote", async function () {
      const amounts = await router.getAmountsOut(ethers.parseEther("1"), [
        tokenA.target,
        tokenB.target,
      ]);
      expect(amounts.length).to.equal(2);
      expect(amounts[1]).to.be.gt(0);
    });
  });

  describe("Remove liquidity", function () {
    it("removes liquidity and returns tokens", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const key = await router.poolKeyFor(tokenA.target, tokenB.target);
      const id = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(address,address,uint24,int24,address)"],
          [[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]]
        )
      );
      const liq = await poolManager.getLiquidity(id, addr1.address);
      const half = liq / 2n;

      const balABefore = await tokenA.balanceOf(addr1.address);
      await router.connect(addr1).removeLiquidity(
        tokenA.target,
        tokenB.target,
        half,
        0,
        0,
        addr1.address,
        deadline
      );
      const balAAfter = await tokenA.balanceOf(addr1.address);
      expect(balAAfter).to.be.gt(balABefore);
      expect(await poolManager.getLiquidity(id, addr1.address)).to.equal(liq - half);
    });
  });
});
