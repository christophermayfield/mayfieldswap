// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/IPoolManager.sol";
import "./interfaces/IUnlockCallback.sol";
import "./interfaces/IHooks.sol";
import "./types/Currency.sol";
import "./types/PoolKey.sol";
import "./types/PoolId.sol";
import "./types/BalanceDelta.sol";
import "./libraries/CurrencyLibrary.sol";
import "./libraries/Pool.sol";
import "./libraries/SafeCast.sol";

/// @title PoolManager
/// @notice Uniswap V4–style singleton manager: unlock, concentrated liquidity, flash accounting.
contract PoolManager is IPoolManager {
    using Pool for Pool.State;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeCast for int256;
    using SafeCast for uint256;

    mapping(PoolId => Pool.State) internal _pools;

    mapping(Currency => int256) private currencyDeltas;
    uint256 private nonzeroDeltaCount;
    mapping(Currency => uint256) private syncedBalances;

    address private locker;
    bool private unlocked;

    modifier onlyWhenUnlocked() {
        require(unlocked, "PM: locked");
        require(msg.sender == locker, "PM: not locker");
        _;
    }

    receive() external payable {}

    function unlock(bytes calldata data) external returns (bytes memory result) {
        require(!unlocked, "PM: already unlocked");
        unlocked = true;
        locker = msg.sender;

        result = IUnlockCallback(msg.sender).unlockCallback(data);

        require(nonzeroDeltaCount == 0, "PM: unsettled");
        unlocked = false;
        locker = address(0);
    }

    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick) {
        require(Currency.unwrap(key.currency0) < Currency.unwrap(key.currency1), "PM: currency order");
        require(key.tickSpacing > 0, "PM: spacing");

        PoolId id = key.toId();
        Pool.State storage pool = _pools[id];
        require(pool.slot0.sqrtPriceX96 == 0, "PM: initialized");

        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).beforeInitialize(msg.sender, key, sqrtPriceX96)
                    == IHooks.beforeInitialize.selector,
                "PM: hook before init"
            );
        }

        pool.initialize(sqrtPriceX96, key.tickSpacing, key.fee);
        tick = pool.slot0.tick;

        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).afterInitialize(msg.sender, key, sqrtPriceX96, tick)
                    == IHooks.afterInitialize.selector,
                "PM: hook after init"
            );
        }

        emit Initialize(id, key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks, sqrtPriceX96, tick);
    }

    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params, bytes calldata)
        external
        onlyWhenUnlocked
        returns (BalanceDelta memory delta)
    {
        PoolId id = key.toId();
        Pool.State storage pool = _pools[id];
        require(pool.slot0.sqrtPriceX96 != 0, "PM: not initialized");
        require(params.tickLower % key.tickSpacing == 0 && params.tickUpper % key.tickSpacing == 0, "PM: tick spacing");

        bool isAdd = params.liquidityDelta > 0;
        if (key.hooks != address(0)) {
            if (isAdd) {
                require(
                    IHooks(key.hooks).beforeAddLiquidity(
                        msg.sender, key, params.tickLower, params.tickUpper, params.liquidityDelta
                    ) == IHooks.beforeAddLiquidity.selector,
                    "PM: hook before add"
                );
            } else {
                require(
                    IHooks(key.hooks).beforeRemoveLiquidity(
                        msg.sender, key, params.tickLower, params.tickUpper, params.liquidityDelta
                    ) == IHooks.beforeRemoveLiquidity.selector,
                    "PM: hook before remove"
                );
            }
        }

        (int256 amount0, int256 amount1) = pool.modifyPosition(
            Pool.ModifyPositionParams({
                owner: params.owner,
                tickLower: params.tickLower,
                tickUpper: params.tickUpper,
                liquidityDelta: params.liquidityDelta
            })
        );

        // Pool returns token deltas owed TO the pool when adding (positive amounts mean caller pays).
        // Flash accounting: negative = caller owes manager.
        delta = BalanceDelta({amount0: (-amount0).toInt128(), amount1: (-amount1).toInt128()});
        _account(key.currency0, delta.amount0);
        _account(key.currency1, delta.amount1);

        if (key.hooks != address(0)) {
            if (isAdd) {
                require(
                    IHooks(key.hooks).afterAddLiquidity(
                        msg.sender, key, params.tickLower, params.tickUpper, params.liquidityDelta, delta
                    ) == IHooks.afterAddLiquidity.selector,
                    "PM: hook after add"
                );
            } else {
                require(
                    IHooks(key.hooks).afterRemoveLiquidity(
                        msg.sender, key, params.tickLower, params.tickUpper, params.liquidityDelta, delta
                    ) == IHooks.afterRemoveLiquidity.selector,
                    "PM: hook after remove"
                );
            }
        }

        emit ModifyLiquidity(id, msg.sender, params.tickLower, params.tickUpper, params.liquidityDelta);
    }

    function swap(PoolKey memory key, SwapParams memory params, bytes calldata)
        external
        onlyWhenUnlocked
        returns (BalanceDelta memory delta)
    {
        PoolId id = key.toId();
        Pool.State storage pool = _pools[id];
        require(pool.slot0.sqrtPriceX96 != 0, "PM: not initialized");

        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).beforeSwap(msg.sender, key, params.zeroForOne, params.amountSpecified)
                    == IHooks.beforeSwap.selector,
                "PM: hook before swap"
            );
        }

        (int256 amount0, int256 amount1) = pool.swap(
            Pool.SwapParams({
                zeroForOne: params.zeroForOne,
                amountSpecified: params.amountSpecified,
                sqrtPriceLimitX96: params.sqrtPriceLimitX96,
                feePips: pool.fee
            })
        );

        // Swap returns signed amounts from the pool's perspective matching Uniswap V3:
        // positive amountX means tokens going TO the pool (caller pays).
        delta = BalanceDelta({amount0: (-amount0).toInt128(), amount1: (-amount1).toInt128()});
        _account(key.currency0, delta.amount0);
        _account(key.currency1, delta.amount1);

        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).afterSwap(msg.sender, key, params.zeroForOne, params.amountSpecified, delta)
                    == IHooks.afterSwap.selector,
                "PM: hook after swap"
            );
        }

        emit Swap(id, msg.sender, amount0, amount1, pool.slot0.sqrtPriceX96, pool.liquidity, pool.slot0.tick);
    }

    function sync(Currency currency) external onlyWhenUnlocked {
        syncedBalances[currency] = currency.balanceOfSelf();
    }

    function settle(Currency currency) external payable onlyWhenUnlocked returns (uint256 paid) {
        if (currency.isNative()) {
            paid = msg.value;
        } else {
            uint256 balance = currency.balanceOfSelf();
            paid = balance - syncedBalances[currency];
            syncedBalances[currency] = balance;
        }
        require(paid > 0, "PM: no payment");
        _account(currency, int256(paid));
    }

    function take(Currency currency, address to, uint256 amount) external onlyWhenUnlocked {
        require(amount > 0, "PM: zero take");
        _account(currency, -int256(amount));
        currency.transfer(to, amount);
        if (!currency.isNative()) {
            syncedBalances[currency] = currency.balanceOfSelf();
        }
    }

    function getSlot0(PoolId id) external view returns (uint160 sqrtPriceX96, int24 tick, uint128 liquidity) {
        Pool.State storage pool = _pools[id];
        return (pool.slot0.sqrtPriceX96, pool.slot0.tick, pool.liquidity);
    }

    function getPositionLiquidity(PoolId id, address owner, int24 tickLower, int24 tickUpper)
        external
        view
        returns (uint128)
    {
        return _pools[id].getPosition(owner, tickLower, tickUpper).liquidity;
    }

    function isInitialized(PoolId id) external view returns (bool) {
        return _pools[id].slot0.sqrtPriceX96 != 0;
    }

    function _account(Currency currency, int256 delta) private {
        if (delta == 0) return;
        int256 prev = currencyDeltas[currency];
        int256 next = prev + delta;
        unchecked {
            if (prev == 0 && next != 0) nonzeroDeltaCount++;
            else if (prev != 0 && next == 0) nonzeroDeltaCount--;
        }
        currencyDeltas[currency] = next;
    }
}
