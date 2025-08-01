// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./ChamaStructs.sol";

/**
 * @title Enhanced ChamaGroup
 * @dev Individual group savings contract with token support and advanced features
 */
contract ChamaGroup is ReentrancyGuard, Pausable {
    using ChamaStructs for *;
    using SafeERC20 for IERC20;

    // State variables
    ChamaStructs.GroupRules public rules;
    mapping(address => ChamaStructs.Member) public members;
    mapping(address => ChamaStructs.Punishment) public punishments;
    
    struct Proposal {
        ChamaStructs.ProposalType proposalType;
        address target;
        uint256 value; // For parameter changes
        string description;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 createdAt;
        bool executed;
        // FIXED: Removed nested mapping from struct
    }

    struct PayoutInfo {
        address recipient;
        uint256 amount;
        uint256 timestamp;
        bool wasSkipped;
    }

    address[] public payoutQueue;
    mapping(uint256 => PayoutInfo) public payoutHistory;
    mapping(address => uint256[]) public memberPayoutPeriods; // Track member payout history
    
    mapping(uint256 => Proposal) public proposals;
    // FIXED: Moved hasVoted mapping outside of struct
    mapping(uint256 => mapping(address => bool)) public proposalVotes;
    mapping(address => mapping(uint256 => uint256)) public contributionTimestamps; // Track when contributions were made
    mapping(address => bool) public admins;
    mapping(address => bool) public joinRequests;
    
    uint256 public memberCount;
    uint256 public activeMemberCount; 
    uint256 public totalFunds;
    uint256 public currentPeriod;
    uint256 public skippedPayouts; // Track skipped payouts for rotation adjustment

    address public creator;
    bool public isActive;

    // Token support
    IERC20 public contributionToken; // If address(0), use native currency
    bool public isTokenBased;

    // Enhanced timing controls
    uint256 public gracePeriod = 2 days; // Grace period for contributions
    uint256 public contributionWindow = 5 days; // Window within period to contribute

    // Constants
    uint256 public constant PERIOD_DURATION = 7 days; // Weekly periods
    uint256 public constant FINE_AMOUNT = 0.01 ether;
    uint256 public constant MAX_MISSED_CONTRIBUTIONS = 3;
    uint256 public constant MIN_VOTING_QUORUM = 50; // 50% of active members

    // Proposal settings
    uint256 public proposalDuration = 3 days;
    uint256 public proposalCounter;

    // Enhanced events
    event MemberJoined(address indexed user, uint256 timestamp);
    event MemberLeft(address indexed user, uint256 refundAmount, uint256 timestamp);
    event JoinRequestSubmitted(address indexed user, uint256 timestamp);
    event JoinRequestApproved(address indexed user, address indexed approver);
    event ContributionMade(address indexed user, uint256 amount, uint256 period, uint256 timestamp);
    event MemberPunished(address indexed user, string reason, ChamaStructs.PunishmentAction action, uint256 fineAmount);
    event PunishmentCancelled(address indexed user);
    event PayoutProcessed(address indexed recipient, uint256 amount, uint256 period, bool wasSkipped);
    event EmergencyWithdrawTriggered(address indexed admin, uint256 amount);
    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event FineCollected(address indexed user, uint256 amount);
    event ProposalCreated(uint256 indexed proposalId, ChamaStructs.ProposalType proposalType, address indexed creator);
    event ProposalExecuted(uint256 indexed proposalId, bool success);
    event CreatorTransferred(address indexed oldCreator, address indexed newCreator);

    // FIXED: Added onlyCreator modifier
    modifier onlyCreator() {
        require(msg.sender == creator, "Only creator");
        _;
    }

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
     * @dev Enhanced Constructor with token support
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
        address _creator,
        address _contributionToken, // address(0) for native currency
        uint256 _gracePeriod,
        uint256 _contributionWindow
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
        members[_creator] = ChamaStructs.Member({
            exists: true,
            isActive: true,
            joinedAt: block.timestamp,
            totalContributed: 0,
            missedContributions: 0,
            consecutiveFines: 0
        });
        memberCount++;
        activeMemberCount++;

        isActive = true;
        currentPeriod = 0;

        // Token 
        if (_contributionToken != address(0)) {
            contributionToken = IERC20(_contributionToken);
            isTokenBased = true;
        }

        // Timing configuration
        if (_gracePeriod > 0) gracePeriod = _gracePeriod;
        if (_contributionWindow > 0) contributionWindow = _contributionWindow;
    }

    // FIXED: Added fallback and receive functions
    receive() external payable {}
    fallback() external payable {}

    /**
     * @dev Transfer creator role (creator only)
     */
    function transferCreator(address newCreator) external onlyCreator {
        require(newCreator != address(0), "Invalid address");
        require(newCreator != creator, "Already creator");
        
        address oldCreator = creator;
        creator = newCreator;
        
        // Transfer admin rights
        admins[newCreator] = true;
        // Optionally remove old creator's admin rights
        // admins[oldCreator] = false;
        
        emit CreatorTransferred(oldCreator, newCreator);
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
     * @dev Leave group with potential refund
     */
    function leaveGroup() external onlyActiveMember nonReentrant {
        address user = msg.sender;
        require(!punishments[user].isActive, "Cannot leave with active punishment");
        
        uint256 refundAmount = _calculateRefund(user);
        
        // FIXED: Zero state before transfer for extra reentrancy protection
        members[user].isActive = false;
        activeMemberCount--;
        
        // Process refund if applicable
        if (refundAmount > 0) {
            totalFunds -= refundAmount;
            _transferFunds(user, refundAmount);
        }
        
        emit MemberLeft(user, refundAmount, block.timestamp);
    }

    /**
     * @dev Calculate refund amount for leaving member
     */
    function _calculateRefund(address user) internal view returns (uint256) {
        // Check if member has received payout
        if (memberPayoutPeriods[user].length > 0) {
            return 0; // No refund if already received payout
        }
        
        // Return their total contributions minus any fines
        uint256 totalContributed = members[user].totalContributed;
        uint256 fineDeductions = members[user].missedContributions * FINE_AMOUNT;
        
        if (totalContributed > fineDeductions) {
            return totalContributed - fineDeductions;
        }
        return 0;
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
            missedContributions: 0,
            consecutiveFines: 0
        });
        memberCount++;
        activeMemberCount++;
        emit MemberJoined(user, block.timestamp);
    }

    /**
     * @dev Set payout queue (creator only)
     */
    function setPayoutQueue(address[] calldata queue) external onlyCreator {
        require(payoutQueue.length == 0, "Queue is already set");
        require(queue.length == memberCount, "Invalid queue length");
        
        for (uint i = 0; i < queue.length; i++) {
            require(members[queue[i]].exists, "Invalid member in queue");
        }
        payoutQueue = queue;
    }

    /**
     * @dev Enhanced contribution with token support and timing validation
     */
    function contribute() external payable onlyActiveMember onlyActiveGroup nonReentrant {
        uint256 period = getCurrentPeriod();
        require(contributionTimestamps[msg.sender][period] == 0, "Already contributed this period");
        
        // Check if within contribution window
        uint256 periodStart = rules.startDate + (period * PERIOD_DURATION);
        require(
            block.timestamp <= periodStart + contributionWindow + gracePeriod,
            "Contribution window closed"
        );

        if (isTokenBased) {
            require(msg.value == 0, "Don't send ETH for token contributions");
            contributionToken.safeTransferFrom(msg.sender, address(this), rules.contributionAmount);
        } else {
            require(msg.value == rules.contributionAmount, "Incorrect contribution amount");
        }

        contributionTimestamps[msg.sender][period] = block.timestamp;
        members[msg.sender].totalContributed += rules.contributionAmount;
        totalFunds += rules.contributionAmount;

        emit ContributionMade(msg.sender, rules.contributionAmount, period, block.timestamp);
    }

    /**
     * @dev Enhanced fine payment with token support
     */
    function payFine() external payable nonReentrant {
        ChamaStructs.Punishment storage punishment = punishments[msg.sender];
        require(punishment.isActive, "No active punishment");
        require(punishment.action == ChamaStructs.PunishmentAction.Fine, "Not a fine punishment");

        uint256 fineAmount = punishment.fineAmount;
        
        if (isTokenBased) {
            require(msg.value == 0, "Don't send ETH for token fines");
            contributionToken.safeTransferFrom(msg.sender, address(this), fineAmount);
        } else {
            require(msg.value == fineAmount, "Incorrect fine amount");
        }

        punishment.isActive = false;
        members[msg.sender].consecutiveFines = 0;
        totalFunds += fineAmount;
        
        emit FineCollected(msg.sender, fineAmount);
    }

    /**
     * @dev Enhanced missed contribution check with timing validation
     */
    function checkMissedContribution(address user) external onlyAdmin {
        require(members[user].exists && members[user].isActive, "User is not active member");
        
        uint256 period = getCurrentPeriod();
        if (period > 0) {
            uint256 prevPeriod = period - 1;
            uint256 periodStart = rules.startDate + (prevPeriod * PERIOD_DURATION);
            uint256 deadline = periodStart + contributionWindow + gracePeriod;
            
            // Check if deadline passed and no contribution made
            if (block.timestamp > deadline && contributionTimestamps[user][prevPeriod] == 0) {
                members[user].missedContributions++;
                
                if (members[user].missedContributions >= MAX_MISSED_CONTRIBUTIONS) {
                    _applyPunishment(user, "Exceeded maximum missed contributions");
                }
            }
        }
    }

    /**
     * @dev Enhanced punishment system
     */
    function _applyPunishment(address user, string memory reason) internal {
        if (rules.punishmentMode == ChamaStructs.PunishmentAction.None) return;

        uint256 fineAmount = 0;
        ChamaStructs.PunishmentAction action = rules.punishmentMode;

        if (rules.punishmentMode == ChamaStructs.PunishmentAction.Fine) {
            fineAmount = FINE_AMOUNT;
            members[user].consecutiveFines++;

            // Escalate to ban after 3 consecutive fines
            if (members[user].consecutiveFines >= 3) {
                action = ChamaStructs.PunishmentAction.Ban;
                members[user].isActive = false;
                activeMemberCount--;
            }
        } else {
            members[user].consecutiveFines = 0;
        }

        punishments[user] = ChamaStructs.Punishment({
            action: action,
            reason: reason,
            isActive: true,
            issuedAt: block.timestamp,
            fineAmount: fineAmount
        });

        emit MemberPunished(user, reason, action, fineAmount);
    }

    /**
     * @dev Enhanced rotation payout with skip handling
     */
    function processRotationPayout() external onlyAdmin onlyActiveGroup nonReentrant {
        uint256 period = getCurrentPeriod();
        require(payoutHistory[period].recipient == address(0), "Already processed this period");

        // Verify all active members contributed
        _verifyAllContributions(period);

        uint256 adjustedPeriod = (period - skippedPayouts) % payoutQueue.length;
        address recipient = payoutQueue[adjustedPeriod];
        bool wasSkipped = false;

        // Skip if member is banned or has unpaid fine
        if (!members[recipient].isActive || punishments[recipient].isActive) {
            wasSkipped = true;
            skippedPayouts++;
            
            // Find next eligible member
            recipient = _findNextEligibleRecipient(adjustedPeriod);
            require(recipient != address(0), "No eligible recipients");
        }

        uint256 payoutAmount = rules.contributionAmount * activeMemberCount;
        totalFunds -= payoutAmount;

        // Record payout
        payoutHistory[period] = PayoutInfo({
            recipient: recipient,
            amount: payoutAmount,
            timestamp: block.timestamp,
            wasSkipped: wasSkipped
        });

        // Track member payout history
        memberPayoutPeriods[recipient].push(period);

        _transferFunds(recipient, payoutAmount);
        emit PayoutProcessed(recipient, payoutAmount, period, wasSkipped);
    }

    /**
     * @dev Find next eligible recipient for payout
     */
    function _findNextEligibleRecipient(uint256 startIndex) internal view returns (address) {
        for (uint256 i = 1; i < payoutQueue.length; i++) {
            uint256 nextIndex = (startIndex + i) % payoutQueue.length;
            address candidate = payoutQueue[nextIndex];
            
            if (members[candidate].isActive && !punishments[candidate].isActive) {
                return candidate;
            }
        }
        return address(0);
    }

    /**
     * @dev Verify all active members contributed for the period
     * FIXED: Made more gas efficient by checking active status first
     */
    function _verifyAllContributions(uint256 period) internal view {
        for (uint i = 0; i < payoutQueue.length; i++) {
            address member = payoutQueue[i];
            if (members[member].isActive && !punishments[member].isActive) {
                require(
                    contributionTimestamps[member][period] > 0,
                    "Member has not contributed yet"
                );
            }
        }
    }

    /**
     * @dev Transfer funds (native or token)
     */
    function _transferFunds(address to, uint256 amount) internal {
        if (isTokenBased) {
            contributionToken.safeTransfer(to, amount);
        } else {
            (bool success, ) = payable(to).call{value: amount}("");
            require(success, "Transfer failed");
        }
    }

    /**
     * @dev Enhanced proposal creation
     */
    function createProposal(
        ChamaStructs.ProposalType proposalType,
        address target,
        uint256 value,
        string calldata description
    ) external onlyActiveMember returns (uint256) {
        proposalCounter++;
        Proposal storage p = proposals[proposalCounter];
        
        p.proposalType = proposalType;
        p.target = target;
        p.value = value;
        p.description = description;
        p.createdAt = block.timestamp;

        emit ProposalCreated(proposalCounter, proposalType, msg.sender);
        return proposalCounter;
    }

    /**
     * @dev Vote on proposal
     * FIXED: Updated to use external mapping
     */
    function voteOnProposal(uint256 proposalId, bool support) external onlyActiveMember {
        Proposal storage p = proposals[proposalId];
        require(!p.executed, "Already executed");
        require(block.timestamp <= p.createdAt + proposalDuration, "Voting period over");
        require(!proposalVotes[proposalId][msg.sender], "Already voted");

        proposalVotes[proposalId][msg.sender] = true;

        if (support) {
            p.votesFor++;
        } else {
            p.votesAgainst++;
        }
    }

    /**
     * @dev Enhanced proposal execution
     * FIXED: Improved quorum calculation to avoid rounding to zero
     */
    function executeProposal(uint256 proposalId) external onlyAdmin {
        Proposal storage p = proposals[proposalId];
        require(!p.executed, "Already executed");
        require(block.timestamp > p.createdAt + proposalDuration, "Voting still active");
        
        uint256 totalVotes = p.votesFor + p.votesAgainst;
        uint256 activeMembers = getActiveMemberCount();
        
        // FIXED: Use ceiling division to avoid rounding to zero
        uint256 requiredVotes = (activeMembers * MIN_VOTING_QUORUM + 99) / 100;
        require(totalVotes >= requiredVotes, "Insufficient participation");
        require(p.votesFor > p.votesAgainst, "Proposal rejected");
        
        bool success = _executeProposalAction(p);
        p.executed = true;
        
        emit ProposalExecuted(proposalId, success);
    }

    /**
     * @dev Execute specific proposal actions
     */
    function _executeProposalAction(Proposal storage p) internal returns (bool) {
        if (p.proposalType == ChamaStructs.ProposalType.CancelPunishment) {
            _cancelPunishmentInternal(p.target);
            return true;
        } else if (p.proposalType == ChamaStructs.ProposalType.AddAdmin) {
            require(!admins[p.target], "Already admin");
            admins[p.target] = true;
            emit AdminAdded(p.target);
            return true;
        } else if (p.proposalType == ChamaStructs.ProposalType.RemoveAdmin) {
            require(p.target != creator, "Cannot remove creator");
            require(admins[p.target], "Not an admin");
            admins[p.target] = false;
            emit AdminRemoved(p.target);
            return true;
        } else if (p.proposalType == ChamaStructs.ProposalType.KickMember) {
            require(members[p.target].exists && members[p.target].isActive, "Invalid member");
            members[p.target].isActive = false;
            activeMemberCount--;
            return true;
        }
        return false;
    }

    /**
     * @dev Internal function to cancel punishment
     */
    function _cancelPunishmentInternal(address user) internal {
        require(punishments[user].isActive, "No active punishment");
        
        if (punishments[user].action == ChamaStructs.PunishmentAction.Ban) {
            members[user].isActive = true;
            
            activeMemberCount++;
        }
        
        punishments[user].isActive = false;
        members[user].missedContributions = 0;
        members[user].consecutiveFines = 0;
        
        emit PunishmentCancelled(user);
    }

    /**
     * @dev Cancel punishment (admin only)
     */
    function cancelPunishment(address user) external onlyAdmin {
        _cancelPunishmentInternal(user);
    }

    /**
     * @dev Manual punishment (admin only)
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
            activeMemberCount--;
        }

        emit MemberPunished(user, reason, action, fineAmount);
    }

    /**
     * @dev Emergency withdraw with token support
     */
    function triggerEmergencyWithdraw() external onlyAdmin nonReentrant {
        require(rules.emergencyWithdrawAllowed, "Emergency withdraw not allowed");
        
        uint256 amount;
        if (isTokenBased) {
            amount = contributionToken.balanceOf(address(this));
            require(amount > 0, "No tokens to withdraw");
            contributionToken.safeTransfer(msg.sender, amount);
        } else {
            amount = address(this).balance;
            require(amount > 0, "No funds to withdraw");
            (bool success, ) = payable(msg.sender).call{value: amount}("");
            require(success, "Transfer failed");
        }
        
        totalFunds = 0;
        emit EmergencyWithdrawTriggered(msg.sender, amount);
    }

    /**
     * @dev Add admin (creator only)
     */
    function addAdmin(address newAdmin) external onlyCreator {
        require(!admins[newAdmin], "Already an admin");
        
        admins[newAdmin] = true;
        emit AdminAdded(newAdmin);
    }

    /**
     * @dev Remove admin (creator only)
     */
    function removeAdmin(address admin) external onlyCreator {
        require(admin != creator, "Cannot remove creator");
        require(admins[admin], "Not an admin");
        
        admins[admin] = false;
        emit AdminRemoved(admin);
    }

    // VIEW FUNCTIONS

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
     * @dev Get member contribution timestamp for period
     */
    function getMemberContributionTimestamp(address user, uint256 period) external view returns (uint256) {
        return contributionTimestamps[user][period];
    }

    /**
     * @dev Get member payout history
     */
    function getMemberPayoutHistory(address user) external view returns (uint256[] memory) {
        return memberPayoutPeriods[user];
    }

    /**
     * @dev Get payout info for period
     */
    function getPayoutInfo(uint256 period) external view returns (
        address recipient,
        uint256 amount,
        uint256 timestamp,
        bool wasSkipped
    ) {
        PayoutInfo memory info = payoutHistory[period];
        return (info.recipient, info.amount, info.timestamp, info.wasSkipped);
    }

    /**
     * @dev Check if contribution window is open for current period
     */
   function isContributionWindowOpen() external view returns (bool) {
    uint256 nowTs = block.timestamp;
    
    uint256 elapsed = nowTs - rules.startDate;
    uint256 period = elapsed / PERIOD_DURATION;

    uint256 periodStart = rules.startDate + (period * PERIOD_DURATION);
    uint256 windowEnd = periodStart + contributionWindow + gracePeriod;

    return nowTs >= periodStart && nowTs <= windowEnd;
}



    /**
     * @dev Get active member count
     */
    function getActiveMemberCount() public view returns (uint256) {
        return activeMemberCount;
    }

    /**
     * @dev Get contract balance (native or token)
     */
    function getBalance() external view returns (uint256) {
        if (isTokenBased) {
            return contributionToken.balanceOf(address(this));
        }
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
        uint256 missedContributions,
        uint256 consecutiveFines
    ) {
        ChamaStructs.Member memory member = members[user];
        return (
            member.exists,
            member.isActive,
            member.joinedAt,
            member.totalContributed,
            member.missedContributions,
            member.consecutiveFines
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
     * @dev Get proposal details
     */
    function getProposalDetails(uint256 proposalId) external view returns (
        ChamaStructs.ProposalType proposalType,
        address target,
        uint256 value,
        string memory description,
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 createdAt,
        bool executed
    ) {
        Proposal storage p = proposals[proposalId];
        return (
            p.proposalType,
            p.target,
            p.value,
            p.description,
            p.votesFor,
            p.votesAgainst,
            p.createdAt,
            p.executed
        );
    }

    /**
     * @dev Check if address has voted on proposal
     * FIXED: Updated to use external mapping
     */
    function hasVotedOnProposal(uint256 proposalId, address voter) external view returns (bool) {
        return proposalVotes[proposalId][voter];
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