const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashLoan", function () {
  let poolManager, router, flashLoan, tokenA, tokenB, borrower;
  let owner, feeRecipient;
  const SQRT_PRICE_1_1 = 1n << 96n;
  const FLASH_FEE_BPS  = 9n; // 0.09%

  function dl() { return Math.floor(Date.now() / 1000) + 600; }

  before(async function () {
    [owner, feeRecipient] = await ethers.getSigners();

    const WETH  = await (await ethers.getContractFactory("WETH")).deploy();
    poolManager = await (await ethers.getContractFactory("PoolManager")).deploy();
    router      = await (await ethers.getContractFactory("MayfieldRouter")).deploy(poolManager.target, WETH.target);

    // Deploy flash loan with a 9 bps fee
    flashLoan   = await (await ethers.getContractFactory("FlashLoan")).deploy(
      poolManager.target,
      feeRecipient.address,
      9
    );

    const TestToken = await ethers.getContractFactory("TestToken");
    tokenA = await TestToken.deploy("Token A", "TKA", 18, ethers.parseEther("1000000"));
    tokenB = await TestToken.deploy("Token B", "TKB", 18, ethers.parseEther("1000000"));

    await tokenA.approve(router.target, ethers.MaxUint256);
    await tokenB.approve(router.target, ethers.MaxUint256);

    // Initialize pool and add liquidity → tokens flow into PoolManager
    await router.initializePool(tokenA.target, tokenB.target, SQRT_PRICE_1_1);
    await router.addLiquidity(
      tokenA.target, tokenB.target,
      ethers.parseEther("10000"), ethers.parseEther("10000"),
      0, 0, owner.address, dl()
    );

    // Deploy a mock borrower and fund it with enough to cover the fee
    borrower = await (await ethers.getContractFactory("MockFlashBorrower")).deploy(flashLoan.target);
    // Give borrower some tokenA to cover the fee
    const loanAmount = ethers.parseEther("100");
    const fee = loanAmount * FLASH_FEE_BPS / 10000n;
    await tokenA.transfer(borrower.target, fee + 1n); // +1 for rounding safety
  });

  it("executes a flash loan and repays principal", async function () {
    const loanAmount = ethers.parseEther("100");
    const feeAmount  = loanAmount * FLASH_FEE_BPS / 10000n;
    const tokenAddr  = tokenA.target;

    // Pool manager's tokenA balance before
    const pmBefore    = await tokenA.balanceOf(poolManager.target);
    const feeBefore   = await tokenA.balanceOf(feeRecipient.address);

    await flashLoan.flashLoan(tokenAddr, loanAmount, borrower.target, "0x");

    // Pool manager principal restored
    const pmAfter = await tokenA.balanceOf(poolManager.target);
    expect(pmAfter).to.equal(pmBefore); // net zero for PM (principal repaid)

    // Fee recipient received the fee
    const feeAfter = await tokenA.balanceOf(feeRecipient.address);
    expect(feeAfter - feeBefore).to.equal(feeAmount);

    // Callback was executed
    expect(await borrower.callbackExecuted()).to.equal(true);
    expect(await borrower.lastAmount()).to.equal(loanAmount);
  });

  it("emits FlashLoanExecuted event", async function () {
    const loanAmount = ethers.parseEther("50");
    // top up borrower with fee
    await tokenA.transfer(borrower.target, loanAmount * FLASH_FEE_BPS / 10000n + 1n);

    await expect(
      flashLoan.flashLoan(tokenA.target, loanAmount, borrower.target, "0x")
    ).to.emit(flashLoan, "FlashLoanExecuted")
     .withArgs(tokenA.target, borrower.target, loanAmount, loanAmount * FLASH_FEE_BPS / 10000n);
  });

  it("reverts for zero amount", async function () {
    await expect(
      flashLoan.flashLoan(tokenA.target, 0, borrower.target, "0x")
    ).to.be.revertedWith("FL: zero amount");
  });

  it("feeFor() returns the correct fee amount", async function () {
    const amount = ethers.parseEther("1000");
    const expected = amount * FLASH_FEE_BPS / 10000n;
    expect(await flashLoan.feeFor(amount)).to.equal(expected);
  });
});
