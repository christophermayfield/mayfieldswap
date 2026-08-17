const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PositionManager NFT", function () {
  const deadline = () => Math.floor(Date.now() / 1000) + 600;
  const SQRT_PRICE_1_1 = 1n << 96n;

  let poolManager, router, positionManager, tokenA, tokenB;
  let lp, lp2, trader;

  beforeEach(async function () {
    [, lp, lp2, trader] = await ethers.getSigners();

    const weth = await (await ethers.getContractFactory("WETH")).deploy();
    poolManager = await (await ethers.getContractFactory("PoolManager")).deploy();
    router = await (await ethers.getContractFactory("MayfieldRouter")).deploy(poolManager.target, weth.target);
    positionManager = await (await ethers.getContractFactory("PositionManager")).deploy(
      poolManager.target,
      router.target
    );

    const TestToken = await ethers.getContractFactory("TestToken");
    tokenA = await TestToken.deploy("Token A", "TKA", 18, ethers.parseEther("1000000"));
    tokenB = await TestToken.deploy("Token B", "TKB", 18, ethers.parseEther("1000000"));

    for (const who of [lp, lp2, trader]) {
      await tokenA.transfer(who.address, ethers.parseEther("50000"));
      await tokenB.transfer(who.address, ethers.parseEther("50000"));
    }

    await router.initializePool(tokenA.target, tokenB.target, SQRT_PRICE_1_1);
    await tokenA.connect(lp).approve(router.target, ethers.MaxUint256);
    await tokenB.connect(lp).approve(router.target, ethers.MaxUint256);
    await router.connect(lp).addLiquidity(
      tokenA.target,
      tokenB.target,
      ethers.parseEther("2000"),
      ethers.parseEther("2000"),
      0,
      0,
      lp.address,
      deadline()
    );
  });

  it("mints an NFT for a custom tick range", async function () {
    await tokenA.connect(lp2).approve(positionManager.target, ethers.MaxUint256);
    await tokenB.connect(lp2).approve(positionManager.target, ethers.MaxUint256);

    const tx = await positionManager.connect(lp2).mint(
      tokenA.target,
      tokenB.target,
      -120,
      120,
      ethers.parseEther("100"),
      ethers.parseEther("100"),
      0,
      0,
      lp2.address,
      deadline()
    );
    const receipt = await tx.wait();
    const transfer = receipt.logs.find((l) => l.fragment?.name === "Transfer");
    expect(transfer).to.not.equal(undefined);

    const tokenId = 1n;
    expect(await positionManager.ownerOf(tokenId)).to.equal(lp2.address);
    expect(await positionManager.balanceOf(lp2.address)).to.equal(1n);
    expect(await positionManager.getLiquidity(tokenId)).to.be.gt(0n);

    const pos = await positionManager.positions(tokenId);
    expect(pos.tickLower).to.equal(-120);
    expect(pos.tickUpper).to.equal(120);
  });

  it("transfers fee-collect rights with the NFT", async function () {
    await tokenA.connect(lp2).approve(positionManager.target, ethers.MaxUint256);
    await tokenB.connect(lp2).approve(positionManager.target, ethers.MaxUint256);
    await positionManager.connect(lp2).mint(
      tokenA.target,
      tokenB.target,
      -60,
      60,
      ethers.parseEther("200"),
      ethers.parseEther("200"),
      0,
      0,
      lp2.address,
      deadline()
    );

    await tokenA.connect(trader).approve(router.target, ethers.MaxUint256);
    await tokenB.connect(trader).approve(router.target, ethers.MaxUint256);
    await router.connect(trader).swapExactTokensForTokens(
      tokenA.target,
      tokenB.target,
      ethers.parseEther("5"),
      0,
      trader.address,
      deadline()
    );

    const [pending0, pending1] = await positionManager.getPendingFees(1n);
    expect(pending0 + pending1).to.be.gt(0n);

    await positionManager.connect(lp2).transferFrom(lp2.address, lp.address, 1n);
    expect(await positionManager.ownerOf(1n)).to.equal(lp.address);

    const balBefore = (await tokenA.balanceOf(lp.address)) + (await tokenB.balanceOf(lp.address));
    await positionManager.connect(lp).collect(1n, lp.address, deadline());
    const balAfter = (await tokenA.balanceOf(lp.address)) + (await tokenB.balanceOf(lp.address));
    expect(balAfter).to.be.gt(balBefore);

    await expect(positionManager.connect(lp2).collect(1n, lp2.address, deadline())).to.be.revertedWith(
      "PMgr: not owner"
    );
  });

  it("burns the NFT when the full position is withdrawn", async function () {
    await tokenA.connect(lp2).approve(positionManager.target, ethers.MaxUint256);
    await tokenB.connect(lp2).approve(positionManager.target, ethers.MaxUint256);
    await positionManager.connect(lp2).mint(
      tokenA.target,
      tokenB.target,
      -600,
      600,
      ethers.parseEther("50"),
      ethers.parseEther("50"),
      0,
      0,
      lp2.address,
      deadline()
    );

    const liq = await positionManager.getLiquidity(1n);
    await positionManager.connect(lp2).burn(1n, 0, 0, lp2.address, deadline());

    await expect(positionManager.ownerOf(1n)).to.be.revertedWith("PMgr: invalid token");
    expect(await positionManager.getLiquidity(1n)).to.equal(0n);
    expect(liq).to.be.gt(0n);
  });
});
