// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Receiver interface for MayfieldSwap flash loans.
interface IFlashLoanCallback {
    /// @notice Called by the FlashLoan contract after transferring `amount` tokens to this contract.
    ///         The receiver must approve the FlashLoan contract for at least `amount` tokens
    ///         before this function returns so the principal can be pulled back.
    /// @param token   ERC-20 token address that was borrowed.
    /// @param amount  Amount of `token` received.
    /// @param data    Arbitrary data passed by the flash loan initiator.
    function onFlashLoan(address token, uint256 amount, bytes calldata data) external;
}
