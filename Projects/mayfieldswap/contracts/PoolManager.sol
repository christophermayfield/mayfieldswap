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
import "./libraries/TransientLock.sol";
import "./libraries/TransientDelta.sol";

/// @title PoolManager
/// @notice Uniswap V4–style singleton manager: unlock, concentrated liquidity, EIP-1153 flash accounting, LP fees.
contract PoolManager is IPoolManager {
    using Pool for Pool.State;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeCast for int256;
    using SafeCast for uint256;

    mapping(PoolId => Pool.State) internal _pools;

    modifier onlyWhenUnlocked() {
        require(TransientLock.isUnlocked(), "PM: locked");
        require(msg.sender == TransientLock.locker(), "PM: not locker");
        _;
    }

    receive() external payable {}

    function unlock(bytes calldata data) external returns (bytes memory result) {
        require(!TransientLock.isUnlocked(), "PM: already unlocked");
        TransientLock.unlock(msg.sender);

        result = IUnlockCallback(msg.sender).unlockCallback(data);

        require(TransientDelta.nonzeroCount() == 0, "PM: unsettled");
        TransientLock.lock();
    }

    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick) {
        require(Currency.unwrap(key.currency0) < Currency.unwrap(key.currency1), "PM: currency order");
        require(key.tickSpacing > 0, "PM: spacing");

        PoolId id = key.toId();
        Pool.State storage pool = _pools[id];
        require(pool.slot0.sqrtPriceX96 == 0, "PM: initialized");

        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).beforeInitialize(msg.sender, key, sqrtPriceX96) == IHooks.beforeInitialize.selector,
                "PM: hook before init"
            );
        }

        pool.initialize(sqrtPriceX96, key.tickSpacing, key.fee);
        tick = pool.slot0.tick;

        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).afterInitialize(msg.sender, key, sqrtPriceX96, tick) == IHooks.afterInitialize.selector,
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
        if (key.hooks != address(0) && params.liquidityDelta != 0) {
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

        // Position owner is always the locker (router). Salt distinguishes end-users.
        (int256 amount0, int256 amount1) = pool.modifyPosition(
            Pool.ModifyPositionParams({
                owner: msg.sender,
                tickLower: params.tickLower,
                tickUpper: params.tickUpper,
                liquidityDelta: params.liquidityDelta,
                salt: params.salt
            })
        );

        delta = BalanceDelta({amount0: (-amount0).toInt128(), amount1: (-amount1).toInt128()});
        TransientDelta.account(key.currency0, delta.amount0);
        TransientDelta.account(key.currency1, delta.amount1);

        if (key.hooks != address(0) && params.liquidityDelta != 0) {
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

        emit ModifyLiquidity(id, msg.sender, params.tickLower, params.tickUpper, params.liquidityDelta, params.salt);
    }

    function collect(
        PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        bytes32 salt,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external onlyWhenUnlocked returns (uint128 amount0, uint128 amount1) {
        PoolId id = key.toId();
        (amount0, amount1) = _pools[id].collect(msg.sender, tickLower, tickUpper, salt, amount0Requested, amount1Requested);

        if (amount0 > 0) TransientDelta.account(key.currency0, int256(uint256(amount0)));
        if (amount1 > 0) TransientDelta.account(key.currency1, int256(uint256(amount1)));

        emit Collect(id, msg.sender, tickLower, tickUpper, salt, amount0, amount1);
    }

    function swap(PoolKey memory key, SwapParams memory params, bytes calldata)
        external
        onlyWhenUnlocked
        returns (BalanceDelta memory delta)
    {
        PoolId id = key.toId();
        Pool.State storage pool = _pools[id];
        require(pool.slot0.sqrtPriceX96 != 0, "PM: not initialized");

        uint24 feePips = pool.fee;
        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).beforeSwap(msg.sender, key, params.zeroForOne, params.amountSpecified)
                    == IHooks.beforeSwap.selector,
                "PM: hook before swap"
            );
            uint24 hookFee = IHooks(key.hooks).getSwapFee(key);
            if (hookFee != 0) {
                require(hookFee < 1_000_000, "PM: hook fee");
                feePips = hookFee;
            }
        }

        (int256 amount0, int256 amount1) = pool.swap(
            Pool.SwapParams({
                zeroForOne: params.zeroForOne,
                amountSpecified: params.amountSpecified,
                sqrtPriceLimitX96: params.sqrtPriceLimitX96,
                feePips: feePips
            })
        );

        delta = BalanceDelta({amount0: (-amount0).toInt128(), amount1: (-amount1).toInt128()});
        TransientDelta.account(key.currency0, delta.amount0);
        TransientDelta.account(key.currency1, delta.amount1);

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
        TransientDelta.setSynced(currency, currency.balanceOfSelf());
    }

    function settle(Currency currency) external payable onlyWhenUnlocked returns (uint256 paid) {
        if (currency.isNative()) {
            paid = msg.value;
        } else {
            uint256 balance = currency.balanceOfSelf();
            paid = balance - TransientDelta.getSynced(currency);
            TransientDelta.setSynced(currency, balance);
        }
        require(paid > 0, "PM: no payment");
        TransientDelta.account(currency, int256(paid));
    }

    function take(Currency currency, address to, uint256 amount) external onlyWhenUnlocked {
        require(amount > 0, "PM: zero take");
        TransientDelta.account(currency, -int256(amount));
        currency.transfer(to, amount);
        if (!currency.isNative()) {
            TransientDelta.setSynced(currency, currency.balanceOfSelf());
        }
    }

    function getSlot0(PoolId id) external view returns (uint160 sqrtPriceX96, int24 tick, uint128 liquidity) {
        Pool.State storage pool = _pools[id];
        return (pool.slot0.sqrtPriceX96, pool.slot0.tick, pool.liquidity);
    }

    function getFeeGrowthGlobals(PoolId id)
        external
        view
        returns (uint256 feeGrowthGlobal0X128, uint256 feeGrowthGlobal1X128)
    {
        Pool.State storage pool = _pools[id];
        return (pool.feeGrowthGlobal0X128, pool.feeGrowthGlobal1X128);
    }

    function getPosition(PoolId id, address owner, int24 tickLower, int24 tickUpper, bytes32 salt)
        external
        view
        returns (
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        )
    {
        Position.Info storage position = _pools[id].getPosition(owner, tickLower, tickUpper, salt);
        return (
            position.liquidity,
            position.feeGrowthInside0LastX128,
            position.feeGrowthInside1LastX128,
            position.tokensOwed0,
            position.tokensOwed1
        );
    }

    function getPendingFees(PoolId id, address owner, int24 tickLower, int24 tickUpper, bytes32 salt)
        external
        view
        returns (uint128 amount0, uint128 amount1)
    {
        return _pools[id].getPendingFees(owner, tickLower, tickUpper, salt);
    }

    function isInitialized(PoolId id) external view returns (bool) {
        return _pools[id].slot0.sqrtPriceX96 != 0;
    }

    function currencyDelta(Currency currency) external view returns (int256) {
        return TransientDelta.get(currency);
    }

    function nonzeroDeltaCount() external view returns (uint256) {
        return TransientDelta.nonzeroCount();
    }

    function isUnlocked() external view returns (bool) {
        return TransientLock.isUnlocked();
    }
}
