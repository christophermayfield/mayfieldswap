// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IPoolManager.sol";
import "../interfaces/IUnlockCallback.sol";
import "../types/Currency.sol";
import "../types/PoolKey.sol";
import "../types/PoolId.sol";
import "../types/BalanceDelta.sol";
import "../libraries/V4Libraries.sol";
import "../../interfaces/IERC20.sol";
import "../../interfaces/IWETH.sol";
import "../../libraries/TransferHelper.sol";

/// @title MayfieldRouter
/// @notice V4-style periphery: all pool ops run inside PoolManager.unlock().
contract MayfieldRouter is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    IPoolManager public immutable poolManager;
    address public immutable WETH;

    uint24 public constant DEFAULT_FEE = 3000; // 0.30%
    int24 public constant DEFAULT_TICK_SPACING = 60;

    enum Action {
        Swap,
        AddLiquidity,
        RemoveLiquidity
    }

    struct SwapParams {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        uint256 amountOutMin;
        address recipient;
        address payer;
    }

    struct AddLiquidityParams {
        PoolKey key;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        address payer;
    }

    struct RemoveLiquidityParams {
        PoolKey key;
        uint256 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        address owner;
    }

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "MayfieldRouter: EXPIRED");
        _;
    }

    constructor(address _poolManager, address _weth) {
        poolManager = IPoolManager(_poolManager);
        WETH = _weth;
    }

    receive() external payable {
        require(msg.sender == WETH, "MayfieldRouter: ONLY_WETH");
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    function initializePool(address tokenA, address tokenB, uint24 fee, address hooks)
        external
        returns (PoolId id)
    {
        PoolKey memory key = _buildKey(tokenA, tokenB, fee, hooks);
        id = poolManager.initialize(key);
    }

    function swapExactTokensForTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountOut) {
        PoolKey memory key = _defaultKey(tokenIn, tokenOut);
        bool zeroForOne = Currency.unwrap(key.currency0) == tokenIn;

        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.Swap,
                abi.encode(
                    SwapParams({
                        key: key,
                        zeroForOne: zeroForOne,
                        amountIn: amountIn,
                        amountOutMin: amountOutMin,
                        recipient: recipient,
                        payer: msg.sender
                    })
                )
            )
        );
        amountOut = abi.decode(result, (uint256));
    }

    function swapExactETHForTokens(address tokenOut, uint256 amountOutMin, address recipient, uint256 deadline)
        external
        payable
        ensure(deadline)
        returns (uint256 amountOut)
    {
        PoolKey memory key = _defaultKey(WETH, tokenOut);
        bool zeroForOne = Currency.unwrap(key.currency0) == WETH;

        IWETH(WETH).deposit{value: msg.value}();

        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.Swap,
                abi.encode(
                    SwapParams({
                        key: key,
                        zeroForOne: zeroForOne,
                        amountIn: msg.value,
                        amountOutMin: amountOutMin,
                        recipient: recipient,
                        payer: address(this)
                    })
                )
            )
        );
        amountOut = abi.decode(result, (uint256));
    }

    function swapExactTokensForETH(
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountOut) {
        PoolKey memory key = _defaultKey(tokenIn, WETH);
        bool zeroForOne = Currency.unwrap(key.currency0) == tokenIn;

        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.Swap,
                abi.encode(
                    SwapParams({
                        key: key,
                        zeroForOne: zeroForOne,
                        amountIn: amountIn,
                        amountOutMin: amountOutMin,
                        recipient: address(this),
                        payer: msg.sender
                    })
                )
            )
        );
        amountOut = abi.decode(result, (uint256));
        IWETH(WETH).withdraw(amountOut);
        TransferHelper.safeTransferETH(recipient, amountOut);
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amount0, uint256 amount1, uint256 liquidity) {
        PoolKey memory key = _defaultKey(tokenA, tokenB);
        (uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min) =
            _alignAmounts(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);

        // Auto-initialize pool if needed
        PoolId id = key.toId();
        if (!poolManager.isInitialized(id)) {
            poolManager.initialize(key);
        }

        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.AddLiquidity,
                abi.encode(
                    AddLiquidityParams({
                        key: key,
                        amount0Desired: amount0Desired,
                        amount1Desired: amount1Desired,
                        amount0Min: amount0Min,
                        amount1Min: amount1Min,
                        recipient: recipient,
                        payer: msg.sender
                    })
                )
            )
        );
        (amount0, amount1, liquidity) = abi.decode(result, (uint256, uint256, uint256));
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amount0, uint256 amount1) {
        PoolKey memory key = _defaultKey(tokenA, tokenB);
        (address token0,) = _sort(tokenA, tokenB);
        uint256 amount0Min = tokenA == token0 ? amountAMin : amountBMin;
        uint256 amount1Min = tokenA == token0 ? amountBMin : amountAMin;

        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.RemoveLiquidity,
                abi.encode(
                    RemoveLiquidityParams({
                        key: key,
                        liquidity: liquidity,
                        amount0Min: amount0Min,
                        amount1Min: amount1Min,
                        recipient: recipient,
                        owner: msg.sender
                    })
                )
            )
        );
        (amount0, amount1) = abi.decode(result, (uint256, uint256));
    }

    function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn)
        external
        view
        returns (uint256 amountOut)
    {
        PoolKey memory key = _defaultKey(tokenIn, tokenOut);
        PoolId id = key.toId();
        bool zeroForOne = Currency.unwrap(key.currency0) == tokenIn;
        return poolManager.getAmountOut(id, zeroForOne, amountIn);
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "MayfieldRouter: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; i++) {
            amounts[i + 1] = this.getAmountOut(path[i], path[i + 1], amounts[i]);
        }
    }

    function getLiquidity(address tokenA, address tokenB, address owner) external view returns (uint256) {
        PoolKey memory key = _defaultKey(tokenA, tokenB);
        return poolManager.getLiquidity(key.toId(), owner);
    }

    function getReserves(address tokenA, address tokenB) external view returns (uint128 reserve0, uint128 reserve1) {
        PoolKey memory key = _defaultKey(tokenA, tokenB);
        return poolManager.getReserves(key.toId());
    }

    function poolKeyFor(address tokenA, address tokenB) external pure returns (PoolKey memory) {
        return _defaultKey(tokenA, tokenB);
    }

    // ─── Unlock callback ──────────────────────────────────────────────────────

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "MayfieldRouter: NOT_MANAGER");
        (Action action, bytes memory payload) = abi.decode(data, (Action, bytes));

        if (action == Action.Swap) {
            return _swap(abi.decode(payload, (SwapParams)));
        }
        if (action == Action.AddLiquidity) {
            return _addLiquidity(abi.decode(payload, (AddLiquidityParams)));
        }
        if (action == Action.RemoveLiquidity) {
            return _removeLiquidity(abi.decode(payload, (RemoveLiquidityParams)));
        }
        revert("MayfieldRouter: UNKNOWN_ACTION");
    }

    // ─── Internal actions ─────────────────────────────────────────────────────

    function _swap(SwapParams memory params) internal returns (bytes memory) {
        BalanceDelta memory delta =
            poolManager.swap(params.key, params.zeroForOne, params.amountIn, params.amountOutMin, "");

        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        Currency output = params.zeroForOne ? params.key.currency1 : params.key.currency0;
        uint256 amountOut = params.zeroForOne ? uint256(int256(delta.amount1)) : uint256(int256(delta.amount0));

        _pay(input, params.payer, params.amountIn);
        poolManager.take(output, params.recipient, amountOut);

        return abi.encode(amountOut);
    }

    function _addLiquidity(AddLiquidityParams memory params) internal returns (bytes memory) {
        (uint128 reserve0, uint128 reserve1) = poolManager.getReserves(params.key.toId());

        uint256 amount0 = params.amount0Desired;
        uint256 amount1 = params.amount1Desired;
        if (reserve0 > 0 || reserve1 > 0) {
            uint256 amount1Optimal = CPMM.quote(params.amount0Desired, reserve0, reserve1);
            if (amount1Optimal <= params.amount1Desired) {
                require(amount1Optimal >= params.amount1Min, "MayfieldRouter: INSUFFICIENT_1");
                amount1 = amount1Optimal;
            } else {
                uint256 amount0Optimal = CPMM.quote(params.amount1Desired, reserve1, reserve0);
                require(amount0Optimal <= params.amount0Desired, "MayfieldRouter: EXCESSIVE_0");
                require(amount0Optimal >= params.amount0Min, "MayfieldRouter: INSUFFICIENT_0");
                amount0 = amount0Optimal;
            }
        }

        (uint256 liquidity, BalanceDelta memory delta) =
            poolManager.addLiquidity(params.key, amount0, amount1, params.recipient, "");

        // Use actual consumed amounts from delta
        amount0 = uint256(int256(-delta.amount0));
        amount1 = uint256(int256(-delta.amount1));
        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "MayfieldRouter: SLIPPAGE");

        _pay(params.key.currency0, params.payer, amount0);
        _pay(params.key.currency1, params.payer, amount1);

        return abi.encode(amount0, amount1, liquidity);
    }

    function _removeLiquidity(RemoveLiquidityParams memory params) internal returns (bytes memory) {
        BalanceDelta memory delta =
            poolManager.removeLiquidityFor(params.key, params.liquidity, params.owner, "");

        uint256 amount0 = uint256(int256(delta.amount0));
        uint256 amount1 = uint256(int256(delta.amount1));
        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "MayfieldRouter: SLIPPAGE");

        poolManager.take(params.key.currency0, params.recipient, amount0);
        poolManager.take(params.key.currency1, params.recipient, amount1);

        return abi.encode(amount0, amount1);
    }

    function _pay(Currency currency, address payer, uint256 amount) internal {
        poolManager.sync(currency);
        if (payer == address(this)) {
            TransferHelper.safeTransfer(Currency.unwrap(currency), address(poolManager), amount);
        } else {
            TransferHelper.safeTransferFrom(Currency.unwrap(currency), payer, address(poolManager), amount);
        }
        poolManager.settle(currency);
    }

    function _defaultKey(address tokenA, address tokenB) internal pure returns (PoolKey memory) {
        return _buildKey(tokenA, tokenB, DEFAULT_FEE, address(0));
    }

    function _buildKey(address tokenA, address tokenB, uint24 fee, address hooks)
        internal
        pure
        returns (PoolKey memory key)
    {
        (address token0, address token1) = _sort(tokenA, tokenB);
        key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: fee,
            tickSpacing: DEFAULT_TICK_SPACING,
            hooks: hooks
        });
    }

    function _sort(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        require(tokenA != tokenB, "MayfieldRouter: IDENTICAL");
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "MayfieldRouter: ZERO");
    }

    function _alignAmounts(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal pure returns (uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min) {
        (address token0,) = _sort(tokenA, tokenB);
        if (tokenA == token0) {
            return (amountADesired, amountBDesired, amountAMin, amountBMin);
        }
        return (amountBDesired, amountADesired, amountBMin, amountAMin);
    }
}
