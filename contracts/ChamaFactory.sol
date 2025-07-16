// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./ChamaGroup.sol";
import "./ChamaStructs.sol";

/**
 * @title ChamaFactory
 * @dev Factory contract for deploying and managing ChamaGroup contracts
 */
contract ChamaFactory is Ownable, Pausable {
  
    using ChamaStructs for *;
    constructor(address initialOwner) Ownable(initialOwner) {}
    // Events
    event GroupCreated(
        address indexed creator,
        address indexed groupAddress,
        string name,
        uint256 contributionAmount,
        uint256 maxMembers
    );

    // State variables
    mapping(address => address[]) public creatorGroups;
    mapping(address => bool) public isValidGroup;
    address[] public allGroups;
    uint256 public groupCounter;

    // Constants
    uint256 public constant MAX_GROUPS_PER_CREATOR = 10;
    uint256 public constant MIN_CONTRIBUTION_AMOUNT = 0.001 ether;
    uint256 public constant MAX_CONTRIBUTION_AMOUNT = 100 ether;
    uint256 public constant MIN_MEMBERS = 3;
    uint256 public constant MAX_MEMBERS = 100;

    /**
     * @dev Creates a new ChamaGroup contract
     * @param config Group configuration parameters
     */
    function createGroup(ChamaStructs.GroupConfig memory config) external whenNotPaused {
        require(bytes(config.name).length > 0 && bytes(config.name).length <= 50, "Invalid name length");
        require(config.contributionAmount >= MIN_CONTRIBUTION_AMOUNT && 
                config.contributionAmount <= MAX_CONTRIBUTION_AMOUNT, "Invalid contribution amount");
        require(config.maxMembers >= MIN_MEMBERS && config.maxMembers <= MAX_MEMBERS, "Invalid max members");
        require(config.startDate > block.timestamp, "Start date must be in future");
        require(config.endDate > config.startDate, "End date must be after start date");
        require(config.endDate <= block.timestamp + 365 days, "End date too far in future");
        require(creatorGroups[msg.sender].length < MAX_GROUPS_PER_CREATOR, "Too many groups created");

        ChamaGroup newGroup = new ChamaGroup(
            config.name,
            config.contributionAmount,
            config.maxMembers,
            config.startDate,
            config.endDate,
            config.contributionFrequency,
            config.punishmentMode,
            config.approvalRequired,
            config.emergencyWithdrawAllowed,
            msg.sender
        );

        address groupAddress = address(newGroup);
        creatorGroups[msg.sender].push(groupAddress);
        isValidGroup[groupAddress] = true;
        allGroups.push(groupAddress);
        groupCounter++;

        emit GroupCreated(msg.sender, groupAddress, config.name, config.contributionAmount, config.maxMembers);
    }

    /**
     * @dev Get groups created by a specific creator
     */
    function getCreatorGroups(address creator) external view returns (address[] memory) {
        return creatorGroups[creator];
    }

    /**
     * @dev Get all groups
     */
    function getAllGroups() external view returns (address[] memory) {
        return allGroups;
    }

    /**
     * @dev Emergency pause function
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause function
     */
    function unpause() external onlyOwner {
        _unpause();
    }
}