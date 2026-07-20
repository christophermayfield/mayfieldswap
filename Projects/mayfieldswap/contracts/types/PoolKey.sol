// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Currency.sol";

struct PoolKey {
    Currency currency0;
    Currency currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}
