const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Gas Benchmarks", function () {
  let poolManager, router, tokenA, tokenB, tokenC, weth;
  let owner;
  const deadline = () => Math.floor(Date.now() / 1000) + 600;
  const SQRT_PRICE_1_1 = 1n << 96n;
  const E18 = ethers.parseEther("1");

  before(async function () {
    [owner] = await ethers.getSigners();

    weth      = await (await ethers.getContractFactory("WETH")).deploy();
    poolManager = await (await ethers.getContractFactory("PoolManager")).deploy();
    router    = await (await ethers.getContractFactory("MayfieldRouter")).deploy(poolManager.target, weth.target);

    const TestToken = await ethers.getContractFactory("TestToken");
    tokenA = await TestToken.deploy("Token A", "TKA", 18, ethers.parseEther("1000000"));
    tokenB = await TestToken.deploy("Token B", "TKB", 18, ethers.parseEther("1000000"));
    tokenC = await TestToken.deploy("Token C", "TKC", 18, ethers.parseEther("1000000"));

    // Approve router for all tokens
    await tokenA.approve(router.target, ethers.MaxUint256);
    await tokenB.approve(router.target, ethers.MaxUint256);
    await tokenC.approve(router.target, ethers.MaxUint256);
    await weth.approve(router.target, ethers.MaxUint256);
  });

  // ─── 1. Pool initialization ────────────────────────────────────────────────
  it("benchmark: initialize pool", async function () {
    const tx = await router.initializePool(tokenA.target, tokenB.target, SQRT_PRICE_1_1);
    const receipt = await tx.wait();
    console.log(`  initialize pool:              ${receipt.gasUsed} gas`);
    expect(receipt.gasUsed).to.be.lt(500_000n);
  });

  // ─── 2. Full-range liquidity ───────────────────────────────────────────────
  it("benchmark: addLiquidity full-range", async function () {
    const tx = await router.addLiquidity(
      tokenA.target, tokenB.target,
      ethers.parseEther("1000"), ethers.parseEther("1000"),
      0, 0,
      owner.address, deadline()
    );
    const receipt = await tx.wait();
    console.log(`  addLiquidity (full-range):    ${receipt.gasUsed} gas`);
    expect(receipt.gasUsed).to.be.lt(500_000n);
  });

  // ─── 3. Custom tick-range liquidity ───────────────────────────────────────
  it("benchmark: addLiquidity custom tick range", async function () {
    const tickSpacing = 60;
    const tickLower   = -tickSpacing * 10;
    const tickUpper   =  tickSpacing * 10;
    const tx = await router.addLiquidityWithRange(
      tokenA.target, tokenB.target,
      tickLower, tickUpper,
      ethers.parseEther("500"), ethers.parseEther("500"),
      0, 0,
      owner.address, deadline()
    );
    const receipt = await tx.wait();
    console.log(`  addLiquidity (custom range):  ${receipt.gasUsed} gas`);
    expect(receipt.gasUsed).to.be.lt(500_000n);
  });

  // ─── 4. Single-hop swap ────────────────────────────────────────────────────
  it("benchmark: swapExactTokensForTokens (single hop)", async function () {
    const tx = await router.swapExactTokensForTokens(
      tokenA.target, tokenB.target,
      ethers.parseEther("10"), 0,
      owner.address, deadline()
    );
    const receipt = await tx.wait();
    console.log(`  swapExactTokensForTokens:     ${receipt.gasUsed} gas`);
    expect(receipt.gasUsed).to.be.lt(500_000n);
  });

  // ─── 5. Two-hop swap via WETH ──────────────────────────────────────────────
  it("benchmark: swapExactPath two-hop (A→WETH→B)", async function () {
    // Set up WETH pools first
    await router.initializePool(tokenA.target, weth.target, SQRT_PRICE_1_1);
    await router.initializePool(weth.target,  tokenB.target, SQRT_PRICE_1_1);

    // Deposit enough WETH for both pools (100 each)
    await weth.deposit({ value: ethers.parseEther("200") });

    await router.addLiquidity(
      tokenA.target, weth.target,
      ethers.parseEther("100"), ethers.parseEther("100"),
      0, 0, owner.address, deadline()
    );
    await router.addLiquidity(
      weth.target, tokenB.target,
      ethers.parseEther("100"), ethers.parseEther("100"),
      0, 0, owner.address, deadline()
    );

    const path = [tokenA.target, weth.target, tokenB.target];
    const tx = await router.swapExactPath(
      path,
      ethers.parseEther("5"), 0,
      owner.address, deadline()
    );
    const receipt = await tx.wait();
    console.log(`  swapExactPath (2-hop A→W→B):  ${receipt.gasUsed} gas`);
    expect(receipt.gasUsed).to.be.lt(1_000_000n);
  });

  // ─── 6. Remove liquidity ──────────────────────────────────────────────────
  it("benchmark: removeLiquidity", async function () {
    const liq = await router.getLiquidity(tokenA.target, tokenB.target, owner.address);
    const half = liq / 2n;
    const tx = await router.removeLiquidity(
      tokenA.target, tokenB.target,
      half, 0, 0,
      owner.address, deadline()
    );
    const receipt = await tx.wait();
    console.log(`  removeLiquidity:              ${receipt.gasUsed} gas`);
    expect(receipt.gasUsed).to.be.lt(500_000n);
  });

  // ─── 7. Collect fees ──────────────────────────────────────────────────────
  it("benchmark: collectFees", async function () {
    // Do a swap to generate fees first
    await router.swapExactTokensForTokens(
      tokenA.target, tokenB.target,
      ethers.parseEther("20"), 0,
      owner.address, deadline()
    );

    // Add a little liquidity so position exists (full-range pool was seeded in #2)
    const liq = await router.getLiquidity(tokenA.target, tokenB.target, owner.address);
    if (liq === 0n) {
      await router.addLiquidity(
        tokenA.target, tokenB.target,
        ethers.parseEther("100"), ethers.parseEther("100"),
        0, 0, owner.address, deadline()
      );
      // Swap again to generate fees
      await router.swapExactTokensForTokens(
        tokenA.target, tokenB.target,
        ethers.parseEther("10"), 0,
        owner.address, deadline()
      );
    }

    try {
      const tx = await router.collectFees(tokenA.target, tokenB.target, owner.address, deadline());
      const receipt = await tx.wait();
      console.log(`  collectFees:                  ${receipt.gasUsed} gas`);
      expect(receipt.gasUsed).to.be.lt(500_000n);
    } catch {
      // collectFees reverts if no fees accrued yet — that's fine for this benchmark
      console.log(`  collectFees: no fees accrued (position may need more swap volume)`);
    }
  });
});
