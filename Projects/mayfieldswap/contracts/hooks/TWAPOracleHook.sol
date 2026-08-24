// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./EmptyHooks.sol";
import "../interfaces/IHooks.sol";
import "../interfaces/IPoolManager.sol";
import "../libraries/CurrencyLibrary.sol";
import "../types/PoolKey.sol";
import "../types/PoolId.sol";
import "../types/BalanceDelta.sol";

/// @title TWAPOracleHook
/// @notice V4 hook that maintains a 256-slot ring buffer of tick observations per pool.
///         Computes time-weighted average ticks (TWAP) via consult().
///
/// Design notes:
///   - Observations record (timestamp, tickCumulative, activeTick) after every swap and on init.
///   - tickCumulative += activeTick_prev * elapsedSeconds (Uniswap V3 compatible).
///   - The ring buffer holds up to 256 observations; oldest are overwritten first.
contract TWAPOracleHook is EmptyHooks {
    using PoolIdLibrary for PoolKey;

    IPoolManager public immutable poolManager;

    // ─── Storage ──────────────────────────────────────────────────────────────

    struct Observation {
        uint32 timestamp;       // unix timestamp
        int56  tickCumulative;  // ∑ activeTick_prev * Δt for all prior intervals
        int24  tick;            // tick at this observation (used for next cumulative calc)
        bool   initialized;
    }

    /// @dev Ring buffer: slot writeIndex[id] is the most recently written observation.
    mapping(PoolId => Observation[256]) private _obs;
    mapping(PoolId => uint8)  public writeIndex;

    event ObservationRecorded(PoolId indexed id, uint32 timestamp, int24 tick, int56 tickCumulative);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _poolManager) {
        poolManager = IPoolManager(_poolManager);
    }

    // ─── Hook callbacks ───────────────────────────────────────────────────────

    /// @dev Seeds the first observation when a pool is initialized with this hook.
    function afterInitialize(address, PoolKey calldata key, uint160, int24 tick)
        external
        override
        returns (bytes4)
    {
        _write(key.toId(), tick);
        return IHooks.afterInitialize.selector;
    }

    /// @dev Records a new observation after every swap; queries the post-swap tick from the PM.
    function afterSwap(
        address,
        PoolKey calldata key,
        bool,
        int256,
        BalanceDelta calldata
    ) external override returns (bytes4) {
        PoolId id = key.toId();
        (, int24 tick,) = poolManager.getSlot0(id);
        _write(id, tick);
        return IHooks.afterSwap.selector;
    }

    // ─── Public read interface ────────────────────────────────────────────────

    /// @notice Returns the time-weighted average tick over approximately the last `secondsAgo` seconds.
    /// @param key        The pool to query.
    /// @param secondsAgo Look-back window in seconds (must be > 0).
    /// @return arithmeticMeanTick  TWAP tick for the window.
    function consult(PoolKey calldata key, uint32 secondsAgo)
        external
        view
        returns (int24 arithmeticMeanTick)
    {
        require(secondsAgo > 0, "TWAP: zero period");
        PoolId id = key.toId();
        uint8 latestIdx = writeIndex[id];
        Observation memory latestObs = _obs[id][latestIdx];
        require(latestObs.initialized, "TWAP: no observations");

        uint32 target = uint32(block.timestamp) - secondsAgo;
        Observation memory baseObs = _findAtOrBefore(id, latestIdx, target);

        uint32 elapsed = latestObs.timestamp - baseObs.timestamp;
        require(elapsed > 0, "TWAP: window too short (mine more blocks or use larger secondsAgo)");

        int56 delta = latestObs.tickCumulative - baseObs.tickCumulative;
        arithmeticMeanTick = int24(delta / int56(uint56(elapsed)));
    }

    /// @notice Returns the raw tickCumulative stored at the observation nearest to `secondsAgo` ago.
    function observeSingle(PoolKey calldata key, uint32 secondsAgo)
        external
        view
        returns (int56 tickCumulative, int24 tick)
    {
        PoolId id = key.toId();
        uint8 latestIdx = writeIndex[id];
        if (secondsAgo == 0) {
            Observation memory o = _obs[id][latestIdx];
            return (o.tickCumulative, o.tick);
        }
        uint32 target = uint32(block.timestamp) - secondsAgo;
        Observation memory o = _findAtOrBefore(id, latestIdx, target);
        return (o.tickCumulative, o.tick);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /// @dev Appends a new observation to the ring buffer.
    ///      Uses the PREVIOUS observation's tick for the elapsed-time weighting (V3-style accuracy).
    /// @dev Max elapsed seconds used for cumulative weighting.
    ///      Prevents int56 overflow: max_tick (887272) * MAX_ELAPSED (365 days) ≈ 2.8e13, well within int56.max (3.6e16).
    int56 private constant MAX_ELAPSED = 365 days;

    function _write(PoolId id, int24 newTick) internal {
        uint8 prev = writeIndex[id];
        Observation storage last = _obs[id][prev];

        uint32 ts = uint32(block.timestamp);
        int56 cumulative;

        if (last.initialized) {
            uint32 rawElapsed = ts - last.timestamp;
            // Cap elapsed to prevent int56 overflow from long-dormant pools.
            int56 elapsed = rawElapsed > 365 days ? MAX_ELAPSED : int56(uint56(rawElapsed));
            // Weight the period since the last observation with the tick that was active then.
            cumulative = last.tickCumulative + int56(last.tick) * elapsed;
        }

        // uint8 arithmetic wraps: 255 + 1 → 0
        uint8 next = prev + 1;
        _obs[id][next] = Observation({
            timestamp: ts,
            tickCumulative: cumulative,
            tick: newTick,
            initialized: true
        });
        writeIndex[id] = next;

        emit ObservationRecorded(id, ts, newTick, cumulative);
    }

    /// @dev Walks the ring buffer backwards from `latestIdx` to find the most recent observation
    ///      whose timestamp is ≤ `target`. Falls back to the oldest available observation.
    function _findAtOrBefore(PoolId id, uint8 latestIdx, uint32 target)
        internal
        view
        returns (Observation memory result)
    {
        result = _obs[id][latestIdx]; // default: latest
        for (uint256 i = 1; i < 256; i++) {
            // uint8 subtraction wraps: 0 - 1 → 255
            Observation memory obs = _obs[id][latestIdx - uint8(i)];
            if (!obs.initialized) break;
            result = obs; // track the oldest we've found
            if (obs.timestamp <= target) return obs;
        }
        // Return oldest initialized observation if none reached target
    }
}
