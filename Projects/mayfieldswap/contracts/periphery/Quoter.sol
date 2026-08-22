// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IPoolManager.sol";
import "../interfaces/IUnlockCallback.sol";
import "../types/Currency.sol";
import "../types/PoolKey.sol";
import "../types/BalanceDelta.sol";
import "../libraries/TickMath.sol";

/// @notice Quotes exact-input swaps by executing against PoolManager and reverting with the result (eth_call).
contract Quoter is IUnlockCallback {
    IPoolManager public immutable poolManager;

    uint24 private constant DEFAULT_FEE = 3000;
    int24  private constant DEFAULT_TICK_SPACING = 60;

    error QuoteAmount(uint256 amountOut);

    constructor(address _poolManager) {
        poolManager = IPoolManager(_poolManager);
    }

    function _defaultKey(address tokenA, address tokenB) internal pure returns (PoolKey memory key) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        key = PoolKey({
            currency0: Currency.wrap(t0),
            currency1: Currency.wrap(t1),
            fee: DEFAULT_FEE,
            tickSpacing: DEFAULT_TICK_SPACING,
            hooks: address(0)
        });
    }

    /// @notice Quote a multi-hop exact-input path through default pools.
    function quoteExactPath(address[] calldata path, uint256 amountIn) external returns (uint256 amountOut) {
        require(path.length >= 2, "Quoter: path");
        uint256 current = amountIn;
        for (uint256 i = 0; i < path.length - 1; i++) {
            PoolKey memory key = _defaultKey(path[i], path[i + 1]);
            bool zeroForOne = Currency.unwrap(key.currency0) == path[i];
            current = this.quoteExactInput(key, zeroForOne, current);
        }
        amountOut = current;
    }

    function quoteExactInput(PoolKey memory key, bool zeroForOne, uint256 amountIn)
        external
        returns (uint256 amountOut)
    {
        try poolManager.unlock(abi.encode(key, zeroForOne, amountIn)) {}
        catch (bytes memory reason) {
            if (reason.length != 36) revert("Quoter: unexpected");
            bytes4 selector;
            assembly {
                selector := mload(add(reason, 0x20))
            }
            require(selector == QuoteAmount.selector, "Quoter: unexpected");
            assembly {
                amountOut := mload(add(reason, 0x24))
            }
        }
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "Quoter: manager");
        (PoolKey memory key, bool zeroForOne, uint256 amountIn) = abi.decode(data, (PoolKey, bool, uint256));

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

        uint256 amountOut = zeroForOne ? uint256(int256(delta.amount1)) : uint256(int256(delta.amount0));

        // Settle by taking and paying would mutate balances; instead revert with quote.
        // Deltas are left nonzero — unlock will revert unless we settle. So we must settle with a fake path.
        // Simpler: revert before unlock completes using assembly revert with custom error, which aborts unlock.
        revert QuoteAmount(amountOut);
    }
}
