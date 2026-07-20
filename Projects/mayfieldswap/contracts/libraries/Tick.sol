// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./LiquidityMath.sol";

/// @title Tick state
/// @notice Tracks liquidity gross/net at initialized ticks. Fee growth is intentionally omitted for this educational pool.
library Tick {
    struct Info {
        uint128 liquidityGross;
        int128 liquidityNet;
    }

    function update(
        mapping(int24 => Info) storage self,
        int24 tick,
        int128 liquidityDelta,
        bool upper,
        uint128 maxLiquidity
    ) internal returns (bool flipped) {
        Info storage info = self[tick];

        uint128 liquidityGrossBefore = info.liquidityGross;
        uint128 liquidityGrossAfter = LiquidityMath.addDelta(liquidityGrossBefore, liquidityDelta);

        require(liquidityGrossAfter <= maxLiquidity, "Tick: max liquidity");

        flipped = (liquidityGrossAfter == 0) != (liquidityGrossBefore == 0);
        info.liquidityGross = liquidityGrossAfter;

        info.liquidityNet = upper ? info.liquidityNet - liquidityDelta : info.liquidityNet + liquidityDelta;
    }

    function cross(mapping(int24 => Info) storage self, int24 tick) internal view returns (int128 liquidityNet) {
        liquidityNet = self[tick].liquidityNet;
    }

    function clear(mapping(int24 => Info) storage self, int24 tick) internal {
        delete self[tick];
    }

    function getFeeGrowthInside(
        mapping(int24 => Info) storage self,
        int24 tickLower,
        int24 tickUpper,
        int24 tickCurrent,
        uint256 feeGrowthGlobal0X128,
        uint256 feeGrowthGlobal1X128
    ) internal pure returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) {
        self;
        tickLower;
        tickUpper;
        tickCurrent;
        feeGrowthGlobal0X128;
        feeGrowthGlobal1X128;

        feeGrowthInside0X128 = 0;
        feeGrowthInside1X128 = 0;
    }
}
