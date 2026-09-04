// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./interfaces/IUSDC.sol";

contract LMSRLiquidityVault {
    IUSDC public immutable usdc;
    address public immutable market;
    uint256 public immutable target;
    uint256 public immutable fundingDeadline;
    uint256 public totalShares;
    uint256 public totalAssets;
    bool public activated;
    bool public terminal;
    mapping(address => uint256) public shares;

    constructor(address token, address _market, uint256 fundingTarget, uint256 deadline) {
        usdc = IUSDC(token);
        market = _market;
        target = fundingTarget;
        fundingDeadline = deadline;
    }

    function fund(uint256 amount) external {
        require(!activated && !terminal && block.timestamp < fundingDeadline && amount > 0, "funding closed");
        require(usdc.transferFrom(msg.sender, address(this), amount), "transfer");
        uint256 minted = totalShares == 0 ? amount : amount * totalShares / totalAssets;
        require(minted > 0, "dust");
        shares[msg.sender] += minted;
        totalShares += minted;
        totalAssets += amount;
        if (totalAssets >= target) activated = true;
    }

    function withdraw(uint256 shareAmount) external {
        require(!activated || terminal || block.timestamp >= fundingDeadline, "locked");
        require(shareAmount > 0 && shares[msg.sender] >= shareAmount, "shares");
        uint256 amount = shareAmount * totalAssets / totalShares;
        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        totalAssets -= amount;
        require(usdc.transfer(msg.sender, amount), "transfer");
    }

    function markTerminal() external {
        require(msg.sender == market, "market");
        terminal = true;
    }
}
