// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract ResolutionGateway is EIP712 {
    using ECDSA for bytes32;
    uint256 public constant GENLAYER_CHAIN_ID = 61997;
    uint8 public constant THRESHOLD = 3;

    struct Envelope {
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
        uint256 deadline;
    }
    bytes32 private constant TYPEHASH = keccak256(
        "Envelope(bytes32 marketId,address baseMarket,uint256 baseChainId,address resolver,uint256 genlayerChainId,bytes32 genlayerTxId,bytes32 manifestHash,bytes32 resolverReleaseId,uint8 attempt,uint8 outcome,bytes32 resultCommitment,uint256 deadline)"
    );
    mapping(address => bool) public watcher;
    mapping(bytes32 => bool) public usedTx;
    address[5] public watchers;
    address public admin;

    struct Binding {
        address resolver;
        bytes32 manifestHash;
        bytes32 releaseId;
    }
    mapping(address => Binding) public bindings;

    constructor(address safe, address[5] memory signers) EIP712("Genetia Resolution", "1") {
        admin = safe;
        for (uint256 i; i < 5; i++) {
            watchers[i] = signers[i];
            watcher[signers[i]] = true;
        }
    }

    function digest(Envelope calldata e) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    TYPEHASH,
                    e.marketId,
                    e.baseMarket,
                    e.baseChainId,
                    e.resolver,
                    e.genlayerChainId,
                    e.genlayerTxId,
                    e.manifestHash,
                    e.resolverReleaseId,
                    e.attempt,
                    e.outcome,
                    e.resultCommitment,
                    e.deadline
                )
            )
        );
    }

    function bindMarket(address market, address resolver, bytes32 manifest, bytes32 releaseId) external {
        require(msg.sender == admin, "admin");
        require(bindings[market].resolver == address(0), "binding immutable");
        bindings[market] = Binding(resolver, manifest, releaseId);
    }

    function verify(Envelope calldata e, bytes[] calldata sigs) public view returns (bool) {
        Binding memory b = bindings[e.baseMarket];
        require(
            e.baseChainId == block.chainid && e.genlayerChainId == GENLAYER_CHAIN_ID && e.outcome <= 2
                && !usedTx[e.genlayerTxId] && b.resolver == e.resolver && b.manifestHash == e.manifestHash
                && b.releaseId == e.resolverReleaseId,
            "invalid envelope"
        );
        uint256 count;
        address last;
        for (uint256 i; i < sigs.length; i++) {
            address s = digest(e).recover(sigs[i]);
            require(watcher[s] && s > last, "duplicate signer");
            last = s;
            count++;
        }
        return count >= THRESHOLD;
    }

    function consume(Envelope calldata e, bytes[] calldata sigs) external {
        require(verify(e, sigs), "quorum");
        usedTx[e.genlayerTxId] = true;
        (bool ok,) = e.baseMarket.call(abi.encodeWithSignature("settle(uint8)", e.outcome));
        require(ok, "settlement");
    }
}
