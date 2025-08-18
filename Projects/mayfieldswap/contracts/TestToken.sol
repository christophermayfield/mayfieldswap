// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/IERC20.sol";

contract TestToken is IERC20 {
    mapping(address => uint) public override balanceOf;
    mapping(address => mapping(address => uint)) public override allowance;

    uint public override totalSupply;
    string public override name;
    string public override symbol;
    uint8 public override decimals;

    // Events inherited from IERC20

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint _totalSupply
    ) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        totalSupply = _totalSupply;
        balanceOf[msg.sender] = _totalSupply;
        emit Transfer(address(0), msg.sender, _totalSupply);
    }

    function approve(address spender, uint value) external override returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint value) external override returns (bool) {
        require(balanceOf[msg.sender] >= value, "TestToken: INSUFFICIENT_BALANCE");
        balanceOf[msg.sender] = balanceOf[msg.sender] - value;
        balanceOf[to] = balanceOf[to] + value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint value) external override returns (bool) {
        require(balanceOf[from] >= value, "TestToken: INSUFFICIENT_BALANCE");
        require(allowance[from][msg.sender] >= value, "TestToken: INSUFFICIENT_ALLOWANCE");
        
        balanceOf[from] = balanceOf[from] - value;
        balanceOf[to] = balanceOf[to] + value;
        allowance[from][msg.sender] = allowance[from][msg.sender] - value;
        
        emit Transfer(from, to, value);
        return true;
    }

    // Mint function for testing purposes
    function mint(address to, uint value) external {
        totalSupply = totalSupply + value;
        balanceOf[to] = balanceOf[to] + value;
        emit Transfer(address(0), to, value);
    }
}
