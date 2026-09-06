// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice On-chain custody and deterministic disposition of the fixed proposal bond.
/// The workflow role can advance a proposal only through the locked transitions; timeout
/// refunds are permissionless and never depend on an operator decision.
contract ProposalBondEscrow is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant WORKFLOW_ROLE = keccak256("WORKFLOW_ROLE");
    uint256 public constant BOND = 2e6;
    uint256 public constant MAX_REVISIONS = 2;
    uint256 public constant INFRASTRUCTURE_TIMEOUT = 96 hours;

    enum State { LOCKED, REFUNDED, DISPOSED }
    struct Bond {
        address proposer;
        address baseMarket;
        uint64 createdAt;
        uint8 revisions;
        State state;
    }

    IERC20 public immutable usdc;
    address public immutable protocolReserve;
    mapping(bytes32 => Bond) public bonds;

    error InvalidBond();
    error InvalidTransition();
    error TimeoutNotReached();
    error MarketNotBound();

    event BondLocked(bytes32 indexed proposalId, address indexed proposer);
    event BondRevision(bytes32 indexed proposalId, uint8 revision);
    event BondReleased(bytes32 indexed proposalId, address indexed proposer, uint256 proposerAmount, uint256 reserveAmount, bytes32 reason);

    constructor(address safe, address token, address reserve) {
        require(safe != address(0) && token != address(0) && reserve != address(0), "address");
        _grantRole(DEFAULT_ADMIN_ROLE, safe);
        _grantRole(WORKFLOW_ROLE, safe);
        usdc = IERC20(token);
        protocolReserve = reserve;
    }

    function lock(bytes32 proposalId, address proposer) external nonReentrant {
        if (proposalId == bytes32(0) || proposer == address(0) || bonds[proposalId].proposer != address(0)) revert InvalidBond();
        usdc.safeTransferFrom(proposer, address(this), BOND);
        bonds[proposalId] = Bond(proposer, address(0), uint64(block.timestamp), 0, State.LOCKED);
        emit BondLocked(proposalId, proposer);
    }

    function recordRevision(bytes32 proposalId) external onlyRole(WORKFLOW_ROLE) {
        Bond storage bond = _locked(proposalId);
        if (bond.revisions >= MAX_REVISIONS) revert InvalidTransition();
        bond.revisions++;
        emit BondRevision(proposalId, bond.revisions);
    }

    function approve(bytes32 proposalId) external onlyRole(WORKFLOW_ROLE) nonReentrant {
        Bond storage bond = _locked(proposalId);
        if (bond.baseMarket == address(0)) revert MarketNotBound();
        _pay(proposalId, bond, BOND, 0, keccak256("APPROVED"));
    }

    /// @notice Records the immutable Base market binding before the approved
    /// bond can be released. A later release cannot overwrite this binding.
    function bindMarket(bytes32 proposalId, address baseMarket) external onlyRole(WORKFLOW_ROLE) {
        Bond storage bond = _locked(proposalId);
        if (baseMarket == address(0) || bond.baseMarket != address(0)) revert InvalidTransition();
        bond.baseMarket = baseMarket;
    }

    function rejectOrdinary(bytes32 proposalId) external onlyRole(WORKFLOW_ROLE) nonReentrant {
        Bond storage bond = _locked(proposalId);
        if (bond.revisions < MAX_REVISIONS) revert InvalidTransition();
        _pay(proposalId, bond, BOND / 2, BOND / 2, keccak256("ORDINARY_REJECTION"));
    }

    function retainForAbuse(bytes32 proposalId) external onlyRole(WORKFLOW_ROLE) nonReentrant {
        Bond storage bond = _locked(proposalId);
        _pay(proposalId, bond, 0, BOND, keccak256("MALICIOUS_ABUSE"));
    }

    function timeoutRefund(bytes32 proposalId) external nonReentrant {
        Bond storage bond = _locked(proposalId);
        if (block.timestamp < uint256(bond.createdAt) + INFRASTRUCTURE_TIMEOUT) revert TimeoutNotReached();
        _pay(proposalId, bond, BOND, 0, keccak256("INFRASTRUCTURE_TIMEOUT"));
    }

    function _locked(bytes32 proposalId) internal view returns (Bond storage bond) {
        bond = bonds[proposalId];
        if (bond.proposer == address(0) || bond.state != State.LOCKED) revert InvalidTransition();
    }

    function _pay(bytes32 proposalId, Bond storage bond, uint256 proposerAmount, uint256 reserveAmount, bytes32 reason) internal {
        bond.state = reserveAmount == 0 ? State.REFUNDED : State.DISPOSED;
        if (proposerAmount > 0) usdc.safeTransfer(bond.proposer, proposerAmount);
        if (reserveAmount > 0) usdc.safeTransfer(protocolReserve, reserveAmount);
        emit BondReleased(proposalId, bond.proposer, proposerAmount, reserveAmount, reason);
    }
}
