// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./interfaces/IUSDC.sol";

contract FeeRouter {
    IUSDC public immutable usdc;
    address public immutable genetia;
    mapping(address => uint256) public creatorFees;
    mapping(address => uint256) public lpFees;

    constructor(address token, address treasury) {
        usdc = IUSDC(token);
        genetia = treasury;
    }

    function routePool(address creator, uint256 fee) external {
        require(msg.sender != address(0));
        uint256 c = fee / 10;
        require(usdc.transfer(creator, c) && usdc.transfer(genetia, fee - c), "transfer");
    }

    function routeLMSR(address creator, address vault, uint256 fee) external {
        uint256 lp = fee / 2;
        uint256 c = fee / 10;
        require(
            usdc.transfer(vault, lp) && usdc.transfer(creator, c) && usdc.transfer(genetia, fee - lp - c), "transfer"
        );
    }
}
