// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ChamaStructs
 * @dev Shared structs and enums for the Chama system
 */
library ChamaStructs {
    // Enums
    enum PunishmentAction { None, Warning, Fine, Ban }

    // Structs
    struct Member {
        bool exists;
        bool isActive;
        uint256 joinedAt;
        uint256 totalContributed;
        uint256 missedContributions;
        uint256 consecutiveFines;
    }

    struct Punishment {
        PunishmentAction action;
        string reason;
        bool isActive;
        uint256 issuedAt;
        uint256 fineAmount;
    }

    struct GroupRules {
        string name;
        uint256 contributionAmount;
        string contributionFrequency;
        uint256 maxMembers;
        uint256 startDate;
        uint256 endDate;
        PunishmentAction punishmentMode;
        bool approvalRequired;
        bool emergencyWithdrawAllowed;
    }

    struct GroupConfig {
        string name;
        uint256 contributionAmount;
        uint256 maxMembers;
        uint256 startDate;
        uint256 endDate;
        string contributionFrequency;
        PunishmentAction punishmentMode;
        bool approvalRequired;
        bool emergencyWithdrawAllowed;
    }
    enum ProposalType {
    None,
    CancelPunishment
    }

    struct Proposal {
        ProposalType proposalType;
        address target;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 createdAt;
        bool executed;
        mapping(address => bool) hasVoted;
    }

}