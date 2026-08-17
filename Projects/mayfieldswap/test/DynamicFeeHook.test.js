const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DynamicFeeHook", function () {
  const deadline = () => Math.floor(Date.now() / 1000) + 600;
  const SQRT_PRICE_1_1 = 1n << 96n;
  const HOOK_FEE = 10_000; // 1%

  let router, tokenA, tokenB, hook, hookedKey, defaultKey;
  let lp, trader;

  async function fullRange() {
    return router.fullRangeTicks();
  }

  function asKey(k) {
    return {
      currency0: k.currency0,
      currency1: k.currency1,
      fee: k.fee,
      tickSpacing: k.tickSpacing,
      hooks: k.hooks,
    };
  }

  beforeEach(async function () {
    [, lp, trader] = await ethers.getSigners();

    const weth = await (await ethers.getContractFactory("WETH")).deploy();
    const poolManager = await (await ethers.getContractFactory("PoolManager")).deploy();
    router = await (await ethers.getContractFactory("MayfieldRouter")).deploy(poolManager.target, weth.target);
    hook = await (await ethers.getContractFactory("DynamicFeeHook")).deploy(HOOK_FEE);

    const TestToken = await ethers.getContractFactory("TestToken");
    tokenA = await TestToken.deploy("Token A", "TKA", 18, ethers.parseEther("1000000"));
    tokenB = await TestToken.deploy("Token B", "TKB", 18, ethers.parseEther("1000000"));

    for (const who of [lp, trader]) {
      await tokenA.transfer(who.address, ethers.parseEther("50000"));
      await tokenB.transfer(who.address, ethers.parseEther("50000"));
      await tokenA.connect(who).approve(router.target, ethers.MaxUint256);
      await tokenB.connect(who).approve(router.target, ethers.MaxUint256);
    }

    defaultKey = asKey(await router.defaultKey(tokenA.target, tokenB.target));
    hookedKey = asKey(
      await router.poolKey(tokenA.target, tokenB.target, 3000, 60, hook.target)
    );

    await router.initializePoolKey(defaultKey, SQRT_PRICE_1_1);
    await router.initializePoolKey(hookedKey, SQRT_PRICE_1_1);

    const [tickLower, tickUpper] = await fullRange();
    const amount = ethers.parseEther("1000");
    await router.connect(lp).addLiquidityOnPool(
      defaultKey,
      tickLower,
      tickUpper,
      amount,
      amount,
      0,
      0,
      lp.address,
      deadline()
    );
    await router.connect(lp).addLiquidityOnPool(
      hookedKey,
      tickLower,
      tickUpper,
      amount,
      amount,
      0,
      0,
      lp.address,
      deadline()
    );
  });

  it("charges the hook fee instead of the pool fee", async function () {
    const amountIn = ethers.parseEther("10");
    const tokenIn = tokenA.target;

    const outDefault = await router.connect(trader).swapExactInputOnPool.staticCall(
      defaultKey,
      tokenIn,
      amountIn,
      0,
      trader.address,
      deadline()
    );
    const outHooked = await router.connect(trader).swapExactInputOnPool.staticCall(
      hookedKey,
      tokenIn,
      amountIn,
      0,
      trader.address,
      deadline()
    );

    expect(outHooked).to.be.lt(outDefault);
    // 1% vs 0.30% → hooked output should be ~0.7% lower, with price-impact slack.
    const delta = outDefault - outHooked;
    expect(delta).to.be.gt(amountIn / 500n);
    expect(delta).to.be.lt(amountIn / 50n);
  });

  it("lets the owner update the hook fee", async function () {
    await expect(hook.setFee(5_000)).to.emit(hook, "FeeSet").withArgs(5_000);
    expect(await hook.getSwapFee(hookedKey)).to.equal(5_000);
    await expect(hook.connect(trader).setFee(1_000)).to.be.revertedWith("DynamicFee: owner");
  });

  it("EmptyHooks keeps the pool's initialized fee", async function () {
    const empty = await (await ethers.getContractFactory("EmptyHooks")).deploy();
    const emptyKey = asKey(await router.poolKey(tokenA.target, tokenB.target, 3000, 60, empty.target));
    await router.initializePoolKey(emptyKey, SQRT_PRICE_1_1);

    const [tickLower, tickUpper] = await fullRange();
    const amount = ethers.parseEther("1000");
    await router.connect(lp).addLiquidityOnPool(
      emptyKey,
      tickLower,
      tickUpper,
      amount,
      amount,
      0,
      0,
      lp.address,
      deadline()
    );

    const amountIn = ethers.parseEther("10");
    const outDefault = await router.connect(trader).swapExactInputOnPool.staticCall(
      defaultKey,
      tokenA.target,
      amountIn,
      0,
      trader.address,
      deadline()
    );
    const outEmpty = await router.connect(trader).swapExactInputOnPool.staticCall(
      emptyKey,
      tokenA.target,
      amountIn,
      0,
      trader.address,
      deadline()
    );
    expect(outEmpty).to.equal(outDefault);
  });
});
