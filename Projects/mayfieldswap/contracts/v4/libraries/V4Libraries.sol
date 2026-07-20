// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../types/Currency.sol";
import "../types/PoolKey.sol";
import "../types/PoolId.sol";

library PoolIdLibrary {
    function toId(PoolKey memory key) internal pure returns (PoolId id) {
        id = PoolId.wrap(keccak256(abi.encode(key)));
    }
}

library CurrencyLibrary {
    Currency public constant NATIVE = Currency.wrap(address(0));

    function toAddress(Currency currency) internal pure returns (address) {
        return Currency.unwrap(currency);
    }

    function isNative(Currency currency) internal pure returns (bool) {
        return Currency.unwrap(currency) == address(0);
    }

    function transfer(Currency currency, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (isNative(currency)) {
            (bool ok,) = to.call{value: amount}("");
            require(ok, "Currency: ETH_TRANSFER_FAILED");
        } else {
            (bool ok, bytes memory data) = Currency.unwrap(currency).call(
                abi.encodeWithSelector(0xa9059cbb, to, amount) // transfer(address,uint256)
            );
            require(ok && (data.length == 0 || abi.decode(data, (bool))), "Currency: TRANSFER_FAILED");
        }
    }

    function balanceOf(Currency currency, address owner) internal view returns (uint256) {
        if (isNative(currency)) {
            return owner.balance;
        }
        (bool ok, bytes memory data) =
            Currency.unwrap(currency).staticcall(abi.encodeWithSelector(0x70a08231, owner)); // balanceOf
        require(ok && data.length >= 32, "Currency: BALANCE_FAILED");
        return abi.decode(data, (uint256));
    }
}

/// @dev Constant-product helpers (Phase 1 stand-in for concentrated liquidity).
library CPMM {
    uint256 internal constant FEE_DENOMINATOR = 1_000_000;

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut, uint24 fee)
        internal
        pure
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "CPMM: INSUFFICIENT_INPUT");
        require(reserveIn > 0 && reserveOut > 0, "CPMM: INSUFFICIENT_LIQUIDITY");
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - fee);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) internal pure returns (uint256 amountB) {
        require(amountA > 0, "CPMM: INSUFFICIENT_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "CPMM: INSUFFICIENT_LIQUIDITY");
        amountB = (amountA * reserveB) / reserveA;
    }
}
