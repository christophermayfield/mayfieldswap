// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IHooks.sol";
import "../types/PoolKey.sol";
import "../types/BalanceDelta.sol";

contract EmptyHooks is IHooks {
    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(address, PoolKey calldata, int24, int24, int128) external pure returns (bytes4) {
        return IHooks.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(address, PoolKey calldata, int24, int24, int128, BalanceDelta calldata)
        external
        pure
        returns (bytes4)
    {
        return IHooks.afterAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, int24, int24, int128) external pure returns (bytes4) {
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(address, PoolKey calldata, int24, int24, int128, BalanceDelta calldata)
        external
        pure
        returns (bytes4)
    {
        return IHooks.afterRemoveLiquidity.selector;
    }

    function beforeSwap(address, PoolKey calldata, bool, int256) external pure returns (bytes4) {
        return IHooks.beforeSwap.selector;
    }

    function afterSwap(address, PoolKey calldata, bool, int256, BalanceDelta calldata) external pure returns (bytes4) {
        return IHooks.afterSwap.selector;
    }
}
