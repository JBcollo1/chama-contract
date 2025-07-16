// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;


import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./ChamaStructs.sol";

/**
 * @title ChamaGroup
 * @dev Individual group savings contract
 */
contract ChamaGroup is ReentrancyGuard, Pausable {
    // using SafeMath for uint256;
    using ChamaStructs for *;

    // State variables
    ChamaStructs.GroupRules public rules;
    mapping(address => ChamaStructs.Member) public members;
    mapping(address => ChamaStructs.Punishment) public punishments;
    mapping(address => mapping(uint256 => bool)) public contributions;
    mapping(address => bool) public admins;
    mapping(address => bool) public joinRequests;
    
    uint256 public memberCount;
    uint256 public totalFunds;
    uint256 public currentPeriod;
    address public creator;
    bool public isActive;

    // Constants
    uint256 public constant PERIOD_DURATION = 7 days; // Weekly periods
    uint256 public constant FINE_AMOUNT = 0.01 ether;
    uint256 public constant MAX_MISSED_CONTRIBUTIONS = 3;

    // Events
    event MemberJoined(address indexed user, uint256 timestamp);
    event JoinRequestSubmitted(address indexed user, uint256 timestamp);
    event JoinRequestApproved(address indexed user, address indexed approver);
    event ContributionMade(address indexed user, uint256 amount, uint256 period, uint256 timestamp);
    event MemberPunished(address indexed user, string reason, ChamaStructs.PunishmentAction action, uint256 fineAmount);
    event PunishmentCancelled(address indexed user);
    event EmergencyWithdrawTriggered(address indexed admin, uint256 amount);
    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event FineCollected(address indexed user, uint256 amount);

    // Modifiers
    modifier onlyAdmin() {
        require(admins[msg.sender], "Not admin");
        _;
    }

    modifier onlyActiveMember() {
        require(members[msg.sender].exists && members[msg.sender].isActive, "Not an active member");
        _;
    }

    modifier onlyActiveGroup() {
        require(isActive, "Group is not active");
        require(block.timestamp >= rules.startDate, "Group hasn't started");
        require(block.timestamp <= rules.endDate, "Group has ended");
        _;
    }

    /**
     * @dev Constructor
     */
    constructor(
        string memory _name,
        uint256 _contributionAmount,
        uint256 _maxMembers,
        uint256 _startDate,
        uint256 _endDate,
        string memory _contributionFrequency,
        ChamaStructs.PunishmentAction _punishmentMode,
        bool _approvalRequired,
        bool _emergencyWithdrawAllowed,
        address _creator
    ) {
        rules = ChamaStructs.GroupRules({
            name: _name,
            contributionAmount: _contributionAmount,
            contributionFrequency: _contributionFrequency,
            maxMembers: _maxMembers,
            startDate: _startDate,
            endDate: _endDate,
            punishmentMode: _punishmentMode,
            approvalRequired: _approvalRequired,
            emergencyWithdrawAllowed: _emergencyWithdrawAllowed
        });

        creator = _creator;
        admins[_creator] = true;
        isActive = true;
        currentPeriod = 0;
    }

    /**
     * @dev Join group (with or without approval)
     */
    function joinGroup() external onlyActiveGroup {
        require(!members[msg.sender].exists, "Already a member");
        require(memberCount < rules.maxMembers, "Group is full");
        require(!punishments[msg.sender].isActive, "User has active punishment");

        if (rules.approvalRequired) {
            require(!joinRequests[msg.sender], "Join request already submitted");
            joinRequests[msg.sender] = true;
            emit JoinRequestSubmitted(msg.sender, block.timestamp);
        } else {
            _addMember(msg.sender);
        }
    }

    /**
     * @dev Approve join request (admin only)
     */
    function approveJoinRequest(address user) external onlyAdmin onlyActiveGroup {
        require(joinRequests[user], "No join request found");
        require(memberCount < rules.maxMembers, "Group is full");
        
        joinRequests[user] = false;
        _addMember(user);
        
        emit JoinRequestApproved(user, msg.sender);
    }

    /**
     * @dev Internal function to add member
     */
    function _addMember(address user) internal {
        members[user] = ChamaStructs.Member({
            exists: true,
            isActive: true,
            joinedAt: block.timestamp,
            totalContributed: 0,
            missedContributions: 0
        });
        memberCount++;
        emit MemberJoined(user, block.timestamp);
    }

    /**
     * @dev Make contribution
     */
    function contribute() external payable onlyActiveMember onlyActiveGroup nonReentrant {
        require(msg.value == rules.contributionAmount, "Incorrect contribution amount");
        
        uint256 period = getCurrentPeriod();
        require(!contributions[msg.sender][period], "Already contributed this period");

        contributions[msg.sender][period] = true;
        members[msg.sender].totalContributed += msg.value;

        totalFunds += msg.value;


        emit ContributionMade(msg.sender, msg.value, period, block.timestamp);
    }

    /**
     * @dev Pay fine for punishment
     */
    function payFine() external payable  nonReentrant {
        ChamaStructs.Punishment storage punishment = punishments[msg.sender];
        require(punishment.isActive, "No active punishment");
        require(punishment.action == ChamaStructs.PunishmentAction.Fine, "Not a fine punishment");
        require(msg.value == punishment.fineAmount, "Incorrect fine amount");

        punishment.isActive = false;
        totalFunds += msg.value;
        
        emit FineCollected(msg.sender, msg.value);
    }

    /**
     * @dev Check for missed contributions and apply punishment
     */
    function checkMissedContribution(address user) external onlyAdmin {
        require(members[user].exists && members[user].isActive, "User is not active member");
        
        uint256 period = getCurrentPeriod();
        if (period > 0 && !contributions[user][period - 1]) {
            members[user].missedContributions++;
            
            if (members[user].missedContributions >= MAX_MISSED_CONTRIBUTIONS) {
                _applyPunishment(user, "Exceeded maximum missed contributions");
            }
        }
    }

    /**
     * @dev Apply punishment based on group rules
     */
    function _applyPunishment(address user, string memory reason) internal {
        if (rules.punishmentMode == ChamaStructs.PunishmentAction.None) return;

        uint256 fineAmount = 0;
        if (rules.punishmentMode == ChamaStructs.PunishmentAction.Fine) {
            fineAmount = FINE_AMOUNT;
        }

        punishments[user] = ChamaStructs.Punishment({
            action: rules.punishmentMode,
            reason: reason,
            isActive: true,
            issuedAt: block.timestamp,
            fineAmount: fineAmount
        });

        if (rules.punishmentMode == ChamaStructs.PunishmentAction.Ban) {
            members[user].isActive = false;
        }

        emit MemberPunished(user, reason, rules.punishmentMode, fineAmount);
    }

    /**
     * @dev Manually punish member (admin only)
     */
    function punishMember(
        address user,
        ChamaStructs.PunishmentAction action,
        string calldata reason
    ) external onlyAdmin {
        require(members[user].exists, "User is not a member");
        require(action != ChamaStructs.PunishmentAction.None, "Invalid punishment action");
        
        uint256 fineAmount = 0;
        if (action == ChamaStructs.PunishmentAction.Fine) {
            fineAmount = FINE_AMOUNT;
        }

        punishments[user] = ChamaStructs.Punishment({
            action: action,
            reason: reason,
            isActive: true,
            issuedAt: block.timestamp,
            fineAmount: fineAmount
        });

        if (action == ChamaStructs.PunishmentAction.Ban) {
            members[user].isActive = false;
        }

        emit MemberPunished(user, reason, action, fineAmount);
    }

    /**
     * @dev Cancel punishment (admin only)
     */
    function cancelPunishment(address user) external onlyAdmin {
        require(punishments[user].isActive, "No active punishment");
        
        punishments[user].isActive = false;
        
        // Reactivate member if they were banned
        if (punishments[user].action == ChamaStructs.PunishmentAction.Ban) {
            members[user].isActive = true;
        }
        
        emit PunishmentCancelled(user);
    }

    /**
     * @dev Emergency withdraw (admin only)
     */
    function triggerEmergencyWithdraw() external onlyAdmin nonReentrant {
        require(rules.emergencyWithdrawAllowed, "Emergency withdraw not allowed");
        require(address(this).balance > 0, "No funds to withdraw");

        uint256 amount = address(this).balance;
        totalFunds = 0;
        
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");
        
        emit EmergencyWithdrawTriggered(msg.sender, amount);
    }

    /**
     * @dev Add admin (creator only)
     */
    function addAdmin(address newAdmin) external {
        require(msg.sender == creator, "Only creator can add admins");
        require(!admins[newAdmin], "Already an admin");
        
        admins[newAdmin] = true;
        emit AdminAdded(newAdmin);
    }

    /**
     * @dev Remove admin (creator only)
     */
    function removeAdmin(address admin) external {
        require(msg.sender == creator, "Only creator can remove admins");
        require(admin != creator, "Cannot remove creator");
        require(admins[admin], "Not an admin");
        
        admins[admin] = false;
        emit AdminRemoved(admin);
    }

    /**
     * @dev Get current period
     */
    function getCurrentPeriod() public view returns (uint256) {
        if (block.timestamp < rules.startDate) {
            return 0;
        }
        return (block.timestamp - rules.startDate) / PERIOD_DURATION;
    }

    /**
     * @dev Get member contribution status for period
     */
    function getMemberContributionStatus(address user, uint256 period) external view returns (bool) {
        return contributions[user][period];
    }

    /**
     * @dev Get contract balance
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @dev Get member details
     */
    function getMemberDetails(address user) external view returns (
        bool exists,
        bool active,
        uint256 joinedAt,
        uint256 totalContributed,
        uint256 missedContributions
    ) {
        ChamaStructs.Member memory member = members[user];
        return (
            member.exists,
            member.isActive,
            member.joinedAt,
            member.totalContributed,
            member.missedContributions
        );
    }

    /**
     * @dev Get punishment details
     */
    function getPunishmentDetails(address user) external view returns (
        ChamaStructs.PunishmentAction action,
        string memory reason,
        bool active,
        uint256 issuedAt,
        uint256 fineAmount
    ) {
        ChamaStructs.Punishment memory punishment = punishments[user];
        return (
            punishment.action,
            punishment.reason,
            punishment.isActive,
            punishment.issuedAt,
            punishment.fineAmount
        );
    }

    /**
     * @dev Emergency pause (admin only)
     */
    function pause() external onlyAdmin {
        _pause();
    }

    /**
     * @dev Unpause (admin only)
     */
    function unpause() external onlyAdmin {
        _unpause();
    }
}