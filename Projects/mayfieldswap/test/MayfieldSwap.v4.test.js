const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MayfieldSwap V4 Rewrite", function () {
  let poolManager, router, quoter, tokenA, tokenB, weth;
  let owner, addr1, addr2;
  const deadline = () => Math.floor(Date.now() / 1000) + 600;
  const SQRT_PRICE_1_1 = 1n << 96n;

  async function poolIdFor(tokenX, tokenY) {
    const key = await router.defaultKey(tokenX, tokenY);
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address,address,uint24,int24,address)"],
        [[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]]
      )
    );
  }

  before(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    weth = await (await ethers.getContractFactory("WETH")).deploy();
    poolManager = await (await ethers.getContractFactory("PoolManager")).deploy();
    router = await (await ethers.getContractFactory("MayfieldRouter")).deploy(poolManager.target, weth.target);
    quoter = await (await ethers.getContractFactory("Quoter")).deploy(poolManager.target);

    const TestToken = await ethers.getContractFactory("TestToken");
    tokenA = await TestToken.deploy("Token A", "TKA", 18, ethers.parseEther("1000000"));
    tokenB = await TestToken.deploy("Token B", "TKB", 18, ethers.parseEther("1000000"));

    await tokenA.transfer(addr1.address, ethers.parseEther("50000"));
    await tokenB.transfer(addr1.address, ethers.parseEther("50000"));
    await tokenA.transfer(addr2.address, ethers.parseEther("50000"));
    await tokenB.transfer(addr2.address, ethers.parseEther("50000"));
  });

  it("initializes a concentrated-liquidity pool at 1:1", async function () {
    await expect(router.initializePool(tokenA.target, tokenB.target, SQRT_PRICE_1_1))
      .to.emit(poolManager, "Initialize");

    const id = await poolIdFor(tokenA.target, tokenB.target);
    const slot0 = await poolManager.getSlot0(id);
    expect(slot0.sqrtPriceX96).to.equal(SQRT_PRICE_1_1);
    expect(await poolManager.isInitialized(id)).to.equal(true);
  });

  it("adds full-range liquidity", async function () {
    await tokenA.connect(addr1).approve(router.target, ethers.MaxUint256);
    await tokenB.connect(addr1).approve(router.target, ethers.MaxUint256);

    await router.connect(addr1).addLiquidity(
      tokenA.target,
      tokenB.target,
      ethers.parseEther("1000"),
      ethers.parseEther("1000"),
      0,
      0,
      addr1.address,
      deadline()
    );

    const liq = await router.getLiquidity(tokenA.target, tokenB.target, addr1.address);
    expect(liq).to.be.gt(0);
  });

  it("swaps exact tokens for tokens and grows global fees", async function () {
    const id = await poolIdFor(tokenA.target, tokenB.target);
    const [g0Before, g1Before] = await poolManager.getFeeGrowthGlobals(id);

    const amountIn = ethers.parseEther("10");
    const balBefore = await tokenB.balanceOf(addr1.address);

    await router.connect(addr1).swapExactTokensForTokens(
      tokenA.target,
      tokenB.target,
      amountIn,
      0,
      addr1.address,
      deadline()
    );

    const balAfter = await tokenB.balanceOf(addr1.address);
    expect(balAfter).to.be.gt(balBefore);

    const [g0After, g1After] = await poolManager.getFeeGrowthGlobals(id);
    // tokenA/tokenB ordering determines which global increases for this swap direction
    expect(g0After + g1After).to.be.gt(g0Before + g1Before);
  });

  it("lets LPs collect accrued swap fees", async function () {
    const balABefore = await tokenA.balanceOf(addr1.address);
    const balBBefore = await tokenB.balanceOf(addr1.address);

    await router.connect(addr1).collectFees(
      tokenA.target,
      tokenB.target,
      addr1.address,
      deadline()
    );

    const balAAfter = await tokenA.balanceOf(addr1.address);
    const balBAfter = await tokenB.balanceOf(addr1.address);
    expect(balAAfter + balBAfter).to.be.gt(balABefore + balBBefore);
  });

  it("quotes via Quoter", async function () {
    const key = await router.defaultKey(tokenA.target, tokenB.target);
    const plainKey = {
      currency0: key.currency0,
      currency1: key.currency1,
      fee: key.fee,
      tickSpacing: key.tickSpacing,
      hooks: key.hooks,
    };
    const zeroForOne = plainKey.currency0.toLowerCase() === tokenA.target.toLowerCase();
    const amountOut = await quoter.quoteExactInput.staticCall(
      plainKey,
      zeroForOne,
      ethers.parseEther("1")
    );
    expect(amountOut).to.be.gt(0);
  });

  it("removes liquidity and returns principal", async function () {
    // Generate more fees so remove path also exercises fee collect
    await tokenA.connect(addr2).approve(router.target, ethers.MaxUint256);
    await tokenB.connect(addr2).approve(router.target, ethers.MaxUint256);
    await router.connect(addr2).swapExactTokensForTokens(
      tokenB.target,
      tokenA.target,
      ethers.parseEther("5"),
      0,
      addr2.address,
      deadline()
    );

    const liq = await router.getLiquidity(tokenA.target, tokenB.target, addr1.address);
    const half = liq / 2n;
    const balBefore = await tokenA.balanceOf(addr1.address);

    await router.connect(addr1).removeLiquidity(
      tokenA.target,
      tokenB.target,
      half,
      0,
      0,
      addr1.address,
      deadline()
    );

    expect(await router.getLiquidity(tokenA.target, tokenB.target, addr1.address)).to.equal(liq - half);
    expect(await tokenA.balanceOf(addr1.address)).to.be.gt(balBefore);
  });

  it("isolates fee positions per LP salt", async function () {
    await router.connect(addr2).addLiquidity(
      tokenA.target,
      tokenB.target,
      ethers.parseEther("500"),
      ethers.parseEther("500"),
      0,
      0,
      addr2.address,
      deadline()
    );

    await router.connect(addr2).swapExactTokensForTokens(
      tokenA.target,
      tokenB.target,
      ethers.parseEther("20"),
      0,
      addr2.address,
      deadline()
    );

    const liq1 = await router.getLiquidity(tokenA.target, tokenB.target, addr1.address);
    const liq2 = await router.getLiquidity(tokenA.target, tokenB.target, addr2.address);
    expect(liq1).to.be.gt(0);
    expect(liq2).to.be.gt(0);
    expect(liq1).to.not.equal(liq2);

    const bal2Before = await tokenA.balanceOf(addr2.address);
    await router.connect(addr2).collectFees(tokenA.target, tokenB.target, addr2.address, deadline());
    expect(await tokenA.balanceOf(addr2.address)).to.be.gte(bal2Before);
  });

  it("swaps ETH for tokens", async function () {
    await router.initializePool(weth.target, tokenB.target, SQRT_PRICE_1_1);
    await tokenB.approve(router.target, ethers.MaxUint256);

    await weth.deposit({ value: ethers.parseEther("50") });
    await weth.approve(router.target, ethers.MaxUint256);
    await router.addLiquidity(
      weth.target,
      tokenB.target,
      ethers.parseEther("50"),
      ethers.parseEther("50"),
      0,
      0,
      owner.address,
      deadline()
    );

    const before = await tokenB.balanceOf(addr1.address);
    await router.connect(addr1).swapExactETHForTokens(tokenB.target, 0, addr1.address, deadline(), {
      value: ethers.parseEther("1"),
    });
    expect(await tokenB.balanceOf(addr1.address)).to.be.gt(before);
  });
});
