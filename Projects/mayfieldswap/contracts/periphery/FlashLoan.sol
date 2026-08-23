// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IPoolManager.sol";
import "../interfaces/IUnlockCallback.sol";
import "../interfaces/IFlashLoanCallback.sol";
import "../types/Currency.sol";
import "../libraries/TransferHelper.sol";

/// @title FlashLoan
/// @notice Exposes the PoolManager's token reserves as a permissionless flash-loan facility.
///
/// Mechanics (all within one poolManager.unlock() call):
///   1. take()  — borrow `amount` tokens from the PM (opens a -amount delta).
///   2. Invoke receiver.onFlashLoan() — borrower executes their logic.
///   3. safeTransferFrom() — pull `amount` back from receiver to PM (closes -amount delta → 0).
///   4. Optional off-pool fee transferred directly from receiver to feeRecipient.
///
/// The borrower must approve this contract for at least `amount` (+ fee if applicable)
/// before onFlashLoan returns.
contract FlashLoan is IUnlockCallback {
    IPoolManager public immutable poolManager;
    address public immutable feeRecipient;

    /// @dev Fee charged on each flash loan. Set to 0 to disable. Max 255 bps (2.55%).
    uint256 public immutable flashFeeBps;

    struct FlashParams {
        address token;
        uint256 amount;
        address receiver;
        bytes   data;
    }

    event FlashLoanExecuted(
        address indexed token,
        address indexed receiver,
        uint256 amount,
        uint256 fee
    );

    constructor(address _poolManager, address _feeRecipient, uint256 _flashFeeBps) {
        require(_flashFeeBps <= 255, "FL: fee too high");
        poolManager   = IPoolManager(_poolManager);
        feeRecipient  = _feeRecipient;
        flashFeeBps   = _flashFeeBps;
    }

    // ─── External entrypoint ─────────────────────────────────────────────────

    /// @notice Borrow `amount` of `token` from the pool manager.
    ///         `receiver` receives the tokens and must repay `amount` (+ optional fee) before
    ///         the call returns.
    function flashLoan(
        address token,
        uint256 amount,
        address receiver,
        bytes calldata data
    ) external {
        require(amount > 0, "FL: zero amount");
        poolManager.unlock(
            abi.encode(FlashParams({token: token, amount: amount, receiver: receiver, data: data}))
        );
    }

    // ─── IUnlockCallback ─────────────────────────────────────────────────────

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "FL: not manager");

        FlashParams memory p = abi.decode(data, (FlashParams));
        Currency currency    = Currency.wrap(p.token);
        uint256 fee          = (p.amount * flashFeeBps) / 10_000;

        // Step 1: deliver tokens to borrower (delta = -amount)
        poolManager.take(currency, p.receiver, p.amount);

        // Step 2: borrower logic — must approve this contract for repayment
        IFlashLoanCallback(p.receiver).onFlashLoan(p.token, p.amount, p.data);

        // Step 3: pull principal back into PM (sync baseline was set by take; settle clears delta)
        TransferHelper.safeTransferFrom(p.token, p.receiver, address(poolManager), p.amount);
        poolManager.settle(currency); // paid = amount → delta = -amount + amount = 0 ✓

        // Step 4: collect fee directly (off-pool, does not affect delta)
        if (fee > 0 && feeRecipient != address(0)) {
            TransferHelper.safeTransferFrom(p.token, p.receiver, feeRecipient, fee);
        }

        emit FlashLoanExecuted(p.token, p.receiver, p.amount, fee);
        return "";
    }

    // ─── View ─────────────────────────────────────────────────────────────────

    /// @notice Returns the fee charged for borrowing `amount` of any token.
    function feeFor(uint256 amount) external view returns (uint256) {
        return (amount * flashFeeBps) / 10_000;
    }
}
