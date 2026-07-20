// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../types/Currency.sol";
import "../types/PoolKey.sol";
import "../types/PoolId.sol";

library PoolIdLibrary {
    function toId(PoolKey memory key) internal pure returns (PoolId) {
        return PoolId.wrap(keccak256(abi.encode(key)));
    }
}

library CurrencyLibrary {
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
            require(ok, "Currency: ETH_TRANSFER");
        } else {
            (bool ok, bytes memory data) =
                Currency.unwrap(currency).call(abi.encodeWithSelector(0xa9059cbb, to, amount));
            require(ok && (data.length == 0 || abi.decode(data, (bool))), "Currency: TRANSFER");
        }
    }

    function balanceOfSelf(Currency currency) internal view returns (uint256) {
        if (isNative(currency)) return address(this).balance;
        (bool ok, bytes memory data) =
            Currency.unwrap(currency).staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
        require(ok && data.length >= 32, "Currency: BALANCE");
        return abi.decode(data, (uint256));
    }
}
