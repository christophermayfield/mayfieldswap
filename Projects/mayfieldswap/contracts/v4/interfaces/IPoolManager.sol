// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../types/Currency.sol";
import "../types/PoolKey.sol";
import "../types/PoolId.sol";
import "../types/BalanceDelta.sol";

interface IPoolManager {
    event Initialize(
        PoolId indexed id, Currency currency0, Currency currency1, uint24 fee, int24 tickSpacing, address hooks
    );
    event ModifyLiquidity(PoolId indexed id, address indexed sender, int256 liquidityDelta, BalanceDelta delta);
    event Swap(
        PoolId indexed id,
        address indexed sender,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOut,
        BalanceDelta delta
    );

    function unlock(bytes calldata data) external returns (bytes memory result);

    function initialize(PoolKey memory key) external returns (PoolId id);

    function addLiquidity(
        PoolKey memory key,
        uint256 amount0,
        uint256 amount1,
        address recipient,
        bytes calldata hookData
    ) external returns (uint256 liquidity, BalanceDelta memory delta);

    function removeLiquidityFor(PoolKey memory key, uint256 liquidity, address owner, bytes calldata hookData)
        external
        returns (BalanceDelta memory delta);

    function swap(
        PoolKey memory key,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOutMin,
        bytes calldata hookData
    ) external returns (BalanceDelta memory delta);

    function sync(Currency currency) external;

    function settle(Currency currency) external payable returns (uint256 paid);

    function take(Currency currency, address to, uint256 amount) external;

    function getReserves(PoolId id) external view returns (uint128 reserve0, uint128 reserve1);

    function getLiquidity(PoolId id, address owner) external view returns (uint256);

    function isInitialized(PoolId id) external view returns (bool);

    function getAmountOut(PoolId id, bool zeroForOne, uint256 amountIn) external view returns (uint256);
}
