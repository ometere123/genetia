// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract OutcomeTokens is ERC1155, AccessControl {
    bytes32 public constant MARKET_ROLE = keccak256("MARKET_ROLE");

    constructor(address safe) ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, safe);
    }

    function tokenIdFor(bytes32 marketId, uint8 outcome) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(marketId, outcome)));
    }

    function mint(address to, uint256 id, uint256 amount) external onlyRole(MARKET_ROLE) {
        _mint(to, id, amount, "");
    }

    function burn(address from, uint256 id, uint256 amount) external onlyRole(MARKET_ROLE) {
        _burn(from, id, amount);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
