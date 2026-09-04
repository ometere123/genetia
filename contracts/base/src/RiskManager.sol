// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/access/AccessControl.sol";

contract RiskManager is AccessControl {
    bytes32 public constant COMPONENT_ROLE = keccak256("COMPONENT_ROLE");
    uint256 public constant MARKET_CAP = 25_000e6;
    uint256 public constant SYSTEM_CAP = 250_000e6;
    uint256 public systemExposure;
    mapping(address => uint256) public marketExposure;
    mapping(address => bool) public registered;

    constructor(address safe) {
        _grantRole(DEFAULT_ADMIN_ROLE, safe);
    }

    function registerComponent(address c) external onlyRole(DEFAULT_ADMIN_ROLE) {
        registered[c] = true;
        _grantRole(COMPONENT_ROLE, c);
    }

    function reserveExposure(address market, uint256 amount) external onlyRole(COMPONENT_ROLE) {
        require(registered[msg.sender], "component");
        require(marketExposure[market] + amount <= MARKET_CAP && systemExposure + amount <= SYSTEM_CAP, "risk cap");
        marketExposure[market] += amount;
        systemExposure += amount;
    }

    function releaseExposure(address market, uint256 amount) external onlyRole(COMPONENT_ROLE) {
        uint256 m = marketExposure[market];
        uint256 r = amount > m ? m : amount;
        marketExposure[market] = m - r;
        systemExposure -= r;
    }
}
