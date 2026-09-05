// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract FeeRouter is AccessControl {
    using SafeERC20 for IERC20;
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");
    bytes32 public constant MARKET_ROLE = keccak256("MARKET_ROLE");
    IERC20 public immutable usdc;
    address public immutable genetiaTreasury;
    address public factory;

    event PoolFeeRouted(address indexed market, address indexed creator, uint256 creatorAmount, uint256 genetiaAmount);
    event LMSRFeeRouted(address indexed market, address indexed vault, uint256 lpAmount, uint256 creatorAmount, uint256 genetiaAmount);

    constructor(address token, address treasury, address safe, address factory_) {
        require(token != address(0) && treasury != address(0) && safe != address(0), "address");
        usdc = IERC20(token);
        genetiaTreasury = treasury;
        _grantRole(DEFAULT_ADMIN_ROLE, safe);
        if (factory_ != address(0)) {
            factory = factory_;
            _grantRole(FACTORY_ROLE, factory_);
        }
    }

    function setFactory(address factory_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(factory_ != address(0) && factory == address(0), "factory set");
        factory = factory_;
        _grantRole(FACTORY_ROLE, factory_);
    }

    function registerMarket(address market) external onlyRole(FACTORY_ROLE) { _grantRole(MARKET_ROLE, market); }

    function routePool(address creator, uint256 fee) external onlyRole(MARKET_ROLE) {
        uint256 creatorAmount = fee / 10;
        uint256 genetiaAmount = fee - creatorAmount;
        usdc.safeTransferFrom(msg.sender, address(this), fee);
        if (creatorAmount > 0) usdc.safeTransfer(creator, creatorAmount);
        if (genetiaAmount > 0) usdc.safeTransfer(genetiaTreasury, genetiaAmount);
        emit PoolFeeRouted(msg.sender, creator, creatorAmount, genetiaAmount);
    }

    function routeLMSR(address creator, address vault, uint256 fee) external onlyRole(MARKET_ROLE) {
        uint256 lpAmount = fee / 2;
        uint256 creatorAmount = fee / 10;
        uint256 genetiaAmount = fee - lpAmount - creatorAmount;
        usdc.safeTransferFrom(msg.sender, address(this), fee);
        if (lpAmount > 0) usdc.safeTransfer(vault, lpAmount);
        if (creatorAmount > 0) usdc.safeTransfer(creator, creatorAmount);
        if (genetiaAmount > 0) usdc.safeTransfer(genetiaTreasury, genetiaAmount);
        emit LMSRFeeRouted(msg.sender, vault, lpAmount, creatorAmount, genetiaAmount);
    }

    function routeDust(uint256 amount) external onlyRole(MARKET_ROLE) {
        usdc.safeTransferFrom(msg.sender, genetiaTreasury, amount);
    }
}
