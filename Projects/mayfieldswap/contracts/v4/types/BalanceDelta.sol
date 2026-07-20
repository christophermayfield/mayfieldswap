// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Signed token amounts for a pool operation (currency0 / currency1).
struct BalanceDelta {
    int128 amount0;
    int128 amount1;
}
