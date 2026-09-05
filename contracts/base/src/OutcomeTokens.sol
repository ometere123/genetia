// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract OutcomeTokens is ERC1155, AccessControl {
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");
    bytes32 public constant MARKET_ROLE = keccak256("MARKET_ROLE");
    address public factory;
    mapping(address => bytes32) public marketIds;

    constructor(address safe, address factory_) ERC1155("") {
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

    function registerMarket(address market, bytes32 marketId) external onlyRole(FACTORY_ROLE) {
        require(market != address(0) && marketId != bytes32(0) && marketIds[market] == bytes32(0), "market binding");
        marketIds[market] = marketId;
        _grantRole(MARKET_ROLE, market);
    }

    function tokenIdFor(bytes32 marketId, uint8 outcome) public pure returns (uint256) {
        require(outcome < 2, "outcome");
        return uint256(keccak256(abi.encode(marketId, outcome)));
    }

    function mint(address to, uint256 id, uint256 amount) external onlyRole(MARKET_ROLE) {
        bytes32 marketId = marketIds[msg.sender];
        require(id == tokenIdFor(marketId, 0) || id == tokenIdFor(marketId, 1), "wrong market token");
        _mint(to, id, amount, "");
    }
    function burn(address from, uint256 id, uint256 amount) external onlyRole(MARKET_ROLE) {
        bytes32 marketId = marketIds[msg.sender];
        require(id == tokenIdFor(marketId, 0) || id == tokenIdFor(marketId, 1), "wrong market token");
        _burn(from, id, amount);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
