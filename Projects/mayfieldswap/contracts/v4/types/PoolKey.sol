// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Currency.sol";

/// @notice Uniswap V4–style pool identity. Multiple pools may share a token pair.
struct PoolKey {
    Currency currency0;
    Currency currency1;
    uint24 fee;          // hundredths of a bip (e.g. 3000 = 0.30%)
    int24 tickSpacing;   // reserved for concentrated-liquidity phase
    address hooks;
}
