// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../types/PoolKey.sol";
import "../types/BalanceDelta.sol";

/// @notice Hook callbacks (Uniswap V4 pattern). Return selector to allow the action.
interface IHooks {
    function beforeInitialize(address sender, PoolKey calldata key) external returns (bytes4);

    function afterInitialize(address sender, PoolKey calldata key) external returns (bytes4);

    function beforeAddLiquidity(address sender, PoolKey calldata key, uint256 amount0, uint256 amount1)
        external
        returns (bytes4);

    function afterAddLiquidity(
        address sender,
        PoolKey calldata key,
        uint256 amount0,
        uint256 amount1,
        BalanceDelta calldata delta
    ) external returns (bytes4);

    function beforeRemoveLiquidity(address sender, PoolKey calldata key, uint256 liquidity)
        external
        returns (bytes4);

    function afterRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        uint256 liquidity,
        BalanceDelta calldata delta
    ) external returns (bytes4);

    function beforeSwap(address sender, PoolKey calldata key, bool zeroForOne, uint256 amountSpecified)
        external
        returns (bytes4);

    function afterSwap(
        address sender,
        PoolKey calldata key,
        bool zeroForOne,
        uint256 amountSpecified,
        BalanceDelta calldata delta
    ) external returns (bytes4);
}
