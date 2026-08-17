// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../types/Currency.sol";
import "./TransientStorage.sol";

/// @title TransientDelta
/// @notice Per-currency flash-accounting deltas and synced reserves in EIP-1153 transient storage.
/// @dev Official v4-core keys deltas by (caller, currency). This educational pool has a single locker, so slots are currency-only.
library TransientDelta {
    using TransientStorage for bytes32;

    bytes32 internal constant NONZERO_SLOT = keccak256("mayfieldswap.delta.nonzero");
    bytes32 internal constant DELTA_SEED = keccak256("mayfieldswap.delta.currency");
    bytes32 internal constant SYNC_SEED = keccak256("mayfieldswap.delta.sync");

    function deltaSlot(Currency currency) internal pure returns (bytes32) {
        return keccak256(abi.encode(DELTA_SEED, currency));
    }

    function syncSlot(Currency currency) internal pure returns (bytes32) {
        return keccak256(abi.encode(SYNC_SEED, currency));
    }

    function get(Currency currency) internal view returns (int256) {
        return int256(deltaSlot(currency).tload());
    }

    function nonzeroCount() internal view returns (uint256) {
        return NONZERO_SLOT.tload();
    }

    function getSynced(Currency currency) internal view returns (uint256) {
        return syncSlot(currency).tload();
    }

    function setSynced(Currency currency, uint256 balance) internal {
        syncSlot(currency).tstore(balance);
    }

    function account(Currency currency, int256 delta) internal {
        if (delta == 0) return;
        bytes32 slot = deltaSlot(currency);
        int256 prev = int256(slot.tload());
        int256 next = prev + delta;
        unchecked {
            uint256 count = NONZERO_SLOT.tload();
            if (prev == 0 && next != 0) NONZERO_SLOT.tstore(count + 1);
            else if (prev != 0 && next == 0) NONZERO_SLOT.tstore(count - 1);
        }
        slot.tstore(uint256(next));
    }
}
