// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IPoolManager.sol";
import "../interfaces/IUnlockCallback.sol";
import "../types/Currency.sol";
import "../types/PoolKey.sol";
import "../types/PoolId.sol";
import "../types/BalanceDelta.sol";
import "../libraries/CurrencyLibrary.sol";
import "../libraries/LiquidityAmounts.sol";
import "../libraries/TickMath.sol";
import "../libraries/TransferHelper.sol";
import "../periphery/MayfieldRouter.sol";

/// @title PositionManager
/// @notice Educational ERC-721 wrapper for concentrated-liquidity positions (Uniswap V4 PositionManager style).
/// @dev Pool positions use `salt = bytes32(tokenId)` under this contract as locker.
contract PositionManager is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    IPoolManager public immutable poolManager;
    MayfieldRouter public immutable router;

    string public constant name = "MayfieldSwap LP";
    string public constant symbol = "MSLP";

    uint256 public nextTokenId = 1;

    struct StoredPosition {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
    }

    mapping(uint256 => address) internal _owners;
    mapping(address => uint256) internal _balanceOf;
    mapping(uint256 => StoredPosition) public positions;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    enum Action {
        Mint,
        Decrease,
        Collect
    }

    struct MintParams {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        address payer;
        uint256 tokenId;
    }

    struct DecreaseParams {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 tokenId;
        bool burnIfEmpty;
    }

    struct CollectParams {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        address recipient;
        uint256 tokenId;
    }

    modifier onlyTokenOwner(uint256 tokenId) {
        require(ownerOf(tokenId) == msg.sender, "PMgr: not owner");
        _;
    }

    constructor(address _poolManager, address _router) {
        poolManager = IPoolManager(_poolManager);
        router = MayfieldRouter(payable(_router));
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _balanceOf[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "PMgr: invalid token");
        return owner;
    }

    function positionSalt(uint256 tokenId) public pure returns (bytes32) {
        return bytes32(tokenId);
    }

    function getLiquidity(uint256 tokenId) external view returns (uint128 liquidity) {
        StoredPosition memory pos = positions[tokenId];
        (liquidity,,,,) = poolManager.getPosition(
            pos.key.toId(), address(this), pos.tickLower, pos.tickUpper, positionSalt(tokenId)
        );
    }

    function getPendingFees(uint256 tokenId) external view returns (uint128 amount0, uint128 amount1) {
        StoredPosition memory pos = positions[tokenId];
        return poolManager.getPendingFees(
            pos.key.toId(), address(this), pos.tickLower, pos.tickUpper, positionSalt(tokenId)
        );
    }

    /// @notice Mint a new NFT representing a concentrated-liquidity position on the default pool.
    function mint(
        address tokenA,
        address tokenB,
        int24 tickLower,
        int24 tickUpper,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient,
        uint256 deadline
    ) external returns (uint256 tokenId, uint128 liquidity) {
        require(block.timestamp <= deadline, "PMgr: expired");
        require(recipient != address(0), "PMgr: recipient");

        PoolKey memory key = router.defaultKey(tokenA, tokenB);
        (address token0,) = router.sort(tokenA, tokenB);
        uint256 amount0Desired = tokenA == token0 ? amountADesired : amountBDesired;
        uint256 amount1Desired = tokenA == token0 ? amountBDesired : amountADesired;
        uint256 amount0Min = tokenA == token0 ? amountAMin : amountBMin;
        uint256 amount1Min = tokenA == token0 ? amountBMin : amountAMin;

        tokenId = nextTokenId++;
        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.Mint,
                abi.encode(
                    MintParams({
                        key: key,
                        tickLower: tickLower,
                        tickUpper: tickUpper,
                        amount0Desired: amount0Desired,
                        amount1Desired: amount1Desired,
                        amount0Min: amount0Min,
                        amount1Min: amount1Min,
                        recipient: recipient,
                        payer: msg.sender,
                        tokenId: tokenId
                    })
                )
            )
        );
        (,, liquidity) = abi.decode(result, (uint256, uint256, uint128));
        positions[tokenId] = StoredPosition({key: key, tickLower: tickLower, tickUpper: tickUpper});
    }

    function decreaseLiquidity(
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0Min,
        uint256 amount1Min,
        address recipient,
        uint256 deadline
    ) external onlyTokenOwner(tokenId) returns (uint256 amount0, uint256 amount1) {
        require(block.timestamp <= deadline, "PMgr: expired");
        StoredPosition memory pos = positions[tokenId];

        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.Decrease,
                abi.encode(
                    DecreaseParams({
                        key: pos.key,
                        tickLower: pos.tickLower,
                        tickUpper: pos.tickUpper,
                        liquidity: liquidity,
                        amount0Min: amount0Min,
                        amount1Min: amount1Min,
                        recipient: recipient,
                        tokenId: tokenId,
                        burnIfEmpty: false
                    })
                )
            )
        );
        (amount0, amount1) = abi.decode(result, (uint256, uint256));
    }

    function burn(uint256 tokenId, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)
        external
        onlyTokenOwner(tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        require(block.timestamp <= deadline, "PMgr: expired");
        StoredPosition memory pos = positions[tokenId];
        uint128 liquidity = this.getLiquidity(tokenId);
        require(liquidity > 0, "PMgr: empty");

        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.Decrease,
                abi.encode(
                    DecreaseParams({
                        key: pos.key,
                        tickLower: pos.tickLower,
                        tickUpper: pos.tickUpper,
                        liquidity: liquidity,
                        amount0Min: amount0Min,
                        amount1Min: amount1Min,
                        recipient: recipient,
                        tokenId: tokenId,
                        burnIfEmpty: true
                    })
                )
            )
        );
        (amount0, amount1) = abi.decode(result, (uint256, uint256));
    }

    function collect(uint256 tokenId, address recipient, uint256 deadline)
        external
        onlyTokenOwner(tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        require(block.timestamp <= deadline, "PMgr: expired");
        StoredPosition memory pos = positions[tokenId];
        bytes memory result = poolManager.unlock(
            abi.encode(
                Action.Collect,
                abi.encode(
                    CollectParams({
                        key: pos.key,
                        tickLower: pos.tickLower,
                        tickUpper: pos.tickUpper,
                        recipient: recipient,
                        tokenId: tokenId
                    })
                )
            )
        );
        (amount0, amount1) = abi.decode(result, (uint256, uint256));
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        require(ownerOf(tokenId) == from, "PMgr: owner");
        require(to != address(0), "PMgr: zero");
        require(msg.sender == from, "PMgr: not approved");
        _transfer(from, to, tokenId);
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "PMgr: manager");
        (Action action, bytes memory payload) = abi.decode(data, (Action, bytes));
        if (action == Action.Mint) return _mint(abi.decode(payload, (MintParams)));
        if (action == Action.Decrease) return _decrease(abi.decode(payload, (DecreaseParams)));
        if (action == Action.Collect) return _collect(abi.decode(payload, (CollectParams)));
        revert("PMgr: action");
    }

    function _mint(MintParams memory p) internal returns (bytes memory) {
        (uint160 sqrtPriceX96,,) = poolManager.getSlot0(p.key.toId());
        uint160 sqrtA = TickMath.getSqrtRatioAtTick(p.tickLower);
        uint160 sqrtB = TickMath.getSqrtRatioAtTick(p.tickUpper);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, sqrtA, sqrtB, p.amount0Desired, p.amount1Desired
        );
        require(liquidity > 0, "PMgr: zero liquidity");

        bytes32 salt = positionSalt(p.tokenId);
        BalanceDelta memory delta = poolManager.modifyLiquidity(
            p.key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                liquidityDelta: int128(uint128(liquidity)),
                salt: salt
            }),
            ""
        );

        uint256 amount0 = uint256(int256(-delta.amount0));
        uint256 amount1 = uint256(int256(-delta.amount1));
        require(amount0 >= p.amount0Min && amount1 >= p.amount1Min, "PMgr: slippage");

        _collectSalt(p.key, p.tickLower, p.tickUpper, salt, p.recipient);
        if (amount0 > 0) _pay(p.key.currency0, p.payer, amount0);
        if (amount1 > 0) _pay(p.key.currency1, p.payer, amount1);

        _mintToken(p.recipient, p.tokenId);
        return abi.encode(amount0, amount1, liquidity);
    }

    function _decrease(DecreaseParams memory p) internal returns (bytes memory) {
        bytes32 salt = positionSalt(p.tokenId);
        (uint128 owned,,,,) =
            poolManager.getPosition(p.key.toId(), address(this), p.tickLower, p.tickUpper, salt);
        require(owned >= p.liquidity, "PMgr: insufficient liq");

        BalanceDelta memory delta = poolManager.modifyLiquidity(
            p.key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                liquidityDelta: -int128(p.liquidity),
                salt: salt
            }),
            ""
        );

        uint256 amount0 = uint256(int256(delta.amount0));
        uint256 amount1 = uint256(int256(delta.amount1));
        require(amount0 >= p.amount0Min && amount1 >= p.amount1Min, "PMgr: slippage");

        if (amount0 > 0) poolManager.take(p.key.currency0, p.recipient, amount0);
        if (amount1 > 0) poolManager.take(p.key.currency1, p.recipient, amount1);

        (uint256 fee0, uint256 fee1) = _collectSalt(p.key, p.tickLower, p.tickUpper, salt, p.recipient);

        if (p.burnIfEmpty) {
            require(owned == p.liquidity, "PMgr: not full");
            _burnToken(p.tokenId);
        }

        return abi.encode(amount0 + fee0, amount1 + fee1);
    }

    function _collect(CollectParams memory p) internal returns (bytes memory) {
        bytes32 salt = positionSalt(p.tokenId);
        (uint128 liquidity,,,,) =
            poolManager.getPosition(p.key.toId(), address(this), p.tickLower, p.tickUpper, salt);
        require(liquidity > 0, "PMgr: no position");
        poolManager.modifyLiquidity(
            p.key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                liquidityDelta: 0,
                salt: salt
            }),
            ""
        );
        (uint256 amount0, uint256 amount1) = _collectSalt(p.key, p.tickLower, p.tickUpper, salt, p.recipient);
        require(amount0 > 0 || amount1 > 0, "PMgr: no fees");
        return abi.encode(amount0, amount1);
    }

    function _collectSalt(
        PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        bytes32 salt,
        address recipient
    ) internal returns (uint256 amount0, uint256 amount1) {
        (uint128 owed0, uint128 owed1) =
            poolManager.collect(key, tickLower, tickUpper, salt, type(uint128).max, type(uint128).max);
        amount0 = owed0;
        amount1 = owed1;
        if (amount0 > 0) poolManager.take(key.currency0, recipient, amount0);
        if (amount1 > 0) poolManager.take(key.currency1, recipient, amount1);
    }

    function _pay(Currency currency, address payer, uint256 amount) internal {
        poolManager.sync(currency);
        TransferHelper.safeTransferFrom(Currency.unwrap(currency), payer, address(poolManager), amount);
        poolManager.settle(currency);
    }

    function _mintToken(address to, uint256 tokenId) internal {
        require(_owners[tokenId] == address(0), "PMgr: exists");
        _owners[tokenId] = to;
        _balanceOf[to]++;
        emit Transfer(address(0), to, tokenId);
    }

    function _burnToken(uint256 tokenId) internal {
        address owner = _owners[tokenId];
        require(owner != address(0), "PMgr: invalid token");
        delete positions[tokenId];
        _owners[tokenId] = address(0);
        _balanceOf[owner]--;
        emit Transfer(owner, address(0), tokenId);
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        _owners[tokenId] = to;
        _balanceOf[from]--;
        _balanceOf[to]++;
        emit Transfer(from, to, tokenId);
    }
}
