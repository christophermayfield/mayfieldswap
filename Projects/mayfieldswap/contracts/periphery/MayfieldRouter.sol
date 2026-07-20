// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IPoolManager.sol";
import "../interfaces/IUnlockCallback.sol";
import "../types/Currency.sol";
import "../types/PoolKey.sol";
import "../types/PoolId.sol";
import "../types/BalanceDelta.sol";
import "../libraries/CurrencyLibrary.sol";
import "../libraries/LiquidityAmounts.sol";
import "../libraries/TickMath.sol";
import "../libraries/TransferHelper.sol";
import "../interfaces/IWETH.sol";

/// @title MayfieldRouter
/// @notice V4 periphery: swaps and full-range (or custom) liquidity via PoolManager.unlock.
contract MayfieldRouter is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    IPoolManager public immutable poolManager;
    address public immutable WETH;

    uint24 public constant DEFAULT_FEE = 3000;
    int24 public constant DEFAULT_TICK_SPACING = 60;

    mapping(PoolId => mapping(address => uint128)) public liquidityOf;

    enum Action {
        Swap,
        AddLiquidity,
        RemoveLiquidity
    }

    struct SwapExactInputParams {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        uint256 amountOutMin;
        address recipient;
        address payer;
    }

    struct AddLiquidityParams {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        address payer;
    }

    struct RemoveLiquidityParams {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        address owner;
    }

    modifier ensure(uint256 deadline) {
        require(block.timestamp <= deadline, "Router: expired");
        _;
    }

    constructor(address _poolManager, address _weth) {
        poolManager = IPoolManager(_poolManager);
        WETH = _weth;
    }

    receive() external payable {
        require(msg.sender == WETH, "Router: WETH only");
    }

    function defaultKey(address tokenA, address tokenB) public pure returns (PoolKey memory key) {
        (address t0, address t1) = sort(tokenA, tokenB);
        key = PoolKey({
            currency0: Currency.wrap(t0),
            currency1: Currency.wrap(t1),
            fee: DEFAULT_FEE,
            tickSpacing: DEFAULT_TICK_SPACING,
            hooks: address(0)
        });
    }

    function sort(address a, address b) public pure returns (address token0, address token1) {
        require(a != b && a != address(0) && b != address(0), "Router: tokens");
        (token0, token1) = a < b ? (a, b) : (b, a);
    }

    function fullRangeTicks() public pure returns (int24 tickLower, int24 tickUpper) {
        tickLower = (TickMath.MIN_TICK / DEFAULT_TICK_SPACING) * DEFAULT_TICK_SPACING;
        tickUpper = (TickMath.MAX_TICK / DEFAULT_TICK_SPACING) * DEFAULT_TICK_SPACING;
    }

    function initializePool(address tokenA, address tokenB, uint160 sqrtPriceX96) external returns (int24 tick) {
        PoolKey memory key = defaultKey(tokenA, tokenB);
        tick = poolManager.initialize(key, sqrtPriceX96);
    }

    function swapExactTokensForTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountOut) {
        PoolKey memory key = defaultKey(tokenIn, tokenOut);
        bool zeroForOne = Currency.unwrap(key.currency0) == tokenIn;
        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.Swap,
                abi.encode(
                    SwapExactInputParams({
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
        IWETH(WETH).deposit{value: msg.value}();
        PoolKey memory key = defaultKey(WETH, tokenOut);
        bool zeroForOne = Currency.unwrap(key.currency0) == WETH;
        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.Swap,
                abi.encode(
                    SwapExactInputParams({
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
        PoolKey memory key = defaultKey(tokenIn, WETH);
        bool zeroForOne = Currency.unwrap(key.currency0) == tokenIn;
        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.Swap,
                abi.encode(
                    SwapExactInputParams({
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
    ) external ensure(deadline) returns (uint256 amount0, uint256 amount1, uint128 liquidity) {
        PoolKey memory key = defaultKey(tokenA, tokenB);
        (int24 tickLower, int24 tickUpper) = fullRangeTicks();
        (address token0,) = sort(tokenA, tokenB);
        uint256 amount0Desired = tokenA == token0 ? amountADesired : amountBDesired;
        uint256 amount1Desired = tokenA == token0 ? amountBDesired : amountADesired;
        uint256 amount0Min_ = tokenA == token0 ? amountAMin : amountBMin;
        uint256 amount1Min_ = tokenA == token0 ? amountBMin : amountAMin;

        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.AddLiquidity,
                abi.encode(
                    AddLiquidityParams({
                        key: key,
                        tickLower: tickLower,
                        tickUpper: tickUpper,
                        amount0Desired: amount0Desired,
                        amount1Desired: amount1Desired,
                        amount0Min: amount0Min_,
                        amount1Min: amount1Min_,
                        recipient: recipient,
                        payer: msg.sender
                    })
                )
            )
        );
        (amount0, amount1, liquidity) = abi.decode(result, (uint256, uint256, uint128));
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint128 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amount0, uint256 amount1) {
        PoolKey memory key = defaultKey(tokenA, tokenB);
        (int24 tickLower, int24 tickUpper) = fullRangeTicks();
        (address token0,) = sort(tokenA, tokenB);
        uint256 amount0Min = tokenA == token0 ? amountAMin : amountBMin;
        uint256 amount1Min = tokenA == token0 ? amountBMin : amountAMin;

        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.RemoveLiquidity,
                abi.encode(
                    RemoveLiquidityParams({
                        key: key,
                        tickLower: tickLower,
                        tickUpper: tickUpper,
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

    function getLiquidity(address tokenA, address tokenB, address owner) external view returns (uint128) {
        PoolKey memory key = defaultKey(tokenA, tokenB);
        return liquidityOf[key.toId()][owner];
    }

    function quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn)
        external
        view
        returns (uint256)
    {
        // Placeholder for ABI stability — use Quoter.quoteExactInput via eth_call in production UIs.
        tokenIn;
        tokenOut;
        amountIn;
        revert("Router: use Quoter");
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "Router: not manager");
        (Action action, bytes memory payload) = abi.decode(data, (Action, bytes));
        if (action == Action.Swap) return _swap(abi.decode(payload, (SwapExactInputParams)));
        if (action == Action.AddLiquidity) return _add(abi.decode(payload, (AddLiquidityParams)));
        if (action == Action.RemoveLiquidity) return _remove(abi.decode(payload, (RemoveLiquidityParams)));
        revert("Router: action");
    }

    function _swap(SwapExactInputParams memory p) internal returns (bytes memory) {
        uint160 limit = p.zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1;
        BalanceDelta memory delta = poolManager.swap(
            p.key,
            IPoolManager.SwapParams({
                zeroForOne: p.zeroForOne,
                amountSpecified: int256(p.amountIn),
                sqrtPriceLimitX96: limit
            }),
            ""
        );

        uint256 amountOut = p.zeroForOne ? uint256(int256(delta.amount1)) : uint256(int256(delta.amount0));
        require(amountOut >= p.amountOutMin, "Router: slippage");

        Currency input = p.zeroForOne ? p.key.currency0 : p.key.currency1;
        Currency output = p.zeroForOne ? p.key.currency1 : p.key.currency0;
        _pay(input, p.payer, p.amountIn);
        poolManager.take(output, p.recipient, amountOut);
        return abi.encode(amountOut);
    }

    function _add(AddLiquidityParams memory p) internal returns (bytes memory) {
        (uint160 sqrtPriceX96,,) = poolManager.getSlot0(p.key.toId());
        uint160 sqrtA = TickMath.getSqrtRatioAtTick(p.tickLower);
        uint160 sqrtB = TickMath.getSqrtRatioAtTick(p.tickUpper);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, sqrtA, sqrtB, p.amount0Desired, p.amount1Desired
        );
        require(liquidity > 0, "Router: zero liquidity");

        BalanceDelta memory delta = poolManager.modifyLiquidity(
            p.key,
            IPoolManager.ModifyLiquidityParams({
                owner: address(this),
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                liquidityDelta: int128(uint128(liquidity))
            }),
            ""
        );

        uint256 amount0 = uint256(int256(-delta.amount0));
        uint256 amount1 = uint256(int256(-delta.amount1));
        require(amount0 >= p.amount0Min && amount1 >= p.amount1Min, "Router: slippage");

        liquidityOf[p.key.toId()][p.recipient] += liquidity;

        _pay(p.key.currency0, p.payer, amount0);
        _pay(p.key.currency1, p.payer, amount1);
        return abi.encode(amount0, amount1, liquidity);
    }

    function _remove(RemoveLiquidityParams memory p) internal returns (bytes memory) {
        require(liquidityOf[p.key.toId()][p.owner] >= p.liquidity, "Router: insufficient liq");
        liquidityOf[p.key.toId()][p.owner] -= p.liquidity;

        BalanceDelta memory delta = poolManager.modifyLiquidity(
            p.key,
            IPoolManager.ModifyLiquidityParams({
                owner: address(this),
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                liquidityDelta: -int128(p.liquidity)
            }),
            ""
        );

        uint256 amount0 = uint256(int256(delta.amount0));
        uint256 amount1 = uint256(int256(delta.amount1));
        require(amount0 >= p.amount0Min && amount1 >= p.amount1Min, "Router: slippage");

        poolManager.take(p.key.currency0, p.recipient, amount0);
        poolManager.take(p.key.currency1, p.recipient, amount1);
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
}
