import { expect } from "chai";
import { getAddress, parseEther, zeroAddress } from "viem";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import hre from "hardhat";
import {
  deployFactoryFixture,
  deployGroupFixture,
  setupGroupWithMembers,
  setupGroupWithContributions,
  ONE_WEEK_IN_SECS,
  ONE_MONTH_IN_SECS,
  DEFAULT_CONTRIBUTION,
  FINE_AMOUNT,
} from "./fixtures/chamaFixtures";

describe("Enhanced ChamaGroup Features", function () {
  
  // Note: Token support tests are commented out since the factory doesn't support token parameters yet
  // These tests would work once the factory is updated to support token-based group creation
  
  describe("Token Support (Future Enhancement)", function () {
    it.skip("Should create token-based group correctly", async function () {
      // This test would work once factory supports token parameters
      // const { group, mockToken } = await loadFixture(deployTokenBasedGroupFixture);
      // expect(await group.read.isTokenBased()).to.be.true;
      // expect(await group.read.contributionToken()).to.equal(getAddress(mockToken.address));
    });

    it.skip("Should handle token contributions", async function () {
      // Token contribution tests would go here
    });

    it.skip("Should reject ETH when token-based", async function () {
      // ETH rejection tests for token-based groups
    });

    it.skip("Should handle token-based fine payments", async function () {
      // Token fine payment tests
    });
  });

  describe("Member Payout History Tracking", function () {
    it("Should track member payout periods", async function () {
      const { group, user1, user2, user3, user4, publicClient, startDate } = await setupGroupWithContributions();

      // Set payout queue
      await group.write.setPayoutQueue([[user1.account.address, user2.account.address, user3.account.address, user4.account.address]], { 
        account: user1.account 
      });

      // Process first payout
      await group.write.processRotationPayout({ account: user1.account });

      const payoutHistory = await group.read.getMemberPayoutHistory([user1.account.address]);
      expect(payoutHistory).to.have.lengthOf(1);
      expect(payoutHistory[0]).to.equal(0n); // First period
    });

    it("Should track multiple payouts for rotating members", async function () {
      const { group, user1, user2, user3, user4, publicClient, startDate, groupConfig } = await setupGroupWithContributions();

      await group.write.setPayoutQueue([[user1.account.address, user2.account.address, user3.account.address, user4.account.address]], { 
        account: user1.account 
      });

      // Process first period payout
      await group.write.processRotationPayout({ account: user1.account });

      // Move to next period and contribute
      await time.increase(ONE_WEEK_IN_SECS);
      
      await group.write.contribute({ account: user1.account, value: groupConfig.contributionAmount });
      await group.write.contribute({ account: user2.account, value: groupConfig.contributionAmount });
      await group.write.contribute({ account: user3.account, value: groupConfig.contributionAmount });
      await group.write.contribute({ account: user4.account, value: groupConfig.contributionAmount });

      // Process second period payout (should go to user2)
      await group.write.processRotationPayout({ account: user1.account });

      const user1History = await group.read.getMemberPayoutHistory([user1.account.address]);
      const user2History = await group.read.getMemberPayoutHistory([user2.account.address]);

      expect(user1History).to.have.lengthOf(1);
      expect(user2History).to.have.lengthOf(1);
      expect(user2History[0]).to.equal(1n); // Second period
    });
  });

  describe("Contribution Deadline and Grace Period", function () {
    it("Should respect contribution windows", async function () {
      const { group, user1, user2, startDate, groupConfig } = await setupGroupWithMembers();

      // Move to middle of contribution window
      await time.increaseTo(startDate + BigInt(3 * 24 * 60 * 60)); // 3 days after start

      expect(await group.read.isContributionWindowOpen()).to.be.true;

      await group.write.contribute({ account: user1.account, value: groupConfig.contributionAmount });
    });

    it("Should reject contributions outside window + grace period", async function () {
      const { group, user1, startDate, groupConfig } = await setupGroupWithMembers();

      // Move past contribution window + grace period (5 + 2 = 7 days)
      await time.increaseTo(startDate + BigInt(8 * 24 * 60 * 60));

      expect(await group.read.isContributionWindowOpen()).to.be.false;

      await expect(
        group.write.contribute({ account: user1.account, value: groupConfig.contributionAmount })
      ).to.be.rejectedWith("Contribution window closed");
    });

    it("Should track contribution timestamps", async function () {
      const { group, user1, startDate, groupConfig } = await setupGroupWithMembers();

      const contributionTime = startDate + BigInt(2 * 24 * 60 * 60);
      await time.increaseTo(contributionTime);

      await group.write.contribute({ account: user1.account, value: groupConfig.contributionAmount });

      const timestamp = await group.read.getMemberContributionTimestamp([user1.account.address, 0n]);
      expect(timestamp).to.be.greaterThan(0n);
    });
  });

  describe("Rotation Skipping for Punished Members", function () {
    it("Should skip banned members and adjust rotation", async function () {
      const { group, user1, user2, user3, user4, startDate, groupConfig } = await setupGroupWithContributions();

      await group.write.setPayoutQueue([[user1.account.address, user2.account.address, user3.account.address, user4.account.address]], { 
        account: user1.account 
      });

      // Ban user1 (first in queue)
      await group.write.punishMember([user1.account.address, 1, "Test ban"], { account: user1.account }); // 1 = Ban

      // Process payout - should skip user1 and go to user2
      await group.write.processRotationPayout({ account: user1.account });

      const payoutInfo = await group.read.getPayoutInfo([0n]);
      expect(payoutInfo[0]).to.equal(getAddress(user2.account.address)); // recipient should be user2
      expect(payoutInfo[3]).to.be.true; // wasSkipped should be true

      expect(await group.read.skippedPayouts()).to.equal(1n);
    });

    it("Should record skipped payout information", async function () {
      const { group, user1, user2, user3, user4, startDate, groupConfig } = await setupGroupWithContributions();

      await group.write.setPayoutQueue([[user1.account.address, user2.account.address, user3.account.address, user4.account.address]], { 
        account: user1.account 
      });

      // Fine user1 (first in queue) - should skip
      await group.write.punishMember([user1.account.address, 2, "Test fine"], { account: user1.account }); // 2 = Fine

      await group.write.processRotationPayout({ account: user1.account });

      const payoutInfo = await group.read.getPayoutInfo([0n]);
      expect(payoutInfo[3]).to.be.true; // wasSkipped
    });
  });

  describe("Group Exit and Refund System", function () {
    it("Should allow member to leave before receiving payout", async function () {
      const { group, user1, user2, startDate, groupConfig } = await setupGroupWithMembers();

      // Contribute
      await group.write.contribute({ account: user2.account, value: groupConfig.contributionAmount });

      const initialBalance = await hre.viem.getPublicClient().getBalance({ address: user2.account.address });

      // Leave group
      const hash = await group.write.leaveGroup({ account: user2.account });
      const receipt = await hre.viem.getPublicClient().waitForTransactionReceipt({ hash });

      const finalBalance = await hre.viem.getPublicClient().getBalance({ address: user2.account.address });
      
      // Should get refund (minus gas costs)
      expect(finalBalance).to.be.greaterThan(initialBalance - parseEther("0.01")); // Accounting for gas

      expect(await group.read.getActiveMemberCount()).to.equal(3n); // One less active member
    });

    it("Should not allow refund after receiving payout", async function () {
      const { group, user1, user2, user3, user4, startDate, groupConfig } = await setupGroupWithContributions();

      await group.write.setPayoutQueue([[user1.account.address, user2.account.address, user3.account.address, user4.account.address]], { 
        account: user1.account 
      });

      // Process payout to user1
      await group.write.processRotationPayout({ account: user1.account });

      // user1 tries to leave after receiving payout
      const initialBalance = await hre.viem.getPublicClient().getBalance({ address: user1.account.address });
      await group.write.leaveGroup({ account: user1.account });
      const finalBalance = await hre.viem.getPublicClient().getBalance({ address: user1.account.address });

      // Should get no refund (only gas cost difference)
      expect(finalBalance).to.be.lessThan(initialBalance);
    });

    it("Should not allow leaving with active punishment", async function () {
      const { group, user1, user2, startDate } = await setupGroupWithMembers();

      // Punish user2
      await group.write.punishMember([user2.account.address, 2, "Test punishment"], { account: user1.account });

      await expect(
        group.write.leaveGroup({ account: user2.account })
      ).to.be.rejectedWith("Cannot leave with active punishment");
    });
  });

  describe("Enhanced Proposal System", function () {
    it("Should create and execute admin addition proposal", async function () {
      const { group, user1, user2, user3, user4, startDate } = await setupGroupWithMembers();

      // Create proposal to add user2 as admin
      const proposalId = await group.write.createProposal([
        1, // AddAdmin
        user2.account.address,
        0n,
        "Add user2 as admin"
      ], { account: user1.account });

      // All members vote
      await group.write.voteOnProposal([1n, true], { account: user1.account });
      await group.write.voteOnProposal([1n, true], { account: user2.account });
      await group.write.voteOnProposal([1n, true], { account: user3.account });

      // Wait for voting period to end
      await time.increase(3 * 24 * 60 * 60 + 1); // 3 days + 1 second

      // Execute proposal
      await group.write.executeProposal([1n], { account: user1.account });

      expect(await group.read.admins([user2.account.address])).to.be.true;
    });

    it("Should create and execute member kick proposal", async function () {
      const { group, user1, user2, user3, user4, startDate } = await setupGroupWithMembers();

      // Create proposal to kick user4
      await group.write.createProposal([
        3, // KickMember
        user4.account.address,
        0n,
        "Kick inactive member"
      ], { account: user1.account });

      // Get enough votes
      await group.write.voteOnProposal([1n, true], { account: user1.account });
      await group.write.voteOnProposal([1n, true], { account: user2.account });
      await group.write.voteOnProposal([1n, true], { account: user3.account });

      await time.increase(3 * 24 * 60 * 60 + 1);

      await group.write.executeProposal([1n], { account: user1.account });

      const memberDetails = await group.read.getMemberDetails([user4.account.address]);
      expect(memberDetails[1]).to.be.false; // isActive should be false
      expect(await group.read.getActiveMemberCount()).to.equal(3n);
    });

    it("Should reject proposal with insufficient quorum", async function () {
      const { group, user1, user2, startDate } = await setupGroupWithMembers();

      await group.write.createProposal([
        1, // AddAdmin
        user2.account.address,
        0n,
        "Add admin with low participation"
      ], { account: user1.account });

      // Only one vote (insufficient for 50% quorum)
      await group.write.voteOnProposal([1n, true], { account: user1.account });

      await time.increase(3 * 24 * 60 * 60 + 1);

      await expect(
        group.write.executeProposal([1n], { account: user1.account })
      ).to.be.rejectedWith("Insufficient participation");
    });

    it("Should reject proposal with more against votes", async function () {
      const { group, user1, user2, user3, user4, startDate } = await setupGroupWithMembers();

      await group.write.createProposal([
        1, // AddAdmin
        user2.account.address,
        0n,
        "Controversial admin addition"
      ], { account: user1.account });

      // More against than for
      await group.write.voteOnProposal([1n, true], { account: user1.account });
      await group.write.voteOnProposal([1n, false], { account: user2.account });
      await group.write.voteOnProposal([1n, false], { account: user3.account });
      await group.write.voteOnProposal([1n, false], { account: user4.account });

      await time.increase(3 * 24 * 60 * 60 + 1);

      await expect(
        group.write.executeProposal([1n], { account: user1.account })
      ).to.be.rejectedWith("Proposal rejected");
    });
  });

  describe("Edge Cases", function () {
    describe("Payout Edge Cases", function () {
      it("Should handle case when all members are banned", async function () {
        const { group, user1, user2, user3, user4, startDate, groupConfig } = await setupGroupWithContributions();

        await group.write.setPayoutQueue([[user1.account.address, user2.account.address, user3.account.address, user4.account.address]], { 
          account: user1.account 
        });

        // Ban all members except creator
        await group.write.punishMember([user2.account.address, 1, "Ban"], { account: user1.account });
        await group.write.punishMember([user3.account.address, 1, "Ban"], { account: user1.account });
        await group.write.punishMember([user4.account.address, 1, "Ban"], { account: user1.account });

        // Creator bans themselves (edge case)
        await group.write.punishMember([user1.account.address, 1, "Self ban"], { account: user1.account });

        // Should revert when trying to process payout with no eligible recipients
        await expect(
          group.write.processRotationPayout({ account: user1.account })
        ).to.be.rejectedWith("No eligible recipients");
      });

      it("Should handle members who haven't contributed", async function () {
        const { group, user1, user2, user3, user4, startDate, groupConfig } = await setupGroupWithMembers();

        await group.write.setPayoutQueue([[user1.account.address, user2.account.address, user3.account.address, user4.account.address]], { 
          account: user1.account 
        });

        // Only some members contribute
        await group.write.contribute({ account: user1.account, value: groupConfig.contributionAmount });
        await group.write.contribute({ account: user2.account, value: groupConfig.contributionAmount });
        // user3 and user4 don't contribute

        await expect(
          group.write.processRotationPayout({ account: user1.account })
        ).to.be.rejectedWith("Member has not contributed yet");
      });
    });

    describe("Contribution Edge Cases", function () {
      it("Should reject wrong contribution amount", async function () {
        const { group, user1, startDate, groupConfig } = await setupGroupWithMembers();

        await expect(
          group.write.contribute({ 
            account: user1.account, 
            value: groupConfig.contributionAmount + parseEther("0.01") 
          })
        ).to.be.rejectedWith("Incorrect contribution amount");
      });

      it("Should reject multiple contributions in same period", async function () {
        const { group, user1, startDate, groupConfig } = await setupGroupWithMembers();

        await group.write.contribute({ account: user1.account, value: groupConfig.contributionAmount });

        await expect(
          group.write.contribute({ account: user1.account, value: groupConfig.contributionAmount })
        ).to.be.rejectedWith("Already contributed this period");
      });
    });

    describe("Voting Edge Cases", function () {
      it("Should prevent voting after voting period ends", async function () {
        const { group, user1, user2, startDate } = await setupGroupWithMembers();

        await group.write.createProposal([
          1, // AddAdmin
          user2.account.address,
          0n,
          "Test proposal"
        ], { account: user1.account });

        // Wait for voting period to end
        await time.increase(3 * 24 * 60 * 60 + 1);

        await expect(
          group.write.voteOnProposal([1n, true], { account: user1.account })
        ).to.be.rejectedWith("Voting period over");
      });

      it("Should prevent double voting", async function () {
        const { group, user1, user2, startDate } = await setupGroupWithMembers();

        await group.write.createProposal([
          1, // AddAdmin
          user2.account.address,
          0n,
          "Test proposal"
        ], { account: user1.account });

        await group.write.voteOnProposal([1n, true], { account: user1.account });

        await expect(
          group.write.voteOnProposal([1n, false], { account: user1.account })
        ).to.be.rejectedWith("Already voted");
      });

      it("Should prevent executing proposal during voting period", async function () {
        const { group, user1, user2, startDate } = await setupGroupWithMembers();

        await group.write.createProposal([
          1, // AddAdmin
          user2.account.address,
          0n,
          "Test proposal"
        ], { account: user1.account });

        await group.write.voteOnProposal([1n, true], { account: user1.account });

        await expect(
          group.write.executeProposal([1n], { account: user1.account })
        ).to.be.rejectedWith("Voting still active");
      });
    });

    describe("Access Control Edge Cases", function () {
      it("Should prevent non-admin from processing payouts", async function () {
        const { group, user1, user2, startDate } = await setupGroupWithContributions();

        await expect(
          group.write.processRotationPayout({ account: user2.account })
        ).to.be.rejectedWith("Not admin");
      });

      it("Should prevent creator from removing themselves as admin through proposal", async function () {
        const { group, user1, user2, user3, user4, startDate } = await setupGroupWithMembers();

        await group.write.createProposal([
          2, // RemoveAdmin
          user1.account.address, // Creator trying to remove themselves
          0n,
          "Remove creator as admin"
        ], { account: user2.account });

        // Get enough votes
        await group.write.voteOnProposal([1n, true], { account: user1.account });
        await group.write.voteOnProposal([1n, true], { account: user2.account });
        await group.write.voteOnProposal([1n, true], { account: user3.account });

        await time.increase(3 * 24 * 60 * 60 + 1);

        // Should fail when trying to execute
        await expect(
          group.write.executeProposal([1n], { account: user1.account })
        ).to.be.rejectedWith("Cannot remove creator");
      });
    });
  });

  describe("Creator Transfer", function () {
    it("Should allow creator to transfer role", async function () {
      const { group, user1, user2, startDate } = await setupGroupWithMembers();

      await group.write.transferCreator([user2.account.address], { account: user1.account });

      expect(await group.read.creator()).to.equal(getAddress(user2.account.address));
      expect(await group.read.admins([user2.account.address])).to.be.true;
    });

    it("Should reject transfer to zero address", async function () {
      const { group, user1, startDate } = await setupGroupWithMembers();

      await expect(
        group.write.transferCreator([zeroAddress], { account: user1.account })
      ).to.be.rejectedWith("Invalid address");
    });

    it("Should reject non-creator transfer attempts", async function () {
      const { group, user1, user2, startDate } = await setupGroupWithMembers();

      await expect(
        group.write.transferCreator([user2.account.address], { account: user2.account })
      ).to.be.rejectedWith("Only creator");
    });
  });
});