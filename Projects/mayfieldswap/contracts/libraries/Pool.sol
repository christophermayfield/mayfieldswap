// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./LiquidityMath.sol";
import "./SafeCast.sol";
import "./SqrtPriceMath.sol";
import "./SwapMath.sol";
import "./Tick.sol";
import "./TickBitmap.sol";
import "./TickMath.sol";

/// @title Position state
/// @notice Minimal position accounting for the educational pool.
library Position {
    using LiquidityMath for uint128;

    struct Info {
        uint128 liquidity;
    }

    function update(Info storage self, int128 liquidityDelta) internal {
        if (liquidityDelta == 0) return;
        self.liquidity = self.liquidity.addDelta(liquidityDelta);
    }
}

/// @title Pool
/// @notice Minimal Uniswap V3/V4-style pool state machine for educational swaps and liquidity changes.
library Pool {
    using LiquidityMath for uint128;
    using Position for Position.Info;
    using SafeCast for uint256;
    using Tick for mapping(int24 => Tick.Info);
    using TickBitmap for mapping(int16 => uint256);

    int24 internal constant TICK_SPACING = 1;

    struct Slot0 {
        uint160 sqrtPriceX96;
        int24 tick;
        bool unlocked;
    }

    struct State {
        Slot0 slot0;
        uint128 liquidity;
        mapping(int24 => Tick.Info) ticks;
        mapping(int16 => uint256) tickBitmap;
        mapping(bytes32 => Position.Info) positions;
    }

    struct ModifyPositionParams {
        address owner;
        int24 tickLower;
        int24 tickUpper;
        int128 liquidityDelta;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
        uint24 feePips;
    }

    struct SwapState {
        int256 amountSpecifiedRemaining;
        int256 amountCalculated;
        uint160 sqrtPriceX96;
        int24 tick;
        uint128 liquidity;
    }

    struct StepComputations {
        uint160 sqrtPriceStartX96;
        int24 tickNext;
        bool initialized;
        uint160 sqrtPriceNextX96;
        uint256 amountIn;
        uint256 amountOut;
        uint256 feeAmount;
    }

    function initialize(State storage self, uint160 sqrtPriceX96) internal {
        require(self.slot0.sqrtPriceX96 == 0, "Pool: already initialized");
        require(sqrtPriceX96 >= TickMath.MIN_SQRT_RATIO && sqrtPriceX96 < TickMath.MAX_SQRT_RATIO, "Pool: price");

        self.slot0 = Slot0({sqrtPriceX96: sqrtPriceX96, tick: TickMath.getTickAtSqrtRatio(sqrtPriceX96), unlocked: true});
    }

    function modifyPosition(
        State storage self,
        ModifyPositionParams memory params
    ) internal returns (int256 amount0, int256 amount1) {
        require(self.slot0.sqrtPriceX96 != 0, "Pool: uninitialized");
        checkTicks(params.tickLower, params.tickUpper);

        Position.Info storage position = self.positions[getPositionKey(params.owner, params.tickLower, params.tickUpper)];
        bool flippedLower;
        bool flippedUpper;

        if (params.liquidityDelta != 0) {
            flippedLower = self.ticks.update(
                params.tickLower,
                params.liquidityDelta,
                false,
                type(uint128).max
            );
            flippedUpper = self.ticks.update(
                params.tickUpper,
                params.liquidityDelta,
                true,
                type(uint128).max
            );

            if (flippedLower) self.tickBitmap.flipTick(params.tickLower, TICK_SPACING);
            if (flippedUpper) self.tickBitmap.flipTick(params.tickUpper, TICK_SPACING);
        }

        int24 tickCurrent = self.slot0.tick;
        if (tickCurrent < params.tickLower) {
            amount0 = SqrtPriceMath.getAmount0Delta(
                TickMath.getSqrtRatioAtTick(params.tickLower),
                TickMath.getSqrtRatioAtTick(params.tickUpper),
                params.liquidityDelta
            );
        } else if (tickCurrent < params.tickUpper) {
            amount0 = SqrtPriceMath.getAmount0Delta(
                self.slot0.sqrtPriceX96,
                TickMath.getSqrtRatioAtTick(params.tickUpper),
                params.liquidityDelta
            );
            amount1 = SqrtPriceMath.getAmount1Delta(
                TickMath.getSqrtRatioAtTick(params.tickLower),
                self.slot0.sqrtPriceX96,
                params.liquidityDelta
            );
            self.liquidity = self.liquidity.addDelta(params.liquidityDelta);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(
                TickMath.getSqrtRatioAtTick(params.tickLower),
                TickMath.getSqrtRatioAtTick(params.tickUpper),
                params.liquidityDelta
            );
        }

        position.update(params.liquidityDelta);

        if (params.liquidityDelta < 0) {
            if (flippedLower) self.ticks.clear(params.tickLower);
            if (flippedUpper) self.ticks.clear(params.tickUpper);
        }
    }

    function swap(State storage self, SwapParams memory params) internal returns (int256 amount0, int256 amount1) {
        require(params.amountSpecified != 0, "Pool: amount");
        require(self.slot0.sqrtPriceX96 != 0, "Pool: uninitialized");

        Slot0 memory slot0Start = self.slot0;

        if (params.zeroForOne) {
            require(
                params.sqrtPriceLimitX96 < slot0Start.sqrtPriceX96
                    && params.sqrtPriceLimitX96 > TickMath.MIN_SQRT_RATIO,
                "Pool: price limit"
            );
        } else {
            require(
                params.sqrtPriceLimitX96 > slot0Start.sqrtPriceX96
                    && params.sqrtPriceLimitX96 < TickMath.MAX_SQRT_RATIO,
                "Pool: price limit"
            );
        }

        bool exactInput = params.amountSpecified > 0;
        SwapState memory state = SwapState({
            amountSpecifiedRemaining: params.amountSpecified,
            amountCalculated: 0,
            sqrtPriceX96: slot0Start.sqrtPriceX96,
            tick: slot0Start.tick,
            liquidity: self.liquidity
        });

        while (state.amountSpecifiedRemaining != 0 && state.sqrtPriceX96 != params.sqrtPriceLimitX96) {
            require(state.liquidity > 0, "Pool: no liquidity");

            StepComputations memory step;
            step.sqrtPriceStartX96 = state.sqrtPriceX96;

            (step.tickNext, step.initialized) = self.tickBitmap.nextInitializedTickWithinOneWord(
                state.tick,
                TICK_SPACING,
                params.zeroForOne
            );

            if (step.tickNext < TickMath.MIN_TICK) {
                step.tickNext = TickMath.MIN_TICK;
            } else if (step.tickNext > TickMath.MAX_TICK) {
                step.tickNext = TickMath.MAX_TICK;
            }

            step.sqrtPriceNextX96 = TickMath.getSqrtRatioAtTick(step.tickNext);

            uint160 sqrtPriceTargetX96;
            if (params.zeroForOne) {
                sqrtPriceTargetX96 = step.sqrtPriceNextX96 < params.sqrtPriceLimitX96
                    ? params.sqrtPriceLimitX96
                    : step.sqrtPriceNextX96;
            } else {
                sqrtPriceTargetX96 = step.sqrtPriceNextX96 > params.sqrtPriceLimitX96
                    ? params.sqrtPriceLimitX96
                    : step.sqrtPriceNextX96;
            }

            (state.sqrtPriceX96, step.amountIn, step.amountOut, step.feeAmount) = SwapMath.computeSwapStep(
                state.sqrtPriceX96,
                sqrtPriceTargetX96,
                state.liquidity,
                state.amountSpecifiedRemaining,
                params.feePips
            );

            if (exactInput) {
                state.amountSpecifiedRemaining -= (step.amountIn + step.feeAmount).toInt256();
                state.amountCalculated -= step.amountOut.toInt256();
            } else {
                state.amountSpecifiedRemaining += step.amountOut.toInt256();
                state.amountCalculated += (step.amountIn + step.feeAmount).toInt256();
            }

            if (state.sqrtPriceX96 == step.sqrtPriceNextX96) {
                if (step.initialized) {
                    int128 liquidityNet = self.ticks.cross(step.tickNext);
                    if (params.zeroForOne) liquidityNet = -liquidityNet;
                    state.liquidity = state.liquidity.addDelta(liquidityNet);
                }

                state.tick = params.zeroForOne ? step.tickNext - 1 : step.tickNext;
            } else if (state.sqrtPriceX96 != step.sqrtPriceStartX96) {
                state.tick = TickMath.getTickAtSqrtRatio(state.sqrtPriceX96);
            }
        }

        if (state.tick != slot0Start.tick) {
            self.slot0.tick = state.tick;
        }
        if (state.sqrtPriceX96 != slot0Start.sqrtPriceX96) {
            self.slot0.sqrtPriceX96 = state.sqrtPriceX96;
        }
        if (state.liquidity != self.liquidity) {
            self.liquidity = state.liquidity;
        }

        if (params.zeroForOne == exactInput) {
            amount0 = params.amountSpecified - state.amountSpecifiedRemaining;
            amount1 = state.amountCalculated;
        } else {
            amount0 = state.amountCalculated;
            amount1 = params.amountSpecified - state.amountSpecifiedRemaining;
        }
    }

    function checkTicks(int24 tickLower, int24 tickUpper) private pure {
        require(tickLower < tickUpper, "Pool: tick order");
        require(tickLower >= TickMath.MIN_TICK, "Pool: tick lower");
        require(tickUpper <= TickMath.MAX_TICK, "Pool: tick upper");
    }

    function getPositionKey(address owner, int24 tickLower, int24 tickUpper) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(owner, tickLower, tickUpper));
    }

}
