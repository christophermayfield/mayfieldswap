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

    // ─── Protocol fee ─────────────────────────────────────────────────────────

    address public owner;
    /// @dev Fee in basis points deducted from every swap output (max 100 = 1%).
    uint24  public protocolFeeBps;
    address public feeRecipient;
    /// @dev Accumulated protocol fees per token, claimable by owner.
    mapping(address => uint256) public accruedFees;

    event ProtocolFeeSet(uint24 bps);
    event FeeRecipientSet(address recipient);
    event ProtocolFeesCollected(address indexed token, uint256 amount, address recipient);

    enum Action {
        Swap,
        AddLiquidity,
        RemoveLiquidity,
        CollectFees
    }

    struct SwapExactInputParams {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        uint256 amountOutMin;
        address recipient;
        address payer;
        /// @dev When false, protocol fee is not deducted (used for intermediate hops in swapExactPath).
        bool applyFee;
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

    struct CollectFeesParams {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        address recipient;
        address owner;
    }

    modifier ensure(uint256 deadline) {
        require(block.timestamp <= deadline, "Router: expired");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Router: not owner");
        _;
    }

    constructor(address _poolManager, address _weth) {
        poolManager = IPoolManager(_poolManager);
        WETH = _weth;
        owner = msg.sender;
    }

    // ─── Protocol fee admin ───────────────────────────────────────────────────

    /// @notice Set the protocol fee. Max 100 bps (1%). Set to 0 to disable.
    function setProtocolFee(uint24 bps) external onlyOwner {
        require(bps <= 100, "Router: max fee 1%");
        protocolFeeBps = bps;
        emit ProtocolFeeSet(bps);
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        require(recipient != address(0), "Router: zero recipient");
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Router: zero owner");
        owner = newOwner;
    }

    /// @notice Withdraw accumulated protocol fees to feeRecipient.
    function collectProtocolFees(address token) external onlyOwner returns (uint256 amount) {
        amount = accruedFees[token];
        require(amount > 0, "Router: no fees");
        accruedFees[token] = 0;
        TransferHelper.safeTransfer(token, feeRecipient, amount);
        emit ProtocolFeesCollected(token, amount, feeRecipient);
    }

    receive() external payable {
        require(msg.sender == WETH, "Router: WETH only");
    }

    function poolKey(address tokenA, address tokenB, uint24 fee, int24 tickSpacing, address hooks)
        public
        pure
        returns (PoolKey memory key)
    {
        (address t0, address t1) = sort(tokenA, tokenB);
        key = PoolKey({
            currency0: Currency.wrap(t0),
            currency1: Currency.wrap(t1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: hooks
        });
    }

    function defaultKey(address tokenA, address tokenB) public pure returns (PoolKey memory key) {
        return poolKey(tokenA, tokenB, DEFAULT_FEE, DEFAULT_TICK_SPACING, address(0));
    }

    function sort(address a, address b) public pure returns (address token0, address token1) {
        require(a != b && a != address(0) && b != address(0), "Router: tokens");
        (token0, token1) = a < b ? (a, b) : (b, a);
    }

    function fullRangeTicks() public pure returns (int24 tickLower, int24 tickUpper) {
        tickLower = (TickMath.MIN_TICK / DEFAULT_TICK_SPACING) * DEFAULT_TICK_SPACING;
        tickUpper = (TickMath.MAX_TICK / DEFAULT_TICK_SPACING) * DEFAULT_TICK_SPACING;
    }

    function alignTick(int24 tick, int24 spacing) public pure returns (int24) {
        require(spacing > 0, "Router: spacing");
        return (tick / spacing) * spacing;
    }

    function positionSalt(address user) public pure returns (bytes32) {
        return bytes32(uint256(uint160(user)));
    }

    function initializePool(address tokenA, address tokenB, uint160 sqrtPriceX96) external returns (int24 tick) {
        return poolManager.initialize(defaultKey(tokenA, tokenB), sqrtPriceX96);
    }

    function initializePoolKey(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick) {
        tick = poolManager.initialize(key, sqrtPriceX96);
    }

    function getPoolState(address tokenA, address tokenB)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint128 liquidity)
    {
        return poolManager.getSlot0(defaultKey(tokenA, tokenB).toId());
    }

    function swapExactTokensForTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountOut) {
        amountOut = _unlockSwap(defaultKey(tokenIn, tokenOut), tokenIn, amountIn, amountOutMin, recipient, msg.sender);
    }

    /// @notice Multi-hop exact-input swap through a sequence of default pools.
    /// @param path  Ordered token addresses: path[0] is sold, path[last] is received.
    /// @dev Protocol fee is applied once on the final hop only to prevent double-charging.
    function swapExactPath(
        address[] calldata path,
        uint256 amountIn,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountOut) {
        require(path.length >= 2, "Router: path");
        uint256 current = amountIn;
        for (uint256 i = 0; i < path.length - 1; i++) {
            bool isLast = i == path.length - 2;
            address recipient = isLast ? to : address(this);
            address payer    = i == 0   ? msg.sender : address(this);
            // Only charge the protocol fee on the final hop
            current = _unlockSwap(defaultKey(path[i], path[i + 1]), path[i], current, 0, recipient, payer, isLast);
        }
        amountOut = current;
        require(amountOut >= amountOutMin, "Router: slippage");
    }

    /// @notice Exact-input swap against an arbitrary PoolKey (fee / spacing / hooks).
    function swapExactInputOnPool(
        PoolKey memory key,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountOut) {
        amountOut = _unlockSwap(key, tokenIn, amountIn, amountOutMin, recipient, msg.sender);
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
                        payer: address(this),
                        applyFee: true
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
                        payer: msg.sender,
                        applyFee: true
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
        (int24 tickLower, int24 tickUpper) = fullRangeTicks();
        return addLiquidityWithRange(
            tokenA,
            tokenB,
            tickLower,
            tickUpper,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            recipient,
            deadline
        );
    }

    function addLiquidityWithRange(
        address tokenA,
        address tokenB,
        int24 tickLower,
        int24 tickUpper,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient,
        uint256 deadline
    ) public ensure(deadline) returns (uint256 amount0, uint256 amount1, uint128 liquidity) {
        PoolKey memory key = defaultKey(tokenA, tokenB);
        (address token0,) = sort(tokenA, tokenB);
        uint256 amount0Desired = tokenA == token0 ? amountADesired : amountBDesired;
        uint256 amount1Desired = tokenA == token0 ? amountBDesired : amountADesired;
        uint256 amount0Min_ = tokenA == token0 ? amountAMin : amountBMin;
        uint256 amount1Min_ = tokenA == token0 ? amountBMin : amountAMin;
        return _unlockAdd(key, tickLower, tickUpper, amount0Desired, amount1Desired, amount0Min_, amount1Min_, recipient);
    }

    function addLiquidityOnPool(
        PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address recipient,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amount0, uint256 amount1, uint128 liquidity) {
        return _unlockAdd(key, tickLower, tickUpper, amount0Desired, amount1Desired, amount0Min, amount1Min, recipient);
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
        (int24 tickLower, int24 tickUpper) = fullRangeTicks();
        return removeLiquidityWithRange(
            tokenA, tokenB, tickLower, tickUpper, liquidity, amountAMin, amountBMin, recipient, deadline
        );
    }

    function removeLiquidityWithRange(
        address tokenA,
        address tokenB,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient,
        uint256 deadline
    ) public ensure(deadline) returns (uint256 amount0, uint256 amount1) {
        PoolKey memory key = defaultKey(tokenA, tokenB);
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

    function getLiquidity(address tokenA, address tokenB, address owner) external view returns (uint128 liquidity) {
        (int24 tickLower, int24 tickUpper) = fullRangeTicks();
        return getLiquidityAt(tokenA, tokenB, owner, tickLower, tickUpper);
    }

    function getLiquidityAt(address tokenA, address tokenB, address owner, int24 tickLower, int24 tickUpper)
        public
        view
        returns (uint128 liquidity)
    {
        PoolKey memory key = defaultKey(tokenA, tokenB);
        (liquidity,,,,) =
            poolManager.getPosition(key.toId(), address(this), tickLower, tickUpper, positionSalt(owner));
    }

    /// @notice Uncollected LP fees including uncheckpointed fee growth (no poke required).
    function getPendingFees(address tokenA, address tokenB, address owner)
        external
        view
        returns (uint128 amount0, uint128 amount1)
    {
        (int24 tickLower, int24 tickUpper) = fullRangeTicks();
        return getPendingFeesAt(tokenA, tokenB, owner, tickLower, tickUpper);
    }

    function getPendingFeesAt(address tokenA, address tokenB, address owner, int24 tickLower, int24 tickUpper)
        public
        view
        returns (uint128 amount0, uint128 amount1)
    {
        PoolKey memory key = defaultKey(tokenA, tokenB);
        return poolManager.getPendingFees(key.toId(), address(this), tickLower, tickUpper, positionSalt(owner));
    }

    /// @notice Checkpoint fee growth and withdraw accrued LP fees for the caller.
    function collectFees(address tokenA, address tokenB, address recipient, uint256 deadline)
        external
        ensure(deadline)
        returns (uint256 amount0, uint256 amount1)
    {
        (int24 tickLower, int24 tickUpper) = fullRangeTicks();
        return collectFeesWithRange(tokenA, tokenB, tickLower, tickUpper, recipient, deadline);
    }

    function collectFeesWithRange(
        address tokenA,
        address tokenB,
        int24 tickLower,
        int24 tickUpper,
        address recipient,
        uint256 deadline
    ) public ensure(deadline) returns (uint256 amount0, uint256 amount1) {
        PoolKey memory key = defaultKey(tokenA, tokenB);
        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.CollectFees,
                abi.encode(
                    CollectFeesParams({
                        key: key,
                        tickLower: tickLower,
                        tickUpper: tickUpper,
                        recipient: recipient,
                        owner: msg.sender
                    })
                )
            )
        );
        (amount0, amount1) = abi.decode(result, (uint256, uint256));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "Router: not manager");
        (Action action, bytes memory payload) = abi.decode(data, (Action, bytes));
        if (action == Action.Swap) return _swap(abi.decode(payload, (SwapExactInputParams)));
        if (action == Action.AddLiquidity) return _add(abi.decode(payload, (AddLiquidityParams)));
        if (action == Action.RemoveLiquidity) return _remove(abi.decode(payload, (RemoveLiquidityParams)));
        if (action == Action.CollectFees) return _collect(abi.decode(payload, (CollectFeesParams)));
        revert("Router: action");
    }

    function _unlockSwap(
        PoolKey memory key,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        address payer
    ) internal returns (uint256 amountOut) {
        return _unlockSwap(key, tokenIn, amountIn, amountOutMin, recipient, payer, true);
    }

    function _unlockSwap(
        PoolKey memory key,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        address payer,
        bool applyFee
    ) internal returns (uint256 amountOut) {
        bool zeroForOne = Currency.unwrap(key.currency0) == tokenIn;
        require(zeroForOne || Currency.unwrap(key.currency1) == tokenIn, "Router: token");
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
                        payer: payer,
                        applyFee: applyFee
                    })
                )
            )
        );
        amountOut = abi.decode(result, (uint256));
    }

    function _unlockAdd(
        PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address recipient
    ) internal returns (uint256 amount0, uint256 amount1, uint128 liquidity) {
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
                        amount0Min: amount0Min,
                        amount1Min: amount1Min,
                        recipient: recipient,
                        payer: msg.sender
                    })
                )
            )
        );
        (amount0, amount1, liquidity) = abi.decode(result, (uint256, uint256, uint128));
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

        uint256 grossOut = p.zeroForOne ? uint256(int256(delta.amount1)) : uint256(int256(delta.amount0));

        // Deduct protocol fee from output before slippage check (skipped for intermediate hops).
        uint256 fee = 0;
        if (p.applyFee && protocolFeeBps > 0 && feeRecipient != address(0)) {
            fee = (grossOut * protocolFeeBps) / 10_000;
        }
        uint256 netOut = grossOut - fee;
        require(netOut >= p.amountOutMin, "Router: slippage");

        Currency input  = p.zeroForOne ? p.key.currency0 : p.key.currency1;
        Currency output = p.zeroForOne ? p.key.currency1 : p.key.currency0;
        _pay(input, p.payer, p.amountIn);

        if (fee > 0) {
            poolManager.take(output, address(this), fee);
            accruedFees[Currency.unwrap(output)] += fee;
        }
        poolManager.take(output, p.recipient, netOut);
        return abi.encode(netOut);
    }

    function _add(AddLiquidityParams memory p) internal returns (bytes memory) {
        (uint160 sqrtPriceX96,,) = poolManager.getSlot0(p.key.toId());
        uint160 sqrtA = TickMath.getSqrtRatioAtTick(p.tickLower);
        uint160 sqrtB = TickMath.getSqrtRatioAtTick(p.tickUpper);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, sqrtA, sqrtB, p.amount0Desired, p.amount1Desired
        );
        require(liquidity > 0, "Router: zero liquidity");

        bytes32 salt = positionSalt(p.recipient);
        BalanceDelta memory delta = poolManager.modifyLiquidity(
            p.key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                liquidityDelta: int128(uint128(liquidity)),
                salt: salt
            }),
            ""
        );

        uint256 amount0 = uint256(int256(-delta.amount0));
        uint256 amount1 = uint256(int256(-delta.amount1));
        require(amount0 >= p.amount0Min && amount1 >= p.amount1Min, "Router: slippage");

        // Pull any previously accrued fees sitting on the position (no-op for new LPs).
        _collectSalt(p.key, p.tickLower, p.tickUpper, salt, p.recipient);

        if (amount0 > 0) _pay(p.key.currency0, p.payer, amount0);
        if (amount1 > 0) _pay(p.key.currency1, p.payer, amount1);
        return abi.encode(amount0, amount1, liquidity);
    }

    function _remove(RemoveLiquidityParams memory p) internal returns (bytes memory) {
        bytes32 salt = positionSalt(p.owner);
        (uint128 owned,,,,) = poolManager.getPosition(p.key.toId(), address(this), p.tickLower, p.tickUpper, salt);
        require(owned >= p.liquidity, "Router: insufficient liq");

        BalanceDelta memory delta = poolManager.modifyLiquidity(
            p.key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                liquidityDelta: -int128(p.liquidity),
                salt: salt
            }),
            ""
        );

        uint256 amount0 = uint256(int256(delta.amount0));
        uint256 amount1 = uint256(int256(delta.amount1));
        require(amount0 >= p.amount0Min && amount1 >= p.amount1Min, "Router: slippage");

        if (amount0 > 0) poolManager.take(p.key.currency0, p.recipient, amount0);
        if (amount1 > 0) poolManager.take(p.key.currency1, p.recipient, amount1);

        (uint256 fee0, uint256 fee1) = _collectSalt(p.key, p.tickLower, p.tickUpper, salt, p.recipient);
        return abi.encode(amount0 + fee0, amount1 + fee1);
    }

    function _collect(CollectFeesParams memory p) internal returns (bytes memory) {
        bytes32 salt = positionSalt(p.owner);
        (uint128 liquidity,,,,) = poolManager.getPosition(p.key.toId(), address(this), p.tickLower, p.tickUpper, salt);
        require(liquidity > 0, "Router: no position");
        poolManager.modifyLiquidity(
            p.key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                liquidityDelta: 0,
                salt: salt
            }),
            ""
        );
        (uint256 amount0, uint256 amount1) = _collectSalt(p.key, p.tickLower, p.tickUpper, salt, p.recipient);
        require(amount0 > 0 || amount1 > 0, "Router: no fees");
        return abi.encode(amount0, amount1);
    }

    function _collectSalt(
        PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        bytes32 salt,
        address recipient
    ) internal returns (uint256 amount0, uint256 amount1) {
        (uint128 owed0, uint128 owed1) =
            poolManager.collect(key, tickLower, tickUpper, salt, type(uint128).max, type(uint128).max);
        amount0 = owed0;
        amount1 = owed1;
        if (amount0 > 0) poolManager.take(key.currency0, recipient, amount0);
        if (amount1 > 0) poolManager.take(key.currency1, recipient, amount1);
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
