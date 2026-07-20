// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @dev Address wrapper used throughout V4-style accounting. address(0) = native ETH.
type Currency is address;
