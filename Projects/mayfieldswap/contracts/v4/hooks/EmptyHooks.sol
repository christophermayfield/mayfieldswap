// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IHooks.sol";
import "../types/PoolKey.sol";
import "../types/BalanceDelta.sol";

/// @notice No-op hooks implementation for pools that do not customize behavior.
contract EmptyHooks is IHooks {
    function beforeInitialize(address, PoolKey calldata) external pure returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata) external pure returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(address, PoolKey calldata, uint256, uint256) external pure returns (bytes4) {
        return IHooks.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(address, PoolKey calldata, uint256, uint256, BalanceDelta calldata)
        external
        pure
        returns (bytes4)
    {
        return IHooks.afterAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, uint256) external pure returns (bytes4) {
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(address, PoolKey calldata, uint256, BalanceDelta calldata)
        external
        pure
        returns (bytes4)
    {
        return IHooks.afterRemoveLiquidity.selector;
    }

    function beforeSwap(address, PoolKey calldata, bool, uint256) external pure returns (bytes4) {
        return IHooks.beforeSwap.selector;
    }

    function afterSwap(address, PoolKey calldata, bool, uint256, BalanceDelta calldata)
        external
        pure
        returns (bytes4)
    {
        return IHooks.afterSwap.selector;
    }
}
