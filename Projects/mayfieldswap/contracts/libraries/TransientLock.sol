// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TransientStorage.sol";

/// @title TransientLock
/// @notice Unlock/locker flags live in EIP-1153 transient storage so they cannot leak across transactions.
library TransientLock {
    using TransientStorage for bytes32;

    bytes32 internal constant UNLOCKED_SLOT = keccak256("mayfieldswap.lock.unlocked");
    bytes32 internal constant LOCKER_SLOT = keccak256("mayfieldswap.lock.locker");

    function isUnlocked() internal view returns (bool) {
        return UNLOCKED_SLOT.tload() != 0;
    }

    function locker() internal view returns (address) {
        return address(uint160(LOCKER_SLOT.tload()));
    }

    function unlock(address account) internal {
        UNLOCKED_SLOT.tstore(1);
        LOCKER_SLOT.tstore(uint256(uint160(account)));
    }

    function lock() internal {
        UNLOCKED_SLOT.tstore(0);
        LOCKER_SLOT.tstore(0);
    }
}
