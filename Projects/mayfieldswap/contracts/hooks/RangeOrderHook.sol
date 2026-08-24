// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./EmptyHooks.sol";
import "../interfaces/IHooks.sol";
import "../interfaces/IPoolManager.sol";
import "../libraries/CurrencyLibrary.sol";
import "../types/PoolKey.sol";
import "../types/PoolId.sol";
import "../types/BalanceDelta.sol";

/// @title RangeOrderHook
/// @notice V4 hook enabling limit-order-style range orders via one-sided concentrated liquidity.
///
/// How it works:
///   1. User adds one-sided liquidity via the router at a range entirely above (zeroForOne=true)
///      or entirely below (zeroForOne=false) the current price.
///   2. User calls placeOrder() to register the range order in this hook.
///   3. As swaps move the price through the range, the one-sided LP position is naturally
///      filled (token0 ↔ token1 conversion happens inside the pool).
///   4. The hook tracks the current tick via afterSwap. Once the price has fully crossed
///      the range, anyone can call checkAndFill() to mark the order as filled.
///   5. User removes their liquidity via the router — it's now entirely in the other token.
///
/// The hook is a registry + fill detector. It does not hold user funds.
contract RangeOrderHook is EmptyHooks {
    using PoolIdLibrary for PoolKey;

    IPoolManager public immutable poolManager;

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Order {
        address owner;
        int24   tickLower;
        int24   tickUpper;
        bool    zeroForOne; // true = selling token0, range above current price
        bool    filled;
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    /// @dev Last tick observed in this pool (updated on every swap and initialization).
    mapping(PoolId => int24) public lastTick;

    /// @dev orderId → Order
    mapping(bytes32 => Order) public orders;

    // ─── Events ───────────────────────────────────────────────────────────────

    event OrderPlaced(
        bytes32 indexed orderId,
        address indexed owner,
        PoolId  indexed poolId,
        int24 tickLower,
        int24 tickUpper,
        bool  zeroForOne
    );

    event OrderFilled(
        bytes32 indexed orderId,
        PoolId  indexed poolId,
        int24 tick
    );

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _poolManager) {
        poolManager = IPoolManager(_poolManager);
    }

    // ─── Hook callbacks ───────────────────────────────────────────────────────

    function afterInitialize(address, PoolKey calldata key, uint160, int24 tick)
        external
        override
        returns (bytes4)
    {
        lastTick[key.toId()] = tick;
        return IHooks.afterInitialize.selector;
    }

    /// @dev After each swap, update lastTick so checkAndFill can determine fill status.
    function afterSwap(
        address,
        PoolKey calldata key,
        bool,
        int256,
        BalanceDelta calldata
    ) external override returns (bytes4) {
        PoolId id = key.toId();
        (, int24 tick,) = poolManager.getSlot0(id);
        lastTick[id] = tick;
        return IHooks.afterSwap.selector;
    }

    // ─── Order management ─────────────────────────────────────────────────────

    /// @notice Register a range order for caller's existing one-sided LP position.
    ///
    /// The caller must have already added one-sided liquidity to the pool via the router
    /// before calling this function. This hook only stores metadata — it does not move funds.
    ///
    /// @param key        Pool key (must have hooks == address(this)).
    /// @param tickLower  Lower tick of the LP range.
    /// @param tickUpper  Upper tick of the LP range.
    /// @param zeroForOne true  → selling token0 (range must be entirely above current tick).
    ///                   false → selling token1 (range must be entirely below current tick).
    /// @return orderId   Unique identifier for this order.
    function placeOrder(
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        bool  zeroForOne
    ) external returns (bytes32 orderId) {
        require(tickLower < tickUpper, "RO: invalid range");

        PoolId id = key.toId();
        int24 current = lastTick[id];

        if (zeroForOne) {
            // Range must be STRICTLY above current price so the order doesn't start filling immediately.
            require(tickLower > current, "RO: range must be above current price");
        } else {
            // Range must be STRICTLY below current price.
            require(tickUpper < current, "RO: range must be below current price");
        }

        orderId = keccak256(abi.encode(msg.sender, id, tickLower, tickUpper, zeroForOne));
        require(orders[orderId].owner == address(0), "RO: order already exists");

        orders[orderId] = Order({
            owner:      msg.sender,
            tickLower:  tickLower,
            tickUpper:  tickUpper,
            zeroForOne: zeroForOne,
            filled:     false
        });

        emit OrderPlaced(orderId, msg.sender, id, tickLower, tickUpper, zeroForOne);
    }

    /// @notice Mark an order as filled if the pool's current tick has fully crossed its range.
    ///         Anyone can call this — the order owner can then remove their liquidity from the pool.
    function checkAndFill(bytes32 orderId, PoolKey calldata key) external {
        Order storage order = orders[orderId];
        require(order.owner != address(0), "RO: order not found");
        require(!order.filled,             "RO: already filled");

        PoolId id = key.toId();
        int24 current = lastTick[id];

        bool filled;
        if (order.zeroForOne) {
            // Price moved up through the full range → position is now 100% token1
            filled = current >= order.tickUpper;
        } else {
            // Price moved down through the full range → position is now 100% token0
            filled = current <= order.tickLower;
        }

        require(filled, "RO: order not yet filled");
        order.filled = true;
        emit OrderFilled(orderId, id, current);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    function isOrderFilled(bytes32 orderId) external view returns (bool) {
        return orders[orderId].filled;
    }

    function getOrder(bytes32 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    /// @notice Compute the orderId for a given owner + range (off-chain helper).
    function computeOrderId(
        address owner,
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        bool  zeroForOne
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(owner, key.toId(), tickLower, tickUpper, zeroForOne));
    }
}
