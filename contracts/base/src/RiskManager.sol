// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract RiskManager is AccessControl {
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");
    bytes32 public constant COMPONENT_ROLE = keccak256("COMPONENT_ROLE");
    uint256 public constant MARKET_CAP = 25_000e6;
    uint256 public constant SYSTEM_CAP = 250_000e6;

    bool public paused;
    address public factory;
    uint256 public systemExposure;
    mapping(address => uint256) public marketExposure;

    event ComponentRegistered(address indexed component);
    event RiskPauseSet(bool paused);
    event ExposureChanged(address indexed market, int256 delta, uint256 marketExposure, uint256 systemExposure);

    constructor(address safe, address factory_) {
        require(safe != address(0), "safe");
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

    function registerComponent(address component) external onlyRole(FACTORY_ROLE) {
        require(component != address(0), "component");
        _grantRole(COMPONENT_ROLE, component);
        emit ComponentRegistered(component);
    }

    function setPaused(bool value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = value;
        emit RiskPauseSet(value);
    }

    function reserveExposure(address market, uint256 amount) external onlyRole(COMPONENT_ROLE) {
        require(!paused, "risk paused");
        require(amount > 0 && market != address(0), "amount");
        uint256 nextMarket = marketExposure[market] + amount;
        uint256 nextSystem = systemExposure + amount;
        require(nextMarket <= MARKET_CAP, "market cap");
        require(nextSystem <= SYSTEM_CAP, "system cap");
        marketExposure[market] = nextMarket;
        systemExposure = nextSystem;
        emit ExposureChanged(market, int256(amount), nextMarket, nextSystem);
    }

    function releaseExposure(address market, uint256 amount) external onlyRole(COMPONENT_ROLE) {
        uint256 current = marketExposure[market];
        uint256 released = amount > current ? current : amount;
        marketExposure[market] = current - released;
        systemExposure -= released;
        emit ExposureChanged(market, -int256(released), current - released, systemExposure);
    }
}
