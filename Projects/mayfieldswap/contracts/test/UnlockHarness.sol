// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IPoolManager.sol";
import "../interfaces/IUnlockCallback.sol";
import "../interfaces/IERC20.sol";
import "../types/PoolKey.sol";
import "../types/BalanceDelta.sol";
import "../types/Currency.sol";
import "../libraries/TickMath.sol";

/// @notice Test locker for flash-accounting / EIP-1153 behavior.
contract UnlockHarness is IUnlockCallback {
    IPoolManager public immutable poolManager;

    int256 public lastDelta0;
    int256 public lastDelta1;
    uint256 public lastNonzero;
    bool public lastUnlocked;

    constructor(address _poolManager) {
        poolManager = IPoolManager(_poolManager);
    }

    function run(bytes calldata data) external {
        poolManager.unlock(data);
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "Harness: manager");
        (uint8 mode, bytes memory payload) = abi.decode(data, (uint8, bytes));

        if (mode == 0) {
            // no-op: deltas already zero
            return "";
        }
        if (mode == 1) {
            poolManager.unlock(abi.encode(uint8(0), bytes("")));
            return "";
        }
        if (mode == 2) {
            (PoolKey memory key, bool zeroForOne, uint256 amountIn) = abi.decode(payload, (PoolKey, bool, uint256));
            uint160 limit = zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1;
            poolManager.swap(
                key,
                IPoolManager.SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: int256(amountIn),
                    sqrtPriceLimitX96: limit
                }),
                ""
            );
            lastDelta0 = poolManager.currencyDelta(key.currency0);
            lastDelta1 = poolManager.currencyDelta(key.currency1);
            lastNonzero = poolManager.nonzeroDeltaCount();
            lastUnlocked = poolManager.isUnlocked();
            // Intentionally leave deltas unsettled.
            return "";
        }
        if (mode == 3) {
            (PoolKey memory key, bool zeroForOne, uint256 amountIn, address payer, address recipient) =
                abi.decode(payload, (PoolKey, bool, uint256, address, address));
            uint160 limit = zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1;
            BalanceDelta memory delta = poolManager.swap(
                key,
                IPoolManager.SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: int256(amountIn),
                    sqrtPriceLimitX96: limit
                }),
                ""
            );
            lastDelta0 = poolManager.currencyDelta(key.currency0);
            lastDelta1 = poolManager.currencyDelta(key.currency1);
            lastNonzero = poolManager.nonzeroDeltaCount();
            lastUnlocked = poolManager.isUnlocked();

            Currency input = zeroForOne ? key.currency0 : key.currency1;
            Currency output = zeroForOne ? key.currency1 : key.currency0;
            uint256 amountOut = zeroForOne ? uint256(int256(delta.amount1)) : uint256(int256(delta.amount0));

            poolManager.sync(input);
            IERC20(Currency.unwrap(input)).transferFrom(payer, address(poolManager), amountIn);
            poolManager.settle(input);
            poolManager.take(output, recipient, amountOut);
            return abi.encode(amountOut);
        }
        revert("Harness: mode");
    }
}
