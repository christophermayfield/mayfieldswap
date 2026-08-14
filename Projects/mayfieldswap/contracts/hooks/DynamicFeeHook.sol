// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./EmptyHooks.sol";
import "../types/PoolKey.sol";

/// @title DynamicFeeHook
/// @notice Educational V4 hook: overrides the pool swap fee via `getSwapFee`.
contract DynamicFeeHook is EmptyHooks {
    uint24 public feePips;
    address public owner;

    event FeeSet(uint24 feePips);

    constructor(uint24 _feePips) {
        require(_feePips > 0 && _feePips < 1_000_000, "DynamicFee: fee");
        feePips = _feePips;
        owner = msg.sender;
    }

    function setFee(uint24 _feePips) external {
        require(msg.sender == owner, "DynamicFee: owner");
        require(_feePips > 0 && _feePips < 1_000_000, "DynamicFee: fee");
        feePips = _feePips;
        emit FeeSet(_feePips);
    }

    function getSwapFee(PoolKey calldata) external view override returns (uint24) {
        return feePips;
    }
}
