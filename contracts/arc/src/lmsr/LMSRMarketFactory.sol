// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LMSRMarket} from "./LMSRMarket.sol";
import {OutcomeTokens} from "./OutcomeTokens.sol";

/// @title LMSRMarketFactory
/// @notice Deploys Arc LMSR market contracts and seeds each market with USDC.
///
/// The factory holds the current trusted relayer and admin addresses so each
/// LMSRMarket can read them through `factory.relayer()` and `factory.admin()`.
/// In this MVP the relayer is the trusted GenLayer-to-Arc submission path and
/// the admin is the testnet adjudication/safety operator. Multisig governance
/// is intentionally not implemented in this pass.
contract LMSRMarketFactory {
    // ─── Storage ────────────────────────────────────────────────────────────

    address public admin;
    address public relayer;
    address public treasury;
    /// The default collateral token (USDC on mainnet/testnet). Kept as an
    /// immutable for gas + backward compatibility with v2.1 callers that
    /// expect `factory.usdc()`. Multi-currency is layered on top via the
    /// `allowedCollateral` allowlist.
    IERC20 public immutable usdc;
    OutcomeTokens public immutable tokens;
    bytes32 private constant ACTION_SET_ADMIN = keccak256("SET_ADMIN");
    bytes32 private constant ACTION_SET_RELAYER = keccak256("SET_RELAYER");
    bytes32 private constant ACTION_SET_TREASURY = keccak256("SET_TREASURY");
    bytes32 private constant ACTION_SET_COLLATERAL = keccak256("SET_COLLATERAL");

    /// Multi-currency support: each market is created with a specific
    /// collateral token. Tokens must be admin-allowlisted before they can
    /// back a market. The default `usdc` is allowlisted at deploy time.
    mapping(address => bool) public allowedCollateral;
    /// Enumeration of currently allowlisted tokens (for UI / off-chain
    /// indexers). Insert-only; we set the bool to false on removal but
    /// leave the address in the list.
    address[] public allowedCollateralList;

    /// Monotonically increasing market id. Doubles as ERC-1155 namespace base.
    uint256 public nextMarketId;

    /// All Markets ever deployed by this factory.
    address[] public allMarkets;
    /// Lookup by market id.
    mapping(uint256 => address) public marketById;
    /// Lookup of the collateral token backing each market id.
    mapping(uint256 => address) public marketCollateral;

    // ─── Events ─────────────────────────────────────────────────────────────

    event MarketCreated(
        uint256 indexed marketId,
        address indexed market,
        address indexed collateral,
        uint256 b,
        uint256 expiry
    );
    event MarketSuggested(address indexed from, string question, string category, uint256 expiry, string criteria);
    event AdminUpdated(address indexed newAdmin);
    event RelayerUpdated(address indexed newRelayer);
    event ResolverUpdated(address indexed oldResolver, address indexed newResolver);
    event TreasuryUpdated(address indexed newTreasury);
    event CollateralAllowlistUpdated(address indexed token, bool allowed);
    event EmergencyActionUsed(address indexed admin, bytes32 indexed action, address indexed target, uint256 timestamp);

    // ─── Errors ─────────────────────────────────────────────────────────────

    error NotAdmin();
    error ZeroAddress();
    error ExpiryInPast();
    error TreasuryNotSet();
    error CollateralNotAllowed();

    // ─── Modifiers ──────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    // ─── Constructor ────────────────────────────────────────────────────────

    /// @param _usdc      Arc-native USDC ERC-20 address. Becomes the default
    ///                   collateral and is auto-allowlisted.
    /// @param _relayer   GenLayer relayer address (will call proposeResolution).
    /// @param _treasury  Genetia treasury wallet — funds new market seed liquidity.
    constructor(address _usdc, address _relayer, address _treasury) {
        if (_usdc == address(0) || _relayer == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }
        admin = msg.sender;
        relayer = _relayer;
        treasury = _treasury;
        usdc = IERC20(_usdc);
        tokens = new OutcomeTokens(address(this));

        // Default collateral: USDC. Future tokens get added via
        // setAllowedCollateral(token, true). Doing this in the constructor
        // keeps v2.1 callers working without an extra admin step.
        allowedCollateral[_usdc] = true;
        allowedCollateralList.push(_usdc);
        emit CollateralAllowlistUpdated(_usdc, true);
    }

    // ─── Factory ────────────────────────────────────────────────────────────

    /// @notice Admin deploys a new LMSR market backed by `collateralToken` and
    ///         seeds it with `b` units of that token pulled from `treasury`.
    ///         The token must be allowlisted via `setAllowedCollateral`.
    ///         Treasury must `approve(factory, b)` of the chosen token
    ///         beforehand (or have a standing allowance).
    function createMarket(
        address collateralToken,
        uint256 b,
        uint256 expiry
    ) public onlyAdmin returns (uint256 marketId, address market) {
        if (expiry <= block.timestamp) revert ExpiryInPast();
        if (treasury == address(0)) revert TreasuryNotSet();
        if (!allowedCollateral[collateralToken]) revert CollateralNotAllowed();

        IERC20 collateral = IERC20(collateralToken);

        marketId = nextMarketId++;
        market = address(new LMSRMarket(marketId, address(tokens), collateralToken, b, expiry));
        marketById[marketId] = market;
        marketCollateral[marketId] = collateralToken;
        allMarkets.push(market);

        tokens.registerMarket(market, marketId);

        // Treasury → factory → Market.seed(). Two-step so the Market never
        // needs `transferFrom(treasury, …)` directly.
        require(collateral.transferFrom(treasury, address(this), b), "treasury transferFrom failed");
        require(collateral.approve(market, b), "approve failed");
        LMSRMarket(market).seed(address(this), b);

        emit MarketCreated(marketId, market, collateralToken, b, expiry);
    }

    /// @notice Backward-compatible overload — uses the default `usdc` token.
    ///         Lets v2.1 callers keep working unchanged.
    function createMarket(uint256 b, uint256 expiry) external returns (uint256 marketId, address market) {
        return createMarket(address(usdc), b, expiry);
    }

    /// @notice Public event-only suggestion endpoint (no contract deployed).
    function suggestMarket(
        string calldata question,
        string calldata category,
        uint256 expiry,
        string calldata criteria
    ) external {
        emit MarketSuggested(msg.sender, question, category, expiry, criteria);
    }

    // ─── Admin actions ──────────────────────────────────────────────────────

    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address oldAdmin = admin;
        admin = newAdmin;
        emit AdminUpdated(newAdmin);
        emit EmergencyActionUsed(oldAdmin, ACTION_SET_ADMIN, newAdmin, block.timestamp);
    }

    function setRelayer(address newRelayer) external onlyAdmin {
        if (newRelayer == address(0)) revert ZeroAddress();
        address oldRelayer = relayer;
        relayer = newRelayer;
        emit RelayerUpdated(newRelayer);
        emit ResolverUpdated(oldRelayer, newRelayer);
        emit EmergencyActionUsed(msg.sender, ACTION_SET_RELAYER, newRelayer, block.timestamp);
    }

    function setTreasury(address newTreasury) external onlyAdmin {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
        emit EmergencyActionUsed(msg.sender, ACTION_SET_TREASURY, newTreasury, block.timestamp);
    }

    /// @notice Allowlist (or remove) a collateral token. Admin-gated.
    ///         Existing markets backed by the token are unaffected — they
    ///         remain in whatever state they were already in. Future
    ///         `createMarket` calls will reject the token if disallowed.
    function setAllowedCollateral(address token, bool allowed) external onlyAdmin {
        if (token == address(0)) revert ZeroAddress();
        bool wasAllowed = allowedCollateral[token];
        allowedCollateral[token] = allowed;
        if (allowed && !wasAllowed) {
            allowedCollateralList.push(token);
        }
        emit CollateralAllowlistUpdated(token, allowed);
        emit EmergencyActionUsed(msg.sender, ACTION_SET_COLLATERAL, token, block.timestamp);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function getMarketsCount() external view returns (uint256) {
        return allMarkets.length;
    }

    function getMarkets() external view returns (address[] memory) {
        return allMarkets;
    }

    function getAllowedCollateralList() external view returns (address[] memory) {
        return allowedCollateralList;
    }
}
