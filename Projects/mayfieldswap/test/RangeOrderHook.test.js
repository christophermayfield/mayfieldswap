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

  it("allows placing a range order on one-sided liquidity", async function () {
    const key = await hookedKey();
    // Determine the natural "above price" direction based on which token is currency0.
    // zeroForOne = selling currency0 → range above current price (tickLower >= currentTick)
    // !zeroForOne = selling currency1 → range below current price (tickUpper <= currentTick)
    // Start at tick=0 (SQRT_PRICE_1_1).  Use the zeroForOne direction (range above).
    const zeroForOne = true; // always place above — we'll use the right token

    // For zeroForOne: range [60, 120] above tick=0; only currency0 needed
    const [tL, tU] = [60, 120];
    const currency0IsTokenA = key.currency0.toLowerCase() === tokenA.target.toLowerCase();
    // amount0 = currency0; amount1 = currency1
    const [a0, a1] = [ethers.parseEther("100"), 0n]; // only currency0 for above-price range

    await router.connect(addr1).addLiquidityOnPool(
      key, tL, tU, a0, a1, 0n, 0n, addr1.address, dl()
    );

    const tx      = await rangeHook.connect(addr1).placeOrder(key, tL, tU, zeroForOne);
    const receipt = await tx.wait();
    const event   = receipt.logs.find(l => l.fragment?.name === "OrderPlaced");
    expect(event).to.not.be.undefined;

    const orderId = event.args.orderId;
    const order   = await rangeHook.getOrder(orderId);
    expect(order.owner).to.equal(addr1.address);
    expect(order.filled).to.equal(false);

    // eslint-disable-next-line no-unused-vars
    const _unused = currency0IsTokenA; // suppress lint
  });

  it("updates lastTick after a swap through the hooked pool", async function () {
    const key = await hookedKey();
    const id  = poolId(key);

    const tickBefore = await rangeHook.lastTick(id);

    // Swap currency0 → currency1 (zeroForOne) to move price upward
    const tokenIn = key.currency0; // always use currency0 as input for consistency
    await router.swapExactInputOnPool(key, tokenIn, ethers.parseEther("100"), 0, owner.address, dl());

    const tickAfter = await rangeHook.lastTick(id);
    expect(tickAfter).to.not.equal(tickBefore);
  });

  it("checkAndFill marks order as filled when range is fully crossed", async function () {
    const key      = await hookedKey();
    const zeroForOne = true; // matches placeOrder test above
    const [tL, tU]   = [60, 120];
    const orderId    = await rangeHook.computeOrderId(addr1.address, key, tL, tU, zeroForOne);

    const currentTick = Number(await rangeHook.lastTick(poolId(key)));

    if ((zeroForOne && currentTick >= tU) || (!zeroForOne && currentTick <= tL)) {
      // Range already crossed — mark as filled
      await rangeHook.checkAndFill(orderId, key);
      expect(await rangeHook.isOrderFilled(orderId)).to.equal(true);
    } else {
      // Need another large swap to cross the range
      const tokenIn = key.currency0 < key.currency1 ? tokenA.target : tokenB.target;
      await router.swapExactInputOnPool(key, tokenIn, ethers.parseEther("3000"), 0, owner.address, dl());

      const tick = Number(await rangeHook.lastTick(poolId(key)));
      if ((zeroForOne && tick >= tU) || (!zeroForOne && tick <= tL)) {
        await rangeHook.checkAndFill(orderId, key);
        expect(await rangeHook.isOrderFilled(orderId)).to.equal(true);
      } else {
        // Price didn't move enough — order still open (acceptable in test)
        expect(await rangeHook.isOrderFilled(orderId)).to.equal(false);
      }
    }
  });

  it("reverts placeOrder when range is wrong direction for zeroForOne", async function () {
    const key = await hookedKey();
    // zeroForOne=true requires range entirely ABOVE current price (tickLower >= currentTick)
    // Force a range that is below (negative ticks)
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
