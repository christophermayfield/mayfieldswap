const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Concentrated liquidity ranges", function () {
  const deadline = () => Math.floor(Date.now() / 1000) + 600;
  const SQRT_PRICE_1_1 = 1n << 96n;

  let poolManager, router, tokenA, tokenB;
  let lp1, lp2, trader;

  async function poolId() {
    const key = await router.defaultKey(tokenA.target, tokenB.target);
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address,address,uint24,int24,address)"],
        [[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]]
      )
    );
  }

  async function addRange(signer, tickLower, tickUpper, amountA, amountB) {
    return router.connect(signer).addLiquidityWithRange(
      tokenA.target,
      tokenB.target,
      tickLower,
      tickUpper,
      amountA,
      amountB,
      0,
      0,
      signer.address,
      deadline()
    );
  }

  beforeEach(async function () {
    [, lp1, lp2, trader] = await ethers.getSigners();

    const weth = await (await ethers.getContractFactory("WETH")).deploy();
    poolManager = await (await ethers.getContractFactory("PoolManager")).deploy();
    router = await (await ethers.getContractFactory("MayfieldRouter")).deploy(poolManager.target, weth.target);

    const TestToken = await ethers.getContractFactory("TestToken");
    tokenA = await TestToken.deploy("Token A", "TKA", 18, ethers.parseEther("1000000"));
    tokenB = await TestToken.deploy("Token B", "TKB", 18, ethers.parseEther("1000000"));

    for (const who of [lp1, lp2, trader]) {
      await tokenA.transfer(who.address, ethers.parseEther("50000"));
      await tokenB.transfer(who.address, ethers.parseEther("50000"));
      await tokenA.connect(who).approve(router.target, ethers.MaxUint256);
      await tokenB.connect(who).approve(router.target, ethers.MaxUint256);
    }

    await router.initializePool(tokenA.target, tokenB.target, SQRT_PRICE_1_1);
  });

  it("exposes the current tick on the default pool", async function () {
    const state = await router.getPoolState(tokenA.target, tokenB.target);
    expect(state.tick).to.equal(0);
    expect(state.sqrtPriceX96).to.equal(SQRT_PRICE_1_1);
  });

  it("mints a one-sided position when the range is above the current price", async function () {
    // tick 0 is below [60, 600] → position is entirely token0
    const bal0Before = await tokenA.balanceOf(lp1.address);
    const bal1Before = await tokenB.balanceOf(lp1.address);

    await addRange(lp1, 60, 600, ethers.parseEther("100"), ethers.parseEther("100"));

    const spent0 = bal0Before - (await tokenA.balanceOf(lp1.address));
    const spent1 = bal1Before - (await tokenB.balanceOf(lp1.address));
    const key = await router.defaultKey(tokenA.target, tokenB.target);
    const token0IsA = key.currency0.toLowerCase() === tokenA.target.toLowerCase();
    if (token0IsA) {
      expect(spent0).to.be.gt(0n);
      expect(spent1).to.equal(0n);
    } else {
      expect(spent1).to.be.gt(0n);
      expect(spent0).to.equal(0n);
    }

    const liq = await router.getLiquidityAt(tokenA.target, tokenB.target, lp1.address, 60, 600);
    expect(liq).to.be.gt(0n);
    expect(await router.getLiquidity(tokenA.target, tokenB.target, lp1.address)).to.equal(0n);
  });

  it("crosses a narrow range and drops that liquidity from the active set", async function () {
    // Dust full-range so the swap can complete after the concentrated range is crossed.
    await router.connect(lp2).addLiquidity(
      tokenA.target,
      tokenB.target,
      ethers.parseEther("1"),
      ethers.parseEther("1"),
      0,
      0,
      lp2.address,
      deadline()
    );
    await addRange(lp1, -60, 60, ethers.parseEther("10"), ethers.parseEther("10"));
    const id = await poolId();
    const before = await poolManager.getSlot0(id);
    expect(before.tick).to.equal(0);
    expect(before.liquidity).to.be.gt(0n);

    const key = await router.defaultKey(tokenA.target, tokenB.target);
    await router.connect(trader).swapExactTokensForTokens(
      key.currency0,
      key.currency1,
      ethers.parseEther("20"),
      0,
      trader.address,
      deadline()
    );

    const after = await poolManager.getSlot0(id);
    expect(after.tick).to.be.lt(-60);
    expect(after.liquidity).to.be.gt(0n);
    expect(after.liquidity).to.be.lt(before.liquidity);
  });

  it("does not accrue fees to an out-of-range position", async function () {
    await addRange(lp1, -60, 60, ethers.parseEther("100"), ethers.parseEther("100"));
    await addRange(lp2, 60, 600, ethers.parseEther("100"), ethers.parseEther("100"));

    const key = await router.defaultKey(tokenA.target, tokenB.target);
    await router.connect(trader).swapExactTokensForTokens(
      key.currency0,
      key.currency1,
      ethers.parseEther("5"),
      0,
      trader.address,
      deadline()
    );

    const [in0, in1] = await router.getPendingFeesAt(tokenA.target, tokenB.target, lp1.address, -60, 60);
    const [out0, out1] = await router.getPendingFeesAt(tokenA.target, tokenB.target, lp2.address, 60, 600);
    expect(in0 + in1).to.be.gt(0n);
    expect(out0 + out1).to.equal(0n);
  });

  it("collects fees on a custom range and removes that position", async function () {
    await addRange(lp1, -120, 120, ethers.parseEther("50"), ethers.parseEther("50"));
    await router.connect(trader).swapExactTokensForTokens(
      tokenB.target,
      tokenA.target,
      ethers.parseEther("2"),
      0,
      trader.address,
      deadline()
    );

    const [p0, p1] = await router.getPendingFeesAt(tokenA.target, tokenB.target, lp1.address, -120, 120);
    expect(p0 + p1).to.be.gt(0n);

    const balBefore = (await tokenA.balanceOf(lp1.address)) + (await tokenB.balanceOf(lp1.address));
    await router.connect(lp1).collectFeesWithRange(
      tokenA.target,
      tokenB.target,
      -120,
      120,
      lp1.address,
      deadline()
    );
    const balAfter = (await tokenA.balanceOf(lp1.address)) + (await tokenB.balanceOf(lp1.address));
    expect(balAfter).to.be.gt(balBefore);

    const liq = await router.getLiquidityAt(tokenA.target, tokenB.target, lp1.address, -120, 120);
    await router.connect(lp1).removeLiquidityWithRange(
      tokenA.target,
      tokenB.target,
      -120,
      120,
      liq,
      0,
      0,
      lp1.address,
      deadline()
    );
    expect(await router.getLiquidityAt(tokenA.target, tokenB.target, lp1.address, -120, 120)).to.equal(0n);
  });
});
