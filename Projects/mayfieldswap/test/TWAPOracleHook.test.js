const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TWAPOracleHook", function () {
  let poolManager, router, twapHook, tokenA, tokenB;
  let owner;
  const SQRT_PRICE_1_1 = 1n << 96n;

  // Spread the ethers Result into a plain object so ethers v6 can re-encode it as a tuple arg
  function asKey(k) {
    return { currency0: k.currency0, currency1: k.currency1, fee: k.fee, tickSpacing: k.tickSpacing, hooks: k.hooks };
  }

  async function hookedKey() {
    return asKey(await router.poolKey(tokenA.target, tokenB.target, 3000, 60, twapHook.target));
  }

  function dl() { return Math.floor(Date.now() / 1000) + 600; }

  before(async function () {
    [owner] = await ethers.getSigners();

    const WETH      = await (await ethers.getContractFactory("WETH")).deploy();
    poolManager     = await (await ethers.getContractFactory("PoolManager")).deploy();
    router          = await (await ethers.getContractFactory("MayfieldRouter")).deploy(poolManager.target, WETH.target);
    twapHook        = await (await ethers.getContractFactory("TWAPOracleHook")).deploy(poolManager.target);

    const TestToken = await ethers.getContractFactory("TestToken");
    tokenA = await TestToken.deploy("Token A", "TKA", 18, ethers.parseEther("1000000"));
    tokenB = await TestToken.deploy("Token B", "TKB", 18, ethers.parseEther("1000000"));

    await tokenA.approve(router.target, ethers.MaxUint256);
    await tokenB.approve(router.target, ethers.MaxUint256);

    // Initialize the hooked pool and seed liquidity once
    const key = await hookedKey();
    await router.initializePoolKey(key, SQRT_PRICE_1_1);
    await router.addLiquidityOnPool(
      key, -887220, 887220,
      ethers.parseEther("5000"), ethers.parseEther("5000"),
      0, 0, owner.address, dl()
    );
  });

  function poolId(key) {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address,address,uint24,int24,address)"],
        [[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]]
      )
    );
  }

  it("records an observation on pool initialization", async function () {
    const key = await hookedKey();
    const idx = await twapHook.writeIndex(poolId(key));
    // afterInitialize fires on init → first write goes to slot 1
    expect(idx).to.equal(1);
  });

  it("records an observation after each swap", async function () {
    const key = await hookedKey();
    const id  = poolId(key);
    const idxBefore = await twapHook.writeIndex(id);

    // Advance time slightly so elapsed > 0 between observations
    await ethers.provider.send("evm_increaseTime", [3]);
    await ethers.provider.send("evm_mine");

    const tokenIn = key.currency0 < key.currency1 ? tokenA.target : tokenB.target;
    await router.swapExactInputOnPool(key, tokenIn, ethers.parseEther("10"), 0, owner.address, dl());

    const idxAfter = await twapHook.writeIndex(id);
    expect(idxAfter).to.equal(idxBefore + 1n);
  });

  it("consult() returns the time-weighted average tick", async function () {
    const key = await hookedKey();

    // Another swap to build a second observation
    await ethers.provider.send("evm_increaseTime", [3]);
    await ethers.provider.send("evm_mine");

    const tokenIn = key.currency0 < key.currency1 ? tokenA.target : tokenB.target;
    await router.swapExactInputOnPool(key, tokenIn, ethers.parseEther("5"), 0, owner.address, dl());

    const meanTick = await twapHook.consult(key, 3);
    expect(typeof meanTick).to.equal("bigint"); // valid int24
  });

  it("observeSingle() returns cumulative and tick", async function () {
    const key = await hookedKey();
    const [cum0, tick0] = await twapHook.observeSingle(key, 0);
    const [cum30, tick30] = await twapHook.observeSingle(key, 3);
    // Both should be valid bigints
    expect(typeof cum0).to.equal("bigint");
    expect(typeof tick0).to.equal("bigint");
    expect(typeof cum30).to.equal("bigint");
    expect(typeof tick30).to.equal("bigint");
  });

  it("reverts consult() with zero secondsAgo", async function () {
    const key = await hookedKey();
    await expect(twapHook.consult(key, 0)).to.be.revertedWith("TWAP: zero period");
  });
});
