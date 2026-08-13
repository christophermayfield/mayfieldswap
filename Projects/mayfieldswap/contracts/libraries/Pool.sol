// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./FixedPoint128.sol";
import "./FullMath.sol";
import "./LiquidityMath.sol";
import "./SafeCast.sol";
import "./SqrtPriceMath.sol";
import "./SwapMath.sol";
import "./Tick.sol";
import "./TickBitmap.sol";
import "./TickMath.sol";

/// @title Position state with fee growth checkpoints and tokens owed
library Position {
    using LiquidityMath for uint128;

    struct Info {
        uint128 liquidity;
        uint256 feeGrowthInside0LastX128;
        uint256 feeGrowthInside1LastX128;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    function update(
        Info storage self,
        int128 liquidityDelta,
        uint256 feeGrowthInside0X128,
        uint256 feeGrowthInside1X128
    ) internal {
        uint128 liquidity = self.liquidity;

        if (liquidityDelta == 0) {
            require(liquidity > 0, "Position: clear");
        } else {
            self.liquidity = liquidity.addDelta(liquidityDelta);
        }

        unchecked {
            uint128 tokensOwed0 = uint128(
                FullMath.mulDiv(feeGrowthInside0X128 - self.feeGrowthInside0LastX128, liquidity, FixedPoint128.Q128)
            );
            uint128 tokensOwed1 = uint128(
                FullMath.mulDiv(feeGrowthInside1X128 - self.feeGrowthInside1LastX128, liquidity, FixedPoint128.Q128)
            );

            if (tokensOwed0 > 0 || tokensOwed1 > 0) {
                self.tokensOwed0 += tokensOwed0;
                self.tokensOwed1 += tokensOwed1;
            }
        }

        self.feeGrowthInside0LastX128 = feeGrowthInside0X128;
        self.feeGrowthInside1LastX128 = feeGrowthInside1X128;
    }
}

/// @title Pool
/// @notice Uniswap V3/V4-style pool with concentrated liquidity and LP fee growth
library Pool {
    using LiquidityMath for uint128;
    using Position for Position.Info;
    using SafeCast for uint256;
    using Tick for mapping(int24 => Tick.Info);
    using TickBitmap for mapping(int16 => uint256);

    struct Slot0 {
        uint160 sqrtPriceX96;
        int24 tick;
        bool unlocked;
    }

    struct State {
        Slot0 slot0;
        uint128 liquidity;
        int24 tickSpacing;
        uint24 fee;
        uint256 feeGrowthGlobal0X128;
        uint256 feeGrowthGlobal1X128;
        mapping(int24 => Tick.Info) ticks;
        mapping(int16 => uint256) tickBitmap;
        mapping(bytes32 => Position.Info) positions;
    }

    struct ModifyPositionParams {
        address owner;
        int24 tickLower;
        int24 tickUpper;
        int128 liquidityDelta;
        bytes32 salt;
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
        uint256 feeGrowthGlobalX128;
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

    function initialize(State storage self, uint160 sqrtPriceX96, int24 tickSpacing, uint24 fee) internal {
        require(self.slot0.sqrtPriceX96 == 0, "Pool: already initialized");
        require(sqrtPriceX96 >= TickMath.MIN_SQRT_RATIO && sqrtPriceX96 < TickMath.MAX_SQRT_RATIO, "Pool: price");
        require(tickSpacing > 0, "Pool: spacing");
        require(fee < 1_000_000, "Pool: fee");

        self.tickSpacing = tickSpacing;
        self.fee = fee;
        self.slot0 = Slot0({sqrtPriceX96: sqrtPriceX96, tick: TickMath.getTickAtSqrtRatio(sqrtPriceX96), unlocked: true});
    }

    function modifyPosition(State storage self, ModifyPositionParams memory params)
        internal
        returns (int256 amount0, int256 amount1)
    {
        require(self.slot0.sqrtPriceX96 != 0, "Pool: uninitialized");
        checkTicks(params.tickLower, params.tickUpper);

        Position.Info storage position =
            self.positions[getPositionKey(params.owner, params.tickLower, params.tickUpper, params.salt)];

        (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) = self.ticks.getFeeGrowthInside(
            params.tickLower, params.tickUpper, self.slot0.tick, self.feeGrowthGlobal0X128, self.feeGrowthGlobal1X128
        );

        bool flippedLower;
        bool flippedUpper;

        if (params.liquidityDelta != 0) {
            flippedLower = self.ticks.update(
                params.tickLower,
                self.slot0.tick,
                params.liquidityDelta,
                self.feeGrowthGlobal0X128,
                self.feeGrowthGlobal1X128,
                false,
                type(uint128).max
            );
            flippedUpper = self.ticks.update(
                params.tickUpper,
                self.slot0.tick,
                params.liquidityDelta,
                self.feeGrowthGlobal0X128,
                self.feeGrowthGlobal1X128,
                true,
                type(uint128).max
            );

            if (flippedLower) self.tickBitmap.flipTick(params.tickLower, self.tickSpacing);
            if (flippedUpper) self.tickBitmap.flipTick(params.tickUpper, self.tickSpacing);
        }

        position.update(params.liquidityDelta, feeGrowthInside0X128, feeGrowthInside1X128);

        int24 tickCurrent = self.slot0.tick;
        if (tickCurrent < params.tickLower) {
            amount0 = SqrtPriceMath.getAmount0Delta(
                TickMath.getSqrtRatioAtTick(params.tickLower),
                TickMath.getSqrtRatioAtTick(params.tickUpper),
                params.liquidityDelta
            );
        } else if (tickCurrent < params.tickUpper) {
            amount0 = SqrtPriceMath.getAmount0Delta(
                self.slot0.sqrtPriceX96, TickMath.getSqrtRatioAtTick(params.tickUpper), params.liquidityDelta
            );
            amount1 = SqrtPriceMath.getAmount1Delta(
                TickMath.getSqrtRatioAtTick(params.tickLower), self.slot0.sqrtPriceX96, params.liquidityDelta
            );
            self.liquidity = self.liquidity.addDelta(params.liquidityDelta);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(
                TickMath.getSqrtRatioAtTick(params.tickLower),
                TickMath.getSqrtRatioAtTick(params.tickUpper),
                params.liquidityDelta
            );
        }

        if (params.liquidityDelta < 0) {
            if (flippedLower) self.ticks.clear(params.tickLower);
            if (flippedUpper) self.ticks.clear(params.tickUpper);
        }
    }

    function collect(
        State storage self,
        address owner,
        int24 tickLower,
        int24 tickUpper,
        bytes32 salt,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) internal returns (uint128 amount0, uint128 amount1) {
        Position.Info storage position = self.positions[getPositionKey(owner, tickLower, tickUpper, salt)];

        amount0 = amount0Requested > position.tokensOwed0 ? position.tokensOwed0 : amount0Requested;
        amount1 = amount1Requested > position.tokensOwed1 ? position.tokensOwed1 : amount1Requested;

        unchecked {
            if (amount0 > 0) position.tokensOwed0 -= amount0;
            if (amount1 > 0) position.tokensOwed1 -= amount1;
        }
    }

    function swap(State storage self, SwapParams memory params) internal returns (int256 amount0, int256 amount1) {
        require(params.amountSpecified != 0, "Pool: amount");
        require(self.slot0.sqrtPriceX96 != 0, "Pool: uninitialized");

        Slot0 memory slot0Start = self.slot0;

        if (params.zeroForOne) {
            require(
                params.sqrtPriceLimitX96 < slot0Start.sqrtPriceX96 && params.sqrtPriceLimitX96 > TickMath.MIN_SQRT_RATIO,
                "Pool: price limit"
            );
        } else {
            require(
                params.sqrtPriceLimitX96 > slot0Start.sqrtPriceX96 && params.sqrtPriceLimitX96 < TickMath.MAX_SQRT_RATIO,
                "Pool: price limit"
            );
        }

        bool exactInput = params.amountSpecified > 0;
        SwapState memory state = SwapState({
            amountSpecifiedRemaining: params.amountSpecified,
            amountCalculated: 0,
            sqrtPriceX96: slot0Start.sqrtPriceX96,
            tick: slot0Start.tick,
            liquidity: self.liquidity,
            feeGrowthGlobalX128: params.zeroForOne ? self.feeGrowthGlobal0X128 : self.feeGrowthGlobal1X128
        });

        while (state.amountSpecifiedRemaining != 0 && state.sqrtPriceX96 != params.sqrtPriceLimitX96) {
            require(state.liquidity > 0, "Pool: no liquidity");

            StepComputations memory step;
            step.sqrtPriceStartX96 = state.sqrtPriceX96;

            (step.tickNext, step.initialized) =
                self.tickBitmap.nextInitializedTickWithinOneWord(state.tick, self.tickSpacing, params.zeroForOne);

            if (step.tickNext < TickMath.MIN_TICK) {
                step.tickNext = TickMath.MIN_TICK;
            } else if (step.tickNext > TickMath.MAX_TICK) {
                step.tickNext = TickMath.MAX_TICK;
            }

            step.sqrtPriceNextX96 = TickMath.getSqrtRatioAtTick(step.tickNext);

            uint160 sqrtPriceTargetX96;
            if (params.zeroForOne) {
                sqrtPriceTargetX96 =
                    step.sqrtPriceNextX96 < params.sqrtPriceLimitX96 ? params.sqrtPriceLimitX96 : step.sqrtPriceNextX96;
            } else {
                sqrtPriceTargetX96 =
                    step.sqrtPriceNextX96 > params.sqrtPriceLimitX96 ? params.sqrtPriceLimitX96 : step.sqrtPriceNextX96;
            }

            (state.sqrtPriceX96, step.amountIn, step.amountOut, step.feeAmount) = SwapMath.computeSwapStep(
                state.sqrtPriceX96, sqrtPriceTargetX96, state.liquidity, state.amountSpecifiedRemaining, params.feePips
            );

            if (exactInput) {
                state.amountSpecifiedRemaining -= (step.amountIn + step.feeAmount).toInt256();
                state.amountCalculated -= step.amountOut.toInt256();
            } else {
                state.amountSpecifiedRemaining += step.amountOut.toInt256();
                state.amountCalculated += (step.amountIn + step.feeAmount).toInt256();
            }

            if (state.liquidity > 0) {
                unchecked {
                    state.feeGrowthGlobalX128 += FullMath.mulDiv(step.feeAmount, FixedPoint128.Q128, state.liquidity);
                }
            }

            if (state.sqrtPriceX96 == step.sqrtPriceNextX96) {
                if (step.initialized) {
                    int128 liquidityNet = self.ticks.cross(
                        step.tickNext,
                        params.zeroForOne ? state.feeGrowthGlobalX128 : self.feeGrowthGlobal0X128,
                        params.zeroForOne ? self.feeGrowthGlobal1X128 : state.feeGrowthGlobalX128
                    );
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

        if (params.zeroForOne) {
            self.feeGrowthGlobal0X128 = state.feeGrowthGlobalX128;
        } else {
            self.feeGrowthGlobal1X128 = state.feeGrowthGlobalX128;
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

    function getPositionKey(address owner, int24 tickLower, int24 tickUpper, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(owner, tickLower, tickUpper, salt));
    }

    function getPosition(State storage self, address owner, int24 tickLower, int24 tickUpper, bytes32 salt)
        internal
        view
        returns (Position.Info storage)
    {
        return self.positions[getPositionKey(owner, tickLower, tickUpper, salt)];
    }

    /// @notice Fees already checkpointed plus uncheckpointed growth since last poke.
    function getPendingFees(State storage self, address owner, int24 tickLower, int24 tickUpper, bytes32 salt)
        internal
        view
        returns (uint128 amount0, uint128 amount1)
    {
        Position.Info storage position = self.positions[getPositionKey(owner, tickLower, tickUpper, salt)];
        (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) = self.ticks.getFeeGrowthInside(
            tickLower, tickUpper, self.slot0.tick, self.feeGrowthGlobal0X128, self.feeGrowthGlobal1X128
        );

        unchecked {
            amount0 = position.tokensOwed0
                + uint128(
                    FullMath.mulDiv(
                        feeGrowthInside0X128 - position.feeGrowthInside0LastX128, position.liquidity, FixedPoint128.Q128
                    )
                );
            amount1 = position.tokensOwed1
                + uint128(
                    FullMath.mulDiv(
                        feeGrowthInside1X128 - position.feeGrowthInside1LastX128, position.liquidity, FixedPoint128.Q128
                    )
                );
        }
    }
}
