// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../types/PoolKey.sol";
import "../types/BalanceDelta.sol";

interface IHooks {
    function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96) external returns (bytes4);
    function afterInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96, int24 tick)
        external
        returns (bytes4);

    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        int128 liquidityDelta
    ) external returns (bytes4);

    function afterAddLiquidity(
        address sender,
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        int128 liquidityDelta,
        BalanceDelta calldata delta
    ) external returns (bytes4);

    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        int128 liquidityDelta
    ) external returns (bytes4);

    function afterRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        int128 liquidityDelta,
        BalanceDelta calldata delta
    ) external returns (bytes4);

    function beforeSwap(address sender, PoolKey calldata key, bool zeroForOne, int256 amountSpecified)
        external
        returns (bytes4);

    function afterSwap(
        address sender,
        PoolKey calldata key,
        bool zeroForOne,
        int256 amountSpecified,
        BalanceDelta calldata delta
    ) external returns (bytes4);
}
