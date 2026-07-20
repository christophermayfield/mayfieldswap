// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./FullMath.sol";
import "./SafeCast.sol";

/// @title Sqrt price math
/// @notice Functions based on Q64.96 sqrt prices for computing deltas and next prices.
library SqrtPriceMath {
    using SafeCast for uint256;

    uint256 internal constant Q96 = 0x1000000000000000000000000;

    function getNextSqrtPriceFromInput(
        uint160 sqrtPX96,
        uint128 liquidity,
        uint256 amountIn,
        bool zeroForOne
    ) internal pure returns (uint160 sqrtQX96) {
        require(sqrtPX96 > 0, "SqrtPriceMath: price");
        require(liquidity > 0, "SqrtPriceMath: liquidity");

        return zeroForOne
            ? getNextSqrtPriceFromAmount0RoundingUp(sqrtPX96, liquidity, amountIn, true)
            : getNextSqrtPriceFromAmount1RoundingDown(sqrtPX96, liquidity, amountIn, true);
    }

    function getNextSqrtPriceFromOutput(
        uint160 sqrtPX96,
        uint128 liquidity,
        uint256 amountOut,
        bool zeroForOne
    ) internal pure returns (uint160 sqrtQX96) {
        require(sqrtPX96 > 0, "SqrtPriceMath: price");
        require(liquidity > 0, "SqrtPriceMath: liquidity");

        return zeroForOne
            ? getNextSqrtPriceFromAmount1RoundingDown(sqrtPX96, liquidity, amountOut, false)
            : getNextSqrtPriceFromAmount0RoundingUp(sqrtPX96, liquidity, amountOut, false);
    }

    function getAmount0Delta(
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint128 liquidity,
        bool roundUp
    ) internal pure returns (uint256 amount0) {
        unchecked {
            if (sqrtRatioAX96 > sqrtRatioBX96) {
                (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
            }

            uint256 numerator1 = uint256(liquidity) << 96;
            uint256 numerator2 = uint256(sqrtRatioBX96) - sqrtRatioAX96;

            require(sqrtRatioAX96 > 0, "SqrtPriceMath: price");

            return roundUp
                ? unsafeDivRoundingUp(FullMath.mulDivRoundingUp(numerator1, numerator2, sqrtRatioBX96), sqrtRatioAX96)
                : FullMath.mulDiv(numerator1, numerator2, sqrtRatioBX96) / sqrtRatioAX96;
        }
    }

    function getAmount1Delta(
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint128 liquidity,
        bool roundUp
    ) internal pure returns (uint256 amount1) {
        unchecked {
            if (sqrtRatioAX96 > sqrtRatioBX96) {
                (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
            }

            return roundUp
                ? FullMath.mulDivRoundingUp(liquidity, uint256(sqrtRatioBX96) - sqrtRatioAX96, Q96)
                : FullMath.mulDiv(liquidity, uint256(sqrtRatioBX96) - sqrtRatioAX96, Q96);
        }
    }

    function getAmount0Delta(
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        int128 liquidity
    ) internal pure returns (int256 amount0) {
        return liquidity < 0
            ? -SafeCast.toInt256(
                getAmount0Delta(sqrtRatioAX96, sqrtRatioBX96, uint128(uint256(-int256(liquidity))), false)
            )
            : SafeCast.toInt256(getAmount0Delta(sqrtRatioAX96, sqrtRatioBX96, uint128(liquidity), true));
    }

    function getAmount1Delta(
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        int128 liquidity
    ) internal pure returns (int256 amount1) {
        return liquidity < 0
            ? -SafeCast.toInt256(
                getAmount1Delta(sqrtRatioAX96, sqrtRatioBX96, uint128(uint256(-int256(liquidity))), false)
            )
            : SafeCast.toInt256(getAmount1Delta(sqrtRatioAX96, sqrtRatioBX96, uint128(liquidity), true));
    }

    function getNextSqrtPriceFromAmount0RoundingUp(
        uint160 sqrtPX96,
        uint128 liquidity,
        uint256 amount,
        bool add
    ) internal pure returns (uint160) {
        unchecked {
            if (amount == 0) return sqrtPX96;
            uint256 numerator1 = uint256(liquidity) << 96;

            if (add) {
                uint256 product = amount * sqrtPX96;
                if (product / amount == sqrtPX96) {
                    uint256 denominator = numerator1 + product;
                    if (denominator >= numerator1) {
                        return FullMath.mulDivRoundingUp(numerator1, sqrtPX96, denominator).toUint160();
                    }
                }

                return unsafeDivRoundingUp(numerator1, (numerator1 / sqrtPX96) + amount).toUint160();
            } else {
                uint256 product = amount * sqrtPX96;
                require(product / amount == sqrtPX96 && numerator1 > product, "SqrtPriceMath: underflow");
                return FullMath.mulDivRoundingUp(numerator1, sqrtPX96, numerator1 - product).toUint160();
            }
        }
    }

    function getNextSqrtPriceFromAmount1RoundingDown(
        uint160 sqrtPX96,
        uint128 liquidity,
        uint256 amount,
        bool add
    ) internal pure returns (uint160) {
        unchecked {
            if (add) {
                uint256 quotient = amount <= type(uint160).max
                    ? (amount << 96) / liquidity
                    : FullMath.mulDiv(amount, Q96, liquidity);

                return (uint256(sqrtPX96) + quotient).toUint160();
            } else {
                uint256 quotient = amount <= type(uint160).max
                    ? unsafeDivRoundingUp(amount << 96, liquidity)
                    : FullMath.mulDivRoundingUp(amount, Q96, liquidity);

                require(sqrtPX96 > quotient, "SqrtPriceMath: underflow");
                return uint160(uint256(sqrtPX96) - quotient);
            }
        }
    }

    function unsafeDivRoundingUp(uint256 x, uint256 y) private pure returns (uint256 z) {
        unchecked {
            z = (x / y) + (x % y == 0 ? 0 : 1);
        }
    }
}
