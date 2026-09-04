// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./PoolMarket.sol";
import "./LMSRMarket.sol";

contract MarketFactory {
    address public immutable safe;
    address public immutable usdc;
    address public immutable feeRouter;
    address public immutable riskManager;
    address public immutable tokens;
    address public immutable gateway;
    uint256 public nextMarketId;
    mapping(bytes32 => address) public markets;
    event MarketCreated(bytes32 indexed id, address market, uint8 engine);

    constructor(address admin, address token, address fees, address risk, address outcomeTokens, address _gateway) {
        safe = admin;
        usdc = token;
        feeRouter = fees;
        riskManager = risk;
        tokens = outcomeTokens;
        gateway = _gateway;
    }

    function createPool(address creator, uint256 close, uint256 deadline) external returns (address market) {
        bytes32 id = keccak256(abi.encode(address(this), nextMarketId++));
        market = address(new PoolMarket(id, usdc, creator, feeRouter, riskManager, gateway, close, deadline));
        markets[id] = market;
        emit MarketCreated(id, market, 0);
    }

    function createLMSR(address creator, uint256 b, uint256 close, uint256 deadline) external returns (address market) {
        bytes32 id = keccak256(abi.encode(address(this), nextMarketId++));
        market = address(new LMSRMarket(id, usdc, tokens, feeRouter, creator, b, close, deadline));
        markets[id] = market;
        emit MarketCreated(id, market, 1);
    }
}
