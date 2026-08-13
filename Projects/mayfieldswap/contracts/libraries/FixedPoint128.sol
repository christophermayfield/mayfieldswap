// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @dev Q128 fixed-point resolution used for fee growth trackers.
library FixedPoint128 {
    uint256 internal constant Q128 = 0x100000000000000000000000000000000;
}
