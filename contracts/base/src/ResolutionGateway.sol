// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ITerminalMarket} from "./interfaces/IGenetia.sol";

contract ResolutionGateway is AccessControl, EIP712 {
    using ECDSA for bytes32;
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");
    uint256 public constant GENLAYER_CHAIN_ID = 61997;
    uint8 public constant THRESHOLD = 3;

    struct Binding {
        bytes32 marketId;
        address resolver;
        bytes32 manifestHash;
        bytes32 resolverReleaseId;
        uint256 terminalDeadline;
    }

    struct ResolutionEnvelope {
        bytes32 marketId;
        address baseMarket;
        uint256 baseChainId;
        address resolver;
        uint256 genlayerChainId;
        bytes32 genlayerTxId;
        bytes32 manifestHash;
        bytes32 resolverReleaseId;
        uint8 attempt;
        uint8 outcome;
        bytes32 resultCommitment;
    }

    bytes32 public constant ENVELOPE_TYPEHASH = keccak256(
        "ResolutionEnvelope(bytes32 marketId,address baseMarket,uint256 baseChainId,address resolver,uint256 genlayerChainId,bytes32 genlayerTxId,bytes32 manifestHash,bytes32 resolverReleaseId,uint8 attempt,uint8 outcome,bytes32 resultCommitment)"
    );

    address[5] public watchers;
    mapping(address => bool) public isWatcher;
    mapping(address => Binding) public bindings;
    mapping(bytes32 => bool) public consumedTransactions;
    address public factory;

    event MarketRegistered(address indexed market, bytes32 indexed marketId, address indexed resolver, bytes32 manifestHash);
    event ResolutionConsumed(address indexed market, bytes32 indexed genlayerTxId, uint8 outcome, bytes32 resultCommitment);

    constructor(address safe, address factory_, address[5] memory signerSet) EIP712("Genetia Resolution", "1") {
        require(safe != address(0), "safe");
        _grantRole(DEFAULT_ADMIN_ROLE, safe);
        if (factory_ != address(0)) { factory = factory_; _grantRole(FACTORY_ROLE, factory_); }
        for (uint256 i; i < 5; ++i) {
            address signer = signerSet[i];
            require(signer != address(0) && !isWatcher[signer], "watcher set");
            watchers[i] = signer;
            isWatcher[signer] = true;
        }
    }

    function setFactory(address factory_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(factory == address(0) && factory_ != address(0), "factory set");
        factory = factory_;
        _grantRole(FACTORY_ROLE, factory_);
    }

    function registerMarket(
        address market,
        bytes32 marketId,
        address resolver,
        bytes32 manifestHash,
        bytes32 resolverReleaseId,
        uint256 terminalDeadline
    ) external onlyRole(FACTORY_ROLE) {
        require(market != address(0) && resolver != address(0), "address");
        require(bindings[market].resolver == address(0), "binding immutable");
        bindings[market] = Binding(marketId, resolver, manifestHash, resolverReleaseId, terminalDeadline);
        emit MarketRegistered(market, marketId, resolver, manifestHash);
    }

    function digest(ResolutionEnvelope calldata envelope) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ENVELOPE_TYPEHASH,
                    envelope.marketId,
                    envelope.baseMarket,
                    envelope.baseChainId,
                    envelope.resolver,
                    envelope.genlayerChainId,
                    envelope.genlayerTxId,
                    envelope.manifestHash,
                    envelope.resolverReleaseId,
                    envelope.attempt,
                    envelope.outcome,
                    envelope.resultCommitment
                )
            )
        );
    }

    function submitResolution(ResolutionEnvelope calldata envelope, bytes[] calldata signatures) external {
        Binding memory binding = bindings[envelope.baseMarket];
        require(binding.resolver != address(0), "unknown market");
        require(block.timestamp < binding.terminalDeadline, "terminal deadline");
        require(envelope.baseChainId == block.chainid && envelope.genlayerChainId == GENLAYER_CHAIN_ID, "wrong chain");
        require(envelope.marketId == binding.marketId && envelope.resolver == binding.resolver, "wrong binding");
        require(envelope.manifestHash == binding.manifestHash, "wrong manifest");
        require(envelope.resolverReleaseId == binding.resolverReleaseId, "wrong release");
        require(envelope.outcome <= 2 && !consumedTransactions[envelope.genlayerTxId], "invalid result");
        require(_countValidSigners(digest(envelope), signatures) >= THRESHOLD, "watcher quorum");
        consumedTransactions[envelope.genlayerTxId] = true;
        ITerminalMarket(envelope.baseMarket).settle(envelope.outcome);
        emit ResolutionConsumed(envelope.baseMarket, envelope.genlayerTxId, envelope.outcome, envelope.resultCommitment);
    }

    function _countValidSigners(bytes32 envelopeDigest, bytes[] calldata signatures) internal view returns (uint256 count) {
        address[] memory seen = new address[](signatures.length);
        for (uint256 i; i < signatures.length; ++i) {
            address signer = envelopeDigest.recover(signatures[i]);
            require(isWatcher[signer], "invalid watcher");
            for (uint256 j; j < count; ++j) require(seen[j] != signer, "duplicate watcher");
            seen[count++] = signer;
        }
    }
}
