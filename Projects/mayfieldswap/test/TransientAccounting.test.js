const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EIP-1153 flash accounting", function () {
  const deadline = () => Math.floor(Date.now() / 1000) + 600;
  const SQRT_PRICE_1_1 = 1n << 96n;

  let poolManager, router, harness, tokenA, tokenB;
  let lp, trader;

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
    poolManager = await (await ethers.getContractFactory("PoolManager")).deploy();
    router = await (await ethers.getContractFactory("MayfieldRouter")).deploy(poolManager.target, weth.target);
    harness = await (await ethers.getContractFactory("UnlockHarness")).deploy(poolManager.target);

    const TestToken = await ethers.getContractFactory("TestToken");
    tokenA = await TestToken.deploy("Token A", "TKA", 18, ethers.parseEther("1000000"));
    tokenB = await TestToken.deploy("Token B", "TKB", 18, ethers.parseEther("1000000"));

    await tokenA.transfer(lp.address, ethers.parseEther("50000"));
    await tokenB.transfer(lp.address, ethers.parseEther("50000"));
    await tokenA.connect(lp).approve(router.target, ethers.MaxUint256);
    await tokenB.connect(lp).approve(router.target, ethers.MaxUint256);

    await router.initializePool(tokenA.target, tokenB.target, SQRT_PRICE_1_1);
    await router.connect(lp).addLiquidity(
      tokenA.target,
      tokenB.target,
      ethers.parseEther("1000"),
      ethers.parseEther("1000"),
      0,
      0,
      lp.address,
      deadline()
    );
  });

  it("allows a no-op unlock when no deltas are opened", async function () {
    await harness.run(ethers.AbiCoder.defaultAbiCoder().encode(["uint8", "bytes"], [0, "0x"]));
    expect(await poolManager.isUnlocked()).to.equal(false);
    expect(await poolManager.nonzeroDeltaCount()).to.equal(0n);
  });

  it("rejects nested unlock in the same transaction", async function () {
    await expect(
      harness.run(ethers.AbiCoder.defaultAbiCoder().encode(["uint8", "bytes"], [1, "0x"]))
    ).to.be.revertedWith("PM: already unlocked");
  });

  it("rejects swap outside unlock", async function () {
    const key = asKey(await router.defaultKey(tokenA.target, tokenB.target));
    await expect(
      poolManager.swap(key, { zeroForOne: true, amountSpecified: 1n, sqrtPriceLimitX96: 1n }, "0x")
    ).to.be.revertedWith("PM: locked");
  });

  it("reverts the whole unlock if deltas are left unsettled", async function () {
    const key = asKey(await router.defaultKey(tokenA.target, tokenB.target));
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)", "bool", "uint256"],
      [key, true, ethers.parseEther("1")]
    );
    const data = ethers.AbiCoder.defaultAbiCoder().encode(["uint8", "bytes"], [2, payload]);
    await expect(harness.run(data)).to.be.revertedWith("PM: unsettled");
    expect(await poolManager.isUnlocked()).to.equal(false);
    expect(await poolManager.nonzeroDeltaCount()).to.equal(0n);
    expect(await poolManager.currencyDelta(key.currency0)).to.equal(0n);
  });

  it("snapshots nonzero transient deltas during unlock, then settles to zero", async function () {
    const key = asKey(await router.defaultKey(tokenA.target, tokenB.target));
    const token0IsA = key.currency0.toLowerCase() === tokenA.target.toLowerCase();
    const zeroForOne = token0IsA;
    const [deployer] = await ethers.getSigners();
    await tokenA.connect(deployer).transfer(trader.address, ethers.parseEther("10"));
    await tokenA.connect(trader).approve(harness.target, ethers.MaxUint256);

    const payload = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)",
        "bool",
        "uint256",
        "address",
        "address",
      ],
      [key, zeroForOne, ethers.parseEther("1"), trader.address, trader.address]
    );
    await harness.run(ethers.AbiCoder.defaultAbiCoder().encode(["uint8", "bytes"], [3, payload]));

    expect(await harness.lastUnlocked()).to.equal(true);
    expect(await harness.lastNonzero()).to.be.gt(0n);
    expect((await harness.lastDelta0()) !== 0n || (await harness.lastDelta1()) !== 0n).to.equal(true);
    expect(await poolManager.isUnlocked()).to.equal(false);
    expect(await poolManager.nonzeroDeltaCount()).to.equal(0n);
  });

  it("clears the lock after a successful router swap", async function () {
    await tokenA.transfer(trader.address, ethers.parseEther("10"));
    await tokenA.connect(trader).approve(router.target, ethers.MaxUint256);
    await router.connect(trader).swapExactTokensForTokens(
      tokenA.target,
      tokenB.target,
      ethers.parseEther("1"),
      0,
      trader.address,
      deadline()
    );
    expect(await poolManager.isUnlocked()).to.equal(false);
    expect(await poolManager.nonzeroDeltaCount()).to.equal(0n);
  });
});
