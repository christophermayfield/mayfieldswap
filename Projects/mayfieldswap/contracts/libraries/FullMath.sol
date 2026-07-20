// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title Full precision math
/// @notice Facilitates multiplication and division that can have overflow of an intermediate value without any loss of precision.
library FullMath {
    /// @notice Calculates floor(a * b / denominator) with full precision.
    /// @dev Throws if result overflows a uint256 or denominator == 0.
    function mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            uint256 prod0;
            uint256 prod1;
            assembly {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }

            if (prod1 == 0) {
                require(denominator > 0, "FullMath: DIV_BY_ZERO");
                return prod0 / denominator;
            }

            require(denominator > prod1, "FullMath: overflow");

            uint256 remainder;
            assembly {
                remainder := mulmod(a, b, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }

            uint256 twos = denominator & (~denominator + 1);
            assembly {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }

            prod0 |= prod1 * twos;

            uint256 inv = (3 * denominator) ^ 2;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;

            result = prod0 * inv;
        }
    }

    /// @notice Calculates ceil(a * b / denominator) with full precision.
    /// @dev Throws if result overflows a uint256 or denominator == 0.
    function mulDivRoundingUp(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            result = mulDiv(a, b, denominator);
            if (mulmod(a, b, denominator) > 0) {
                require(result < type(uint256).max, "FullMath: overflow");
                result++;
            }
        }
    }
}
