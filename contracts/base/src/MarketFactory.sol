// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {PoolMarket} from "./PoolMarket.sol";
import {LMSRMarket} from "./LMSRMarket.sol";
import {LMSRLiquidityVault} from "./LMSRLiquidityVault.sol";
import {IOutcomeTokens, IFeeRouter, IRiskManager, IResolutionGateway} from "./interfaces/IGenetia.sol";

interface IProtocolRegistry {
    function isActive(bytes32 releaseId) external view returns (bool);
}

contract MarketFactory is AccessControl {
    bytes32 public constant MARKET_CREATOR_ROLE = keccak256("MARKET_CREATOR_ROLE");

    struct MarketTerms {
        bytes32 marketId;
        bytes32 financialReleaseId;
        bytes32 resolverReleaseId;
        bytes32 manifestHash;
        address resolver;
        address creator;
        uint256 closeTime;
        uint256 resolutionAvailableTime;
        uint256 terminalDeadline;
    }

    address public immutable usdc;
    IProtocolRegistry public immutable registry;
    IOutcomeTokens public immutable outcomeTokens;
    IFeeRouter public immutable feeRouter;
    IRiskManager public immutable riskManager;
    IResolutionGateway public immutable gateway;
    mapping(bytes32 => address) public markets;

    event PoolCreated(bytes32 indexed marketId, address indexed market, bytes32 indexed releaseId);
    event LMSRCreated(bytes32 indexed marketId, address indexed market, address indexed vault, bytes32 releaseId, uint256 b);

    constructor(
        address safe,
        address token,
        address registry_,
        address outcomeTokens_,
        address feeRouter_,
        address riskManager_,
        address gateway_
    ) {
        require(
            safe != address(0) && token != address(0) && registry_ != address(0) && outcomeTokens_ != address(0)
                && feeRouter_ != address(0) && riskManager_ != address(0) && gateway_ != address(0),
            "address"
        );
        _grantRole(DEFAULT_ADMIN_ROLE, safe);
        _grantRole(MARKET_CREATOR_ROLE, safe);
        usdc = token;
        registry = IProtocolRegistry(registry_);
        outcomeTokens = IOutcomeTokens(outcomeTokens_);
        feeRouter = IFeeRouter(feeRouter_);
        riskManager = IRiskManager(riskManager_);
        gateway = IResolutionGateway(gateway_);
    }

    function createPool(MarketTerms calldata terms) external onlyRole(MARKET_CREATOR_ROLE) returns (address market) {
        _validate(terms);
        PoolMarket instance = new PoolMarket(
            terms.marketId,
            terms.financialReleaseId,
            usdc,
            terms.creator,
            address(feeRouter),
            address(riskManager),
            address(gateway),
            terms.manifestHash,
            terms.resolver,
            terms.closeTime,
            terms.resolutionAvailableTime,
            terms.terminalDeadline
        );
        market = address(instance);
        markets[terms.marketId] = market;
        _register(terms, market);
        emit PoolCreated(terms.marketId, market, terms.financialReleaseId);
    }

    function createLMSR(MarketTerms calldata terms, uint256 b, uint256 fundingDeadline)
        external
        onlyRole(MARKET_CREATOR_ROLE)
        returns (address market, address vault)
    {
        _validate(terms);
        require(fundingDeadline > block.timestamp && fundingDeadline <= terms.closeTime, "funding deadline");
        LMSRMarket instance = new LMSRMarket(
            terms.marketId,
            terms.financialReleaseId,
            usdc,
            address(outcomeTokens),
            address(feeRouter),
            address(riskManager),
            address(gateway),
            terms.creator,
            terms.manifestHash,
            terms.resolver,
            b,
            terms.closeTime,
            terms.resolutionAvailableTime,
            terms.terminalDeadline
        );
        market = address(instance);
        LMSRLiquidityVault vaultInstance = new LMSRLiquidityVault(
            usdc, market, address(riskManager), instance.fundingTarget(), fundingDeadline
        );
        vault = address(vaultInstance);
        instance.bindVault(vault);
        markets[terms.marketId] = market;
        outcomeTokens.registerMarket(market);
        _register(terms, market);
        riskManager.registerComponent(vault);
        emit LMSRCreated(terms.marketId, market, vault, terms.financialReleaseId, b);
    }

    function _validate(MarketTerms calldata terms) internal view {
        require(markets[terms.marketId] == address(0) && terms.marketId != bytes32(0), "market exists");
        require(registry.isActive(terms.financialReleaseId), "release inactive");
        require(
            terms.creator != address(0) && terms.resolver != address(0) && terms.manifestHash != bytes32(0)
                && terms.resolverReleaseId != bytes32(0),
            "terms"
        );
        require(
            terms.closeTime > block.timestamp && terms.resolutionAvailableTime >= terms.closeTime
                && terms.terminalDeadline == terms.resolutionAvailableTime + 96 hours,
            "time"
        );
    }

    function _register(MarketTerms calldata terms, address market) internal {
        feeRouter.registerMarket(market);
        riskManager.registerComponent(market);
        gateway.registerMarket(
            market,
            terms.marketId,
            terms.resolver,
            terms.manifestHash,
            terms.resolverReleaseId,
            terms.terminalDeadline
        );
    }
}
