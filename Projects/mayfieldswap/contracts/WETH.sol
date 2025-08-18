// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/IWETH.sol";
import "./interfaces/IERC20.sol";

contract WETH is IERC20, IWETH {
    string public constant name = "Wrapped Ether";
    string public constant symbol = "WETH";
    uint8 public constant decimals = 18;

    mapping(address => uint) public balanceOf;
    mapping(address => mapping(address => uint)) public allowance;

    uint public totalSupply;

    // Approval and Transfer events inherited from IERC20
    event Deposit(address indexed dst, uint wad);
    event Withdrawal(address indexed src, uint wad);

    receive() external payable {
        deposit();
    }

    function deposit() public payable override {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint wad) public override {
        require(balanceOf[msg.sender] >= wad, "WETH: INSUFFICIENT_BALANCE");
        balanceOf[msg.sender] -= wad;
        totalSupply -= wad;
        payable(msg.sender).transfer(wad);
        emit Withdrawal(msg.sender, wad);
    }

    function approve(address guy, uint wad) public override returns (bool) {
        allowance[msg.sender][guy] = wad;
        emit Approval(msg.sender, guy, wad);
        return true;
    }

    function transfer(address dst, uint wad) public override(IERC20, IWETH) returns (bool) {
        return transferFrom(msg.sender, dst, wad);
    }

    function transferFrom(address src, address dst, uint wad) public override returns (bool) {
        require(balanceOf[src] >= wad, "WETH: INSUFFICIENT_BALANCE");

        if (src != msg.sender && allowance[src][msg.sender] != type(uint).max) {
            require(allowance[src][msg.sender] >= wad, "WETH: INSUFFICIENT_ALLOWANCE");
            allowance[src][msg.sender] -= wad;
        }

        balanceOf[src] -= wad;
        balanceOf[dst] += wad;

        emit Transfer(src, dst, wad);

        return true;
    }
}
