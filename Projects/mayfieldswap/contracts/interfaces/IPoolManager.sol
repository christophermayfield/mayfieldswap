// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../types/Currency.sol";
import "../types/PoolKey.sol";
import "../types/PoolId.sol";
import "../types/BalanceDelta.sol";

interface IPoolManager {
    struct ModifyLiquidityParams {
        address owner;
        int24 tickLower;
        int24 tickUpper;
        int128 liquidityDelta;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    event Initialize(
        PoolId indexed id,
        Currency currency0,
        Currency currency1,
        uint24 fee,
        int24 tickSpacing,
        address hooks,
        uint160 sqrtPriceX96,
        int24 tick
    );

    event ModifyLiquidity(
        PoolId indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int128 liquidityDelta
    );

    event Swap(
        PoolId indexed id,
        address indexed sender,
        int256 amount0,
        int256 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick
    );

    function unlock(bytes calldata data) external returns (bytes memory);

    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick);

    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params, bytes calldata hookData)
        external
        returns (BalanceDelta memory delta);

    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData)
        external
        returns (BalanceDelta memory delta);

    function sync(Currency currency) external;

    function settle(Currency currency) external payable returns (uint256 paid);

    function take(Currency currency, address to, uint256 amount) external;

    function getSlot0(PoolId id) external view returns (uint160 sqrtPriceX96, int24 tick, uint128 liquidity);

    function getPositionLiquidity(PoolId id, address owner, int24 tickLower, int24 tickUpper)
        external
        view
        returns (uint128 liquidity);

    function isInitialized(PoolId id) external view returns (bool);
}
