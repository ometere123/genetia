// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILMSRMarket, IRiskManager} from "./interfaces/IGenetia.sol";

contract LMSRLiquidityVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable usdc;
    ILMSRMarket public immutable market;
    IRiskManager public immutable riskManager;
    address public immutable riskMarket;
    uint256 public immutable fundingTarget;
    uint256 public immutable fundingDeadline;
    uint256 public totalShares;
    uint256 public contributedAssets;
    bool public activated;
    bool public terminal;
    mapping(address => uint256) public shares;

    event Contributed(address indexed provider, uint256 assets, uint256 shares);
    event Activated(uint256 funding);
    event FailedFundingWithdrawn(address indexed provider, uint256 amount);
    event TerminalAssetsAvailable(uint256 amount);
    event TerminalWithdrawn(address indexed provider, uint256 shares, uint256 assets);

    constructor(address token, address market_, address riskManager_, uint256 target, uint256 deadline) {
        require(token != address(0) && market_ != address(0) && riskManager_ != address(0), "address");
        require(target >= 100e6 && deadline > block.timestamp, "funding");
        usdc = IERC20(token); market = ILMSRMarket(market_); riskManager = IRiskManager(riskManager_);
        riskMarket = market_; fundingTarget = target; fundingDeadline = deadline;
    }

    function contribute(uint256 amount) external nonReentrant returns (uint256 mintedShares) {
        require(!activated && !terminal && block.timestamp < fundingDeadline && amount > 0, "funding closed");
        mintedShares = amount;
        riskManager.reserveExposure(riskMarket, amount);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        shares[msg.sender] += mintedShares; totalShares += mintedShares; contributedAssets += amount;
        emit Contributed(msg.sender, amount, mintedShares);
    }

    function activate() external nonReentrant {
        require(!activated && !terminal && block.timestamp < fundingDeadline, "funding closed");
        require(contributedAssets >= fundingTarget, "target");
        activated = true;
        usdc.safeTransfer(address(market), contributedAssets);
        market.activate(contributedAssets);
        emit Activated(contributedAssets);
    }

    function withdrawFailedFunding() external nonReentrant returns (uint256 amount) {
        require(!activated && block.timestamp >= fundingDeadline, "not failed");
        amount = shares[msg.sender];
        require(amount > 0, "nothing");
        shares[msg.sender] = 0; totalShares -= amount; contributedAssets -= amount;
        riskManager.releaseExposure(riskMarket, amount);
        usdc.safeTransfer(msg.sender, amount);
        emit FailedFundingWithdrawn(msg.sender, amount);
    }

    function notifyTerminal() external {
        require(msg.sender == address(market) && activated && !terminal, "market");
        terminal = true;
        emit TerminalAssetsAvailable(usdc.balanceOf(address(this)));
    }

    function withdrawTerminal(uint256 shareAmount) external nonReentrant returns (uint256 amount) {
        require(terminal && shareAmount > 0 && shares[msg.sender] >= shareAmount, "shares");
        amount = shareAmount * usdc.balanceOf(address(this)) / totalShares;
        shares[msg.sender] -= shareAmount; totalShares -= shareAmount;
        riskManager.releaseExposure(riskMarket, amount);
        usdc.safeTransfer(msg.sender, amount);
        emit TerminalWithdrawn(msg.sender, shareAmount, amount);
    }
}
