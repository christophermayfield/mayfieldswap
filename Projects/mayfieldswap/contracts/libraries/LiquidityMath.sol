// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title Liquidity math
/// @notice Adds signed liquidity deltas to unsigned liquidity values.
library LiquidityMath {
    function addDelta(uint128 x, int128 y) internal pure returns (uint128 z) {
        unchecked {
            if (y < 0) {
                z = x - uint128(-y);
                require(z < x, "LiquidityMath: underflow");
            } else {
                z = x + uint128(y);
                require(z >= x, "LiquidityMath: overflow");
            }
        }
    }
}
