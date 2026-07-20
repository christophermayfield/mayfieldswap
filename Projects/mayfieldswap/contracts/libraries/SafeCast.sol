// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title Safe casting helpers
/// @notice Contains methods for safely casting between integer types.
library SafeCast {
    function toUint160(uint256 y) internal pure returns (uint160 z) {
        require(y <= type(uint160).max, "SafeCast: overflow");
        z = uint160(y);
    }

    function toUint128(uint256 y) internal pure returns (uint128 z) {
        require(y <= type(uint128).max, "SafeCast: overflow");
        z = uint128(y);
    }

    function toInt128(int256 y) internal pure returns (int128 z) {
        require(y >= type(int128).min && y <= type(int128).max, "SafeCast: overflow");
        z = int128(y);
    }

    function toInt256(uint256 y) internal pure returns (int256 z) {
        require(y <= uint256(type(int256).max), "SafeCast: overflow");
        z = int256(y);
    }

    function toUint256(int256 y) internal pure returns (uint256 z) {
        require(y >= 0, "SafeCast: negative");
        z = uint256(y);
    }
}
