const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LP fee growth", function () {
  const deadline = () => Math.floor(Date.now() / 1000) + 600;
  const SQRT_PRICE_1_1 = 1n << 96n;
  const FEE_PIPS = 3000n;

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

  async function addFullRange(signer, amount) {
    await router.connect(signer).addLiquidity(
      tokenA.target,
      tokenB.target,
      amount,
      amount,
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
    await addFullRange(lp1, ethers.parseEther("1000"));
  });

  it("grows global fee trackers on swap", async function () {
    const id = await poolId();
    const [g0Before, g1Before] = await poolManager.getFeeGrowthGlobals(id);

    await router.connect(trader).swapExactTokensForTokens(
      tokenA.target,
      tokenB.target,
      ethers.parseEther("10"),
      0,
      trader.address,
      deadline()
    );

    const [g0After, g1After] = await poolManager.getFeeGrowthGlobals(id);
    expect(g0After + g1After).to.be.gt(g0Before + g1Before);
  });

  it("previews pending fees without a poke, then LPs collect ~0.3% of swap input", async function () {
    const amountIn = ethers.parseEther("10");
    const expectedFee = (amountIn * FEE_PIPS) / 1_000_000n;

    await router.connect(trader).swapExactTokensForTokens(
      tokenA.target,
      tokenB.target,
      amountIn,
      0,
      trader.address,
      deadline()
    );

    const [pending0, pending1] = await router.getPendingFees(tokenA.target, tokenB.target, lp1.address);
    const pendingTotal = pending0 + pending1;
    expect(pendingTotal).to.be.gt(0n);

    // Full-range LP at 1:1 should receive nearly the whole input fee (rounding only).
    const previewDelta = pendingTotal > expectedFee ? pendingTotal - expectedFee : expectedFee - pendingTotal;
    expect(previewDelta).to.be.lte(expectedFee / 20n);

    const balABefore = await tokenA.balanceOf(lp1.address);
    const balBBefore = await tokenB.balanceOf(lp1.address);

    await router.connect(lp1).collectFees(tokenA.target, tokenB.target, lp1.address, deadline());

    const collected =
      (await tokenA.balanceOf(lp1.address)) - balABefore + ((await tokenB.balanceOf(lp1.address)) - balBBefore);
    expect(collected).to.equal(pendingTotal);
    const collectDelta = collected > expectedFee ? collected - expectedFee : expectedFee - collected;
    expect(collectDelta).to.be.lte(expectedFee / 20n);

    const [after0, after1] = await router.getPendingFees(tokenA.target, tokenB.target, lp1.address);
    expect(after0 + after1).to.equal(0n);
  });

  it("reverts when collecting with nothing owed", async function () {
    await expect(
      router.connect(lp1).collectFees(tokenA.target, tokenB.target, lp1.address, deadline())
    ).to.be.revertedWith("Router: no fees");
  });

  it("isolates positions and fees per LP salt", async function () {
    await addFullRange(lp2, ethers.parseEther("500"));

    await router.connect(trader).swapExactTokensForTokens(
      tokenA.target,
      tokenB.target,
      ethers.parseEther("30"),
      0,
      trader.address,
      deadline()
    );

    const liq1 = await router.getLiquidity(tokenA.target, tokenB.target, lp1.address);
    const liq2 = await router.getLiquidity(tokenA.target, tokenB.target, lp2.address);
    expect(liq1).to.be.gt(liq2);

    const [p10, p11] = await router.getPendingFees(tokenA.target, tokenB.target, lp1.address);
    const [p20, p21] = await router.getPendingFees(tokenA.target, tokenB.target, lp2.address);
    const fees1 = p10 + p11;
    const fees2 = p20 + p21;
    expect(fees1).to.be.gt(0n);
    expect(fees2).to.be.gt(0n);

    // lp1 provided 2x the liquidity of lp2, so fees should be ~2x.
    const twiceFees2 = fees2 * 2n;
    const delta = fees1 > twiceFees2 ? fees1 - twiceFees2 : twiceFees2 - fees1;
    expect(delta).to.be.lt(fees1 / 10n);

    const bal2Before = await tokenA.balanceOf(lp2.address) + await tokenB.balanceOf(lp2.address);
    await router.connect(lp2).collectFees(tokenA.target, tokenB.target, lp2.address, deadline());
    const bal2After = await tokenA.balanceOf(lp2.address) + await tokenB.balanceOf(lp2.address);
    expect(bal2After).to.be.gt(bal2Before);

    // lp1 still has uncollected fees after lp2 collects.
    const [still0, still1] = await router.getPendingFees(tokenA.target, tokenB.target, lp1.address);
    expect(still0 + still1).to.equal(fees1);
  });

  it("returns principal plus uncollected fees on remove", async function () {
    await router.connect(trader).swapExactTokensForTokens(
      tokenA.target,
      tokenB.target,
      ethers.parseEther("10"),
      0,
      trader.address,
      deadline()
    );

    const [pending0, pending1] = await router.getPendingFees(tokenA.target, tokenB.target, lp1.address);
    expect(pending0 + pending1).to.be.gt(0n);

    const liq = await router.getLiquidity(tokenA.target, tokenB.target, lp1.address);
    const balABefore = await tokenA.balanceOf(lp1.address);
    const balBBefore = await tokenB.balanceOf(lp1.address);

    await router.connect(lp1).removeLiquidity(
      tokenA.target,
      tokenB.target,
      liq,
      0,
      0,
      lp1.address,
      deadline()
    );

    const receivedA = (await tokenA.balanceOf(lp1.address)) - balABefore;
    const receivedB = (await tokenB.balanceOf(lp1.address)) - balBBefore;
    expect(receivedA + receivedB).to.be.gt(ethers.parseEther("1999"));
    expect(await router.getLiquidity(tokenA.target, tokenB.target, lp1.address)).to.equal(0n);

    const [left0, left1] = await router.getPendingFees(tokenA.target, tokenB.target, lp1.address);
    expect(left0 + left1).to.equal(0n);
  });
});
