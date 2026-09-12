// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/// @title OutcomeTokens
/// @notice Singleton ERC-1155 holding YES/NO Arc outcome tokens for every
/// Genetia LMSR market.
///
/// Token id encodes the (marketId, outcome) pair:
/// id = marketId * 2 + outcome, where outcome is 0=NO and 1=YES.
///
/// Only registered LMSRMarket contracts may mint/burn. The factory is the only
/// address authorised to register markets, which keeps token supply tied to
/// deployed Arc markets rather than app-level records.
contract OutcomeTokens is ERC1155 {
    error NotFactory();
    error NotMarket();
    error ZeroAddress();
    error AlreadyRegistered();

    address public immutable factory;
    mapping(address => bool) public isMarket;

    event MarketRegistered(address indexed market, uint256 indexed marketId);

    constructor(address _factory) ERC1155("https://genetia.app/outcome/{id}.json") {
        if (_factory == address(0)) revert ZeroAddress();
        factory = _factory;
    }

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    modifier onlyMarket() {
        if (!isMarket[msg.sender]) revert NotMarket();
        _;
    }

    /// @notice Called by the factory immediately after deploying a new market.
    function registerMarket(address market, uint256 marketId) external onlyFactory {
        if (market == address(0)) revert ZeroAddress();
        if (isMarket[market]) revert AlreadyRegistered();
        isMarket[market] = true;
        emit MarketRegistered(market, marketId);
    }

    /// @notice Token id encoding helper. Pure, can be called off-chain too.
    function tokenIdFor(uint256 marketId, uint8 outcome) public pure returns (uint256) {
        require(outcome < 2, "outcome must be 0 (NO) or 1 (YES)");
        return marketId * 2 + outcome;
    }

    /// @notice Decode a token id back into (marketId, outcome).
    function decodeTokenId(uint256 id) external pure returns (uint256 marketId, uint8 outcome) {
        marketId = id / 2;
        outcome = uint8(id % 2);
    }

    function mint(address to, uint256 id, uint256 amount) external onlyMarket {
        _mint(to, id, amount, "");
    }

    function burn(address from, uint256 id, uint256 amount) external onlyMarket {
        _burn(from, id, amount);
    }
}
