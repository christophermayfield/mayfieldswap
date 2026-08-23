// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IFlashLoanCallback.sol";
import "../libraries/TransferHelper.sol";

/// @notice Test helper — receives a flash loan and immediately approves repayment.
contract MockFlashBorrower is IFlashLoanCallback {
    address public immutable flashLoanContract;
    bool    public callbackExecuted;
    uint256 public lastAmount;

    constructor(address _flashLoan) {
        flashLoanContract = _flashLoan;
    }

    /// @dev Just pre-approves repayment. In production, the borrower would use the funds here.
    function onFlashLoan(address token, uint256 amount, bytes calldata) external override {
        require(msg.sender == flashLoanContract, "MockBorrower: wrong caller");
        callbackExecuted = true;
        lastAmount = amount;
        // Approve the flash loan contract to pull amount back
        TransferHelper.safeApprove(token, flashLoanContract, type(uint256).max);
    }

    /// @dev Allow owner to fund the borrower with extra tokens (to cover any fee).
    receive() external payable {}
}
