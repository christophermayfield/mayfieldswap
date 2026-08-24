const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RangeOrderHook", function () {
  let poolManager, router, rangeHook, tokenA, tokenB;
  let owner, addr1;
  const SQRT_PRICE_1_1 = 1n << 96n;

  function asKey(k) {
    return { currency0: k.currency0, currency1: k.currency1, fee: k.fee, tickSpacing: k.tickSpacing, hooks: k.hooks };
  }

  async function hookedKey() {
    return asKey(await router.poolKey(tokenA.target, tokenB.target, 3000, 60, rangeHook.target));
  }

  function dl() { return Math.floor(Date.now() / 1000) + 600; }

  function poolId(key) {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address,address,uint24,int24,address)"],
        [[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]]
      )
    );
  }

  before(async function () {
    [owner, addr1] = await ethers.getSigners();

    const WETH  = await (await ethers.getContractFactory("WETH")).deploy();
    poolManager = await (await ethers.getContractFactory("PoolManager")).deploy();
    router      = await (await ethers.getContractFactory("MayfieldRouter")).deploy(poolManager.target, WETH.target);
    rangeHook   = await (await ethers.getContractFactory("RangeOrderHook")).deploy(poolManager.target);

    const TestToken = await ethers.getContractFactory("TestToken");
    tokenA = await TestToken.deploy("Token A", "TKA", 18, ethers.parseEther("1000000"));
    tokenB = await TestToken.deploy("Token B", "TKB", 18, ethers.parseEther("1000000"));

    await tokenA.transfer(addr1.address, ethers.parseEther("50000"));
    await tokenB.transfer(addr1.address, ethers.parseEther("50000"));

    await tokenA.approve(router.target, ethers.MaxUint256);
    await tokenB.approve(router.target, ethers.MaxUint256);
    await tokenA.connect(addr1).approve(router.target, ethers.MaxUint256);
    await tokenB.connect(addr1).approve(router.target, ethers.MaxUint256);

    // Initialize the hooked pool at 1:1 (tick = 0) and seed base liquidity
    const key = await hookedKey();
    await router.initializePoolKey(key, SQRT_PRICE_1_1);
    await router.addLiquidityOnPool(
      key, -887220, 887220,
      ethers.parseEther("5000"), ethers.parseEther("5000"),
      0, 0, owner.address, dl()
    );
  });

  it("records lastTick = 0 on initialization at 1:1 price", async function () {
    const key = await hookedKey();
    expect(await rangeHook.lastTick(poolId(key))).to.equal(0);
  });

  it("placeOrder strictly requires range above current price (no touching)", async function () {
    const key = await hookedKey();
    // Tick is 0; tickLower must be > 0, not >= 0
    await expect(
      rangeHook.placeOrder(key, 0, 60, true) // tickLower == currentTick → should revert
    ).to.be.revertedWith("RO: range must be above current price");
  });

  it("allows placing a zeroForOne range order strictly above current price", async function () {
    const key = await hookedKey();
    // zeroForOne=true: selling currency0 → range [60, 120] strictly above tick=0
    const [tL, tU] = [60, 120];

    // Range above current price → only currency0 needed
    await router.connect(addr1).addLiquidityOnPool(
      key, tL, tU,
      ethers.parseEther("100"), 0n,
      0n, 0n, addr1.address, dl()
    );

    const tx      = await rangeHook.connect(addr1).placeOrder(key, tL, tU, true);
    const receipt = await tx.wait();
    const event   = receipt.logs.find(l => l.fragment?.name === "OrderPlaced");
    expect(event).to.not.be.undefined;

    const order = await rangeHook.getOrder(event.args.orderId);
    expect(order.owner).to.equal(addr1.address);
    expect(order.filled).to.equal(false);
  });

  it("updates lastTick after a !zeroForOne swap that pushes tick upward", async function () {
    // Swap currency1 → currency0 (zeroForOne=false), which pushes tick UP.
    // This is the direction that fills the [60, 120] zeroForOne=true order above.
    const key = await hookedKey();
    const id  = poolId(key);
    const tickBefore = await rangeHook.lastTick(id);

    // Swap 500 currency1 → enough to push tick well past 120
    await router.swapExactInputOnPool(
      key, key.currency1, ethers.parseEther("500"), 0n, owner.address, dl()
    );

    const tickAfter = await rangeHook.lastTick(id);
    // Tick moved upward (>0 and > tickBefore=0)
    expect(tickAfter).to.be.gt(tickBefore);
    expect(tickAfter).to.be.gt(0n);
  });

  it("checkAndFill marks order filled after range is fully crossed", async function () {
    const key     = await hookedKey();
    const orderId = await rangeHook.computeOrderId(addr1.address, key, 60, 120, true);

    const currentTick = await rangeHook.lastTick(poolId(key));
    // After the large !zeroForOne swap above, tick should be >= 120
    expect(currentTick).to.be.gte(120n);

    await rangeHook.checkAndFill(orderId, key);
    expect(await rangeHook.isOrderFilled(orderId)).to.equal(true);
  });

  it("reverts checkAndFill on an already-filled order", async function () {
    const key     = await hookedKey();
    const orderId = await rangeHook.computeOrderId(addr1.address, key, 60, 120, true);
    await expect(
      rangeHook.checkAndFill(orderId, key)
    ).to.be.revertedWith("RO: already filled");
  });

  it("reverts placeOrder when range is wrong direction for zeroForOne", async function () {
    const key = await hookedKey();
    // Current tick is >120 after large swap; placing range [-240, -120] with zeroForOne=true
    // requires tickLower(-240) > currentTick(>120) → false → reverts
    await expect(
      rangeHook.placeOrder(key, -240, -120, true)
    ).to.be.revertedWith("RO: range must be above current price");
  });

  it("reverts checkAndFill for a non-existent order", async function () {
    const key = await hookedKey();
    await expect(
      rangeHook.checkAndFill(ethers.ZeroHash, key)
    ).to.be.revertedWith("RO: order not found");
  });
});
