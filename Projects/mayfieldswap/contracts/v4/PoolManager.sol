// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/IPoolManager.sol";
import "./interfaces/IUnlockCallback.sol";
import "./interfaces/IHooks.sol";
import "./types/Currency.sol";
import "./types/PoolKey.sol";
import "./types/PoolId.sol";
import "./types/BalanceDelta.sol";
import "./libraries/V4Libraries.sol";
import "../libraries/Math.sol";

/// @title MayfieldPoolManager
/// @notice Uniswap V4–style singleton pool manager with unlock / flash accounting.
/// @dev Phase 1 uses constant-product math inside each pool; layout matches V4.
contract MayfieldPoolManager is IPoolManager {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    uint256 public constant MINIMUM_LIQUIDITY = 10 ** 3;

    struct PoolState {
        bool initialized;
        uint128 reserve0;
        uint128 reserve1;
        uint256 totalLiquidity;
        uint24 fee;
    }

    mapping(PoolId => PoolState) internal pools;
    mapping(PoolId => mapping(address => uint256)) public liquidityOf;

    /// @dev Currency deltas for the active locker (educational stand-in for transient storage).
    mapping(Currency => int256) private currencyDeltas;
    uint256 private nonzeroDeltaCount;

    /// @dev Last synced ERC-20 balance for settle().
    mapping(Currency => uint256) private syncedBalances;

    address private locker;
    bool private unlocked;

    modifier onlyWhenUnlocked() {
        require(unlocked, "PoolManager: LOCKED");
        require(msg.sender == locker, "PoolManager: NOT_LOCKER");
        _;
    }

    receive() external payable {}

    /// @inheritdoc IPoolManager
    function unlock(bytes calldata data) external returns (bytes memory result) {
        require(!unlocked, "PoolManager: ALREADY_UNLOCKED");
        unlocked = true;
        locker = msg.sender;

        result = IUnlockCallback(msg.sender).unlockCallback(data);

        require(nonzeroDeltaCount == 0, "PoolManager: CURRENCY_NOT_SETTLED");
        unlocked = false;
        locker = address(0);
    }

    /// @inheritdoc IPoolManager
    function initialize(PoolKey memory key) external returns (PoolId id) {
        require(Currency.unwrap(key.currency0) < Currency.unwrap(key.currency1), "PoolManager: CURRENCIES_OUT_OF_ORDER");
        require(key.fee < 1_000_000, "PoolManager: FEE_TOO_HIGH");

        id = key.toId();
        PoolState storage pool = pools[id];
        require(!pool.initialized, "PoolManager: ALREADY_INITIALIZED");

        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).beforeInitialize(msg.sender, key) == IHooks.beforeInitialize.selector,
                "PoolManager: HOOK_BEFORE_INIT"
            );
        }

        pool.initialized = true;
        pool.fee = key.fee;

        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).afterInitialize(msg.sender, key) == IHooks.afterInitialize.selector,
                "PoolManager: HOOK_AFTER_INIT"
            );
        }

        emit Initialize(id, key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks);
    }

    /// @notice Add liquidity with explicit token amounts (CPMM Phase 1).
    function addLiquidity(PoolKey memory key, uint256 amount0, uint256 amount1, address recipient, bytes calldata)
        external
        onlyWhenUnlocked
        returns (uint256 liquidity, BalanceDelta memory delta)
    {
        require(amount0 > 0 && amount1 > 0, "PoolManager: INSUFFICIENT_AMOUNT");
        PoolId id = key.toId();
        PoolState storage pool = pools[id];
        require(pool.initialized, "PoolManager: NOT_INITIALIZED");

        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).beforeAddLiquidity(msg.sender, key, amount0, amount1)
                    == IHooks.beforeAddLiquidity.selector,
                "PoolManager: HOOK_BEFORE_ADD"
            );
        }

        if (pool.totalLiquidity == 0) {
            liquidity = Math.sqrt(amount0 * amount1);
            require(liquidity > MINIMUM_LIQUIDITY, "PoolManager: MIN_LIQUIDITY");
            liquidityOf[id][address(0)] = MINIMUM_LIQUIDITY; // permanently locked
            liquidity -= MINIMUM_LIQUIDITY;
        } else {
            uint256 liq0 = (amount0 * pool.totalLiquidity) / pool.reserve0;
            uint256 liq1 = (amount1 * pool.totalLiquidity) / pool.reserve1;
            liquidity = liq0 < liq1 ? liq0 : liq1;
            require(liquidity > 0, "PoolManager: INSUFFICIENT_LIQUIDITY_MINTED");
            // Use proportional amounts actually consumed
            amount0 = (liquidity * pool.reserve0) / pool.totalLiquidity;
            amount1 = (liquidity * pool.reserve1) / pool.totalLiquidity;
        }

        pool.reserve0 += uint128(amount0);
        pool.reserve1 += uint128(amount1);
        pool.totalLiquidity += liquidity;
        liquidityOf[id][recipient] += liquidity;

        delta = BalanceDelta({amount0: -_toInt128(amount0), amount1: -_toInt128(amount1)});
        _accountDelta(key.currency0, delta.amount0);
        _accountDelta(key.currency1, delta.amount1);

        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).afterAddLiquidity(msg.sender, key, amount0, amount1, delta)
                    == IHooks.afterAddLiquidity.selector,
                "PoolManager: HOOK_AFTER_ADD"
            );
        }

        emit ModifyLiquidity(id, msg.sender, int256(liquidity), delta);
    }

    /// @inheritdoc IPoolManager
    function removeLiquidityFor(PoolKey memory key, uint256 liquidity, address owner, bytes calldata)
        external
        onlyWhenUnlocked
        returns (BalanceDelta memory delta)
    {
        require(liquidity > 0, "PoolManager: ZERO_LIQUIDITY");
        PoolId id = key.toId();
        PoolState storage pool = pools[id];
        require(pool.initialized, "PoolManager: NOT_INITIALIZED");
        require(liquidityOf[id][owner] >= liquidity, "PoolManager: INSUFFICIENT_LP");

        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).beforeRemoveLiquidity(msg.sender, key, liquidity)
                    == IHooks.beforeRemoveLiquidity.selector,
                "PoolManager: HOOK_BEFORE_REMOVE"
            );
        }

        uint256 amount0 = (liquidity * pool.reserve0) / pool.totalLiquidity;
        uint256 amount1 = (liquidity * pool.reserve1) / pool.totalLiquidity;
        require(amount0 > 0 && amount1 > 0, "PoolManager: INSUFFICIENT_BURNED");

        liquidityOf[id][owner] -= liquidity;
        pool.totalLiquidity -= liquidity;
        pool.reserve0 -= uint128(amount0);
        pool.reserve1 -= uint128(amount1);

        delta = BalanceDelta({amount0: _toInt128(amount0), amount1: _toInt128(amount1)});
        _accountDelta(key.currency0, delta.amount0);
        _accountDelta(key.currency1, delta.amount1);

        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).afterRemoveLiquidity(msg.sender, key, liquidity, delta)
                    == IHooks.afterRemoveLiquidity.selector,
                "PoolManager: HOOK_AFTER_REMOVE"
            );
        }

        emit ModifyLiquidity(id, msg.sender, -int256(liquidity), delta);
    }

    /// @inheritdoc IPoolManager
    function swap(
        PoolKey memory key,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOutMin,
        bytes calldata
    ) external onlyWhenUnlocked returns (BalanceDelta memory delta) {
        require(amountIn > 0, "PoolManager: INSUFFICIENT_INPUT");
        PoolId id = key.toId();
        PoolState storage pool = pools[id];
        require(pool.initialized, "PoolManager: NOT_INITIALIZED");

        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).beforeSwap(msg.sender, key, zeroForOne, amountIn) == IHooks.beforeSwap.selector,
                "PoolManager: HOOK_BEFORE_SWAP"
            );
        }

        uint256 amountOut;
        if (zeroForOne) {
            amountOut = CPMM.getAmountOut(amountIn, pool.reserve0, pool.reserve1, pool.fee);
            require(amountOut >= amountOutMin, "PoolManager: SLIPPAGE");
            pool.reserve0 += uint128(amountIn);
            pool.reserve1 -= uint128(amountOut);
            delta = BalanceDelta({amount0: -_toInt128(amountIn), amount1: _toInt128(amountOut)});
        } else {
            amountOut = CPMM.getAmountOut(amountIn, pool.reserve1, pool.reserve0, pool.fee);
            require(amountOut >= amountOutMin, "PoolManager: SLIPPAGE");
            pool.reserve1 += uint128(amountIn);
            pool.reserve0 -= uint128(amountOut);
            delta = BalanceDelta({amount0: _toInt128(amountOut), amount1: -_toInt128(amountIn)});
        }

        _accountDelta(key.currency0, delta.amount0);
        _accountDelta(key.currency1, delta.amount1);

        if (key.hooks != address(0)) {
            require(
                IHooks(key.hooks).afterSwap(msg.sender, key, zeroForOne, amountIn, delta)
                    == IHooks.afterSwap.selector,
                "PoolManager: HOOK_AFTER_SWAP"
            );
        }

        emit Swap(id, msg.sender, zeroForOne, amountIn, amountOut, delta);
    }

    /// @inheritdoc IPoolManager
    function sync(Currency currency) external onlyWhenUnlocked {
        syncedBalances[currency] = currency.balanceOf(address(this));
    }

    /// @inheritdoc IPoolManager
    function settle(Currency currency) external payable onlyWhenUnlocked returns (uint256 paid) {
        if (currency.isNative()) {
            paid = msg.value;
        } else {
            uint256 balance = currency.balanceOf(address(this));
            paid = balance - syncedBalances[currency];
            syncedBalances[currency] = balance;
        }
        require(paid > 0, "PoolManager: NO_PAYMENT");
        // Paying the manager clears debt (negative delta) by adding a positive credit.
        _accountDelta(currency, int256(paid));
    }

    /// @inheritdoc IPoolManager
    function take(Currency currency, address to, uint256 amount) external onlyWhenUnlocked {
        require(amount > 0, "PoolManager: ZERO_TAKE");
        _accountDelta(currency, -int256(amount));
        currency.transfer(to, amount);
        if (!currency.isNative()) {
            syncedBalances[currency] = currency.balanceOf(address(this));
        }
    }

    function getReserves(PoolId id) external view returns (uint128 reserve0, uint128 reserve1) {
        PoolState storage pool = pools[id];
        return (pool.reserve0, pool.reserve1);
    }

    function getLiquidity(PoolId id, address owner) external view returns (uint256) {
        return liquidityOf[id][owner];
    }

    function isInitialized(PoolId id) external view returns (bool) {
        return pools[id].initialized;
    }

    function getAmountOut(PoolId id, bool zeroForOne, uint256 amountIn) external view returns (uint256) {
        PoolState storage pool = pools[id];
        require(pool.initialized, "PoolManager: NOT_INITIALIZED");
        if (zeroForOne) {
            return CPMM.getAmountOut(amountIn, pool.reserve0, pool.reserve1, pool.fee);
        }
        return CPMM.getAmountOut(amountIn, pool.reserve1, pool.reserve0, pool.fee);
    }

    function currencyDelta(Currency currency) external view returns (int256) {
        return currencyDeltas[currency];
    }

    function _accountDelta(Currency currency, int256 delta) private {
        if (delta == 0) return;
        int256 previous = currencyDeltas[currency];
        int256 next = previous + delta;
        unchecked {
            if (previous == 0 && next != 0) nonzeroDeltaCount++;
            else if (previous != 0 && next == 0) nonzeroDeltaCount--;
        }
        currencyDeltas[currency] = next;
    }

    function _toInt128(uint256 value) private pure returns (int128) {
        require(value <= uint256(uint128(type(int128).max)), "PoolManager: AMOUNT_OVERFLOW");
        return int128(int256(value));
    }
}
