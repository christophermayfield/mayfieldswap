const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Protocol fee switch (MayfieldRouter)", function () {
  let poolManager, router, tokenA, tokenB;
  let owner, trader, feeRecipient;
  const SQRT_PRICE_1_1 = 1n << 96n;

  function dl() { return Math.floor(Date.now() / 1000) + 600; }

  before(async function () {
    [owner, trader, feeRecipient] = await ethers.getSigners();

    const WETH  = await (await ethers.getContractFactory("WETH")).deploy();
    poolManager = await (await ethers.getContractFactory("PoolManager")).deploy();
    router      = await (await ethers.getContractFactory("MayfieldRouter")).deploy(poolManager.target, WETH.target);

    const TestToken = await ethers.getContractFactory("TestToken");
    tokenA = await TestToken.deploy("Token A", "TKA", 18, ethers.parseEther("1000000"));
    tokenB = await TestToken.deploy("Token B", "TKB", 18, ethers.parseEther("1000000"));

    await tokenA.transfer(trader.address, ethers.parseEther("50000"));
    await tokenB.transfer(trader.address, ethers.parseEther("50000"));

    await tokenA.approve(router.target, ethers.MaxUint256);
    await tokenB.approve(router.target, ethers.MaxUint256);
    await tokenA.connect(trader).approve(router.target, ethers.MaxUint256);
    await tokenB.connect(trader).approve(router.target, ethers.MaxUint256);

    // Initialize pool + liquidity
    await router.initializePool(tokenA.target, tokenB.target, SQRT_PRICE_1_1);
    await router.addLiquidity(
      tokenA.target, tokenB.target,
      ethers.parseEther("10000"), ethers.parseEther("10000"),
      0, 0, owner.address, dl()
    );
  });

  it("protocolFeeBps is 0 by default", async function () {
    expect(await router.protocolFeeBps()).to.equal(0);
  });

  it("owner is set to deployer", async function () {
    expect(await router.owner()).to.equal(owner.address);
  });

  it("non-owner cannot set protocol fee", async function () {
    await expect(
      router.connect(trader).setProtocolFee(50)
    ).to.be.revertedWith("Router: not owner");
  });

  it("owner can set protocol fee up to 100 bps", async function () {
    await expect(router.setProtocolFee(100))
      .to.emit(router, "ProtocolFeeSet")
      .withArgs(100);
    expect(await router.protocolFeeBps()).to.equal(100);
  });

  it("reverts if fee exceeds 100 bps", async function () {
    await expect(router.setProtocolFee(101)).to.be.revertedWith("Router: max fee 1%");
  });

  it("owner sets fee recipient", async function () {
    await expect(router.setFeeRecipient(feeRecipient.address))
      .to.emit(router, "FeeRecipientSet")
      .withArgs(feeRecipient.address);
    expect(await router.feeRecipient()).to.equal(feeRecipient.address);
  });

  it("protocol fee accrues in router on swaps", async function () {
    // Swap tokenA → tokenB; output token is always tokenB regardless of sort order
    const outputToken = tokenB.target;

    const amountIn = ethers.parseEther("100");
    await router.connect(trader).swapExactTokensForTokens(
      tokenA.target, tokenB.target,
      amountIn, 0, trader.address, dl()
    );

    const accrued = await router.accruedFees(outputToken);
    expect(accrued).to.be.gt(0n);
  });

  it("net output to trader is reduced by the protocol fee", async function () {
    const outputToken = tokenB.target;
    const feeBps = await router.protocolFeeBps(); // 100

    // Reset accrued fees baseline
    const accruedBefore = await router.accruedFees(outputToken);

    const balBefore = await tokenB.balanceOf(trader.address);
    await router.connect(trader).swapExactTokensForTokens(
      tokenA.target, tokenB.target,
      ethers.parseEther("100"), 0, trader.address, dl()
    );
    const balAfter = await tokenB.balanceOf(trader.address);

    const received = balAfter - balBefore;
    const newAccrued = (await router.accruedFees(outputToken)) - accruedBefore;

    expect(newAccrued).to.be.gt(0n);

    // gross = received + fee; fee ≈ 1% of gross
    const gross = received + newAccrued;
    const expectedFee = gross * feeBps / 10000n;
    expect(newAccrued).to.be.closeTo(expectedFee, 1n);
  });

  it("owner can collect accrued fees to feeRecipient", async function () {
    const outputToken = tokenB.target;
    const accrued = await router.accruedFees(outputToken);
    expect(accrued).to.be.gt(0n);

    const before = await tokenB.balanceOf(feeRecipient.address);
    await expect(router.collectProtocolFees(outputToken))
      .to.emit(router, "ProtocolFeesCollected");

    const after = await tokenB.balanceOf(feeRecipient.address);
    expect(after - before).to.equal(accrued);
    expect(await router.accruedFees(outputToken)).to.equal(0n);
  });

  it("no fee accrues when protocolFeeBps is 0", async function () {
    await router.setProtocolFee(0);
    const outputToken = tokenB.target;

    const accruedBefore = await router.accruedFees(outputToken);
    await router.connect(trader).swapExactTokensForTokens(
      tokenA.target, tokenB.target,
      ethers.parseEther("50"), 0, trader.address, dl()
    );
    const accruedAfter = await router.accruedFees(outputToken);
    expect(accruedAfter).to.equal(accruedBefore);
  });

  it("non-owner cannot collect fees", async function () {
    await expect(
      router.connect(trader).collectProtocolFees(tokenB.target)
    ).to.be.revertedWith("Router: not owner");
  });

  it("transferOwnership works and is reversible", async function () {
    await router.transferOwnership(trader.address);
    expect(await router.owner()).to.equal(trader.address);
    await router.connect(trader).transferOwnership(owner.address);
    expect(await router.owner()).to.equal(owner.address);
  });
});
