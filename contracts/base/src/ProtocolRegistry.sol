// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/access/AccessControl.sol";

contract ProtocolRegistry is AccessControl {
    bytes32 public constant RELEASE_ADMIN_ROLE = keccak256("RELEASE_ADMIN_ROLE");

    struct Release {
        address implementation;
        bytes32 bytecodeHash;
        bytes32 commitSha;
        bool active;
    }
    mapping(bytes32 => Release) public releases;
    bytes32 public defaultPoolRelease;
    bytes32 public defaultLMSRRelease;
    event ReleaseRegistered(bytes32 indexed releaseId, address implementation, bytes32 bytecodeHash, bytes32 commitSha);

    constructor(address safe) {
        _grantRole(DEFAULT_ADMIN_ROLE, safe);
        _grantRole(RELEASE_ADMIN_ROLE, safe);
    }

    function registerRelease(bytes32 id, address implementation, bytes32 bytecodeHash, bytes32 commitSha)
        external
        onlyRole(RELEASE_ADMIN_ROLE)
    {
        require(id != bytes32(0) && implementation != address(0), "invalid release");
        require(releases[id].implementation == address(0), "release immutable");
        releases[id] = Release(implementation, bytecodeHash, commitSha, true);
        emit ReleaseRegistered(id, implementation, bytecodeHash, commitSha);
    }

    function setDefaults(bytes32 pool, bytes32 lmsr) external onlyRole(RELEASE_ADMIN_ROLE) {
        require(releases[pool].active && releases[lmsr].active, "release inactive");
        defaultPoolRelease = pool;
        defaultLMSRRelease = lmsr;
    }

    function isActive(bytes32 releaseId) external view returns (bool) {
        return releases[releaseId].active;
    }
}
