// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IOutcomeTokens, IFeeRouter, IRiskManager, IResolutionGateway} from "./interfaces/IGenetia.sol";

interface IProtocolRegistry {
    function isActive(bytes32 releaseId) external view returns (bool);
    function releases(bytes32 releaseId) external view returns (address implementation, bytes32 bytecodeHash, bytes32 commitSha, bool active);
}

interface IPoolReleaseDeployer {
    struct PoolArgs { bytes32 marketId; bytes32 releaseId; address token; address creator; address feeRouter; address riskManager; address gateway; bytes32 manifestHash; address resolver; uint256 closeTime; uint256 resolutionAvailableTime; uint256 terminalDeadline; bytes32 salt; }
    function predictPool(PoolArgs calldata) external view returns (address);
    function deployPool(bytes32, bytes32, address, address, address, address, address, bytes32, address, uint256, uint256, uint256, bytes32) external returns (address);
}
interface ILMSRReleaseDeployer {
    struct LMSRArgs { bytes32 marketId; bytes32 releaseId; address token; address outcomeTokens; address feeRouter; address riskManager; address gateway; address creator; bytes32 manifestHash; address resolver; uint256 b; uint256 closeTime; uint256 resolutionAvailableTime; uint256 terminalDeadline; uint256 fundingDeadline; bytes32 marketSalt; bytes32 vaultSalt; }
    function predictLMSR(LMSRArgs calldata) external view returns (address, address);
    function deployLMSR(bytes32, bytes32, address, address, address, address, address, address, bytes32, address, uint256, uint256, uint256, uint256, uint256, bytes32, bytes32) external returns (address, address);
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
        (address implementation,,,) = registry.releases(terms.financialReleaseId);
        require(implementation.code.length > 0, "release deployer");
        market = IPoolReleaseDeployer(implementation).deployPool(
            terms.marketId, terms.financialReleaseId, usdc, terms.creator, address(feeRouter), address(riskManager),
            address(gateway), terms.manifestHash, terms.resolver, terms.closeTime, terms.resolutionAvailableTime,
            terms.terminalDeadline, _salt(terms)
        );
        markets[terms.marketId] = market;
        _register(terms, market);
        emit PoolCreated(terms.marketId, market, terms.financialReleaseId);
    }

    function predictPoolAddress(MarketTerms calldata terms) external view returns (address) {
        (address implementation,,,) = registry.releases(terms.financialReleaseId);
        IPoolReleaseDeployer.PoolArgs memory a = IPoolReleaseDeployer.PoolArgs(terms.marketId, terms.financialReleaseId, usdc, terms.creator, address(feeRouter), address(riskManager), address(gateway), terms.manifestHash, terms.resolver, terms.closeTime, terms.resolutionAvailableTime, terms.terminalDeadline, _salt(terms));
        return IPoolReleaseDeployer(implementation).predictPool(a);
    }

    function predictLMSRAddresses(MarketTerms calldata terms, uint256 b, uint256 fundingDeadline) external view returns (address market, address vault) {
        (address implementation,,,) = registry.releases(terms.financialReleaseId);
        ILMSRReleaseDeployer.LMSRArgs memory a = ILMSRReleaseDeployer.LMSRArgs(terms.marketId, terms.financialReleaseId, usdc, address(outcomeTokens), address(feeRouter), address(riskManager), address(gateway), terms.creator, terms.manifestHash, terms.resolver, b, terms.closeTime, terms.resolutionAvailableTime, terms.terminalDeadline, fundingDeadline, _lmsrMarketSalt(terms), _vaultSalt(terms));
        return ILMSRReleaseDeployer(implementation).predictLMSR(a);
    }

    function createLMSR(MarketTerms calldata terms, uint256 b, uint256 fundingDeadline)
        external
        onlyRole(MARKET_CREATOR_ROLE)
        returns (address market, address vault)
    {
        _validate(terms);
        require(fundingDeadline > block.timestamp && fundingDeadline <= terms.closeTime, "funding deadline");
        (address implementation,,,) = registry.releases(terms.financialReleaseId);
        require(implementation.code.length > 0, "release deployer");
        (market, vault) = ILMSRReleaseDeployer(implementation).deployLMSR(
            terms.marketId, terms.financialReleaseId, usdc, address(outcomeTokens), address(feeRouter), address(riskManager),
            address(gateway), terms.creator, terms.manifestHash, terms.resolver, b, terms.closeTime,
            terms.resolutionAvailableTime, terms.terminalDeadline, fundingDeadline, _lmsrMarketSalt(terms), _vaultSalt(terms)
        );
        markets[terms.marketId] = market;
        outcomeTokens.registerMarket(market, terms.marketId);
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

    function _salt(MarketTerms calldata terms) internal pure returns (bytes32) {
        // The manifest commits to the predicted Base address. Including the
        // manifest hash in this CREATE2 salt makes that prediction circular.
        return keccak256(abi.encode("GENETIA_MARKET", terms.marketId, terms.financialReleaseId));
    }
    function _lmsrMarketSalt(MarketTerms calldata terms) internal pure returns (bytes32) { return _salt(terms); }
    function _vaultSalt(MarketTerms calldata terms) internal pure returns (bytes32) { return keccak256(abi.encode("GENETIA_VAULT", terms.marketId, terms.financialReleaseId)); }
    function _fundingTarget(uint256 b) internal pure returns (uint256) {
        uint256 target = (b * 693147180559945309 * 110 + (100 * 1e18 - 1)) / (100 * 1e18);
        return target < 100e6 ? 100e6 : target;
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
