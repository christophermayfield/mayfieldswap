// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice EIP-1153 tload/tstore helpers (Uniswap V4–style flash accounting).
library TransientStorage {
    function tload(bytes32 slot) internal view returns (uint256 value) {
        assembly ("memory-safe") {
            value := tload(slot)
        }
    }

    function tstore(bytes32 slot, uint256 value) internal {
        assembly ("memory-safe") {
            tstore(slot, value)
        }
    }
}
