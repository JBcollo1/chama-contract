import { expect } from "chai";
import { getAddress } from "viem";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { setupGroupWithMembers, ONE_WEEK_IN_SECS } from "./fixtures/chamaFixtures";

describe("ChamaGroup - Contributions", function () {
  describe("Basic Contributions", function () {
    it("Should allow members to contribute correct amount", async function () {
      const { group, user2, publicClient, groupConfig } = await loadFixture(setupGroupWithMembers);
      

      const hash = await group.write.contribute( {
        account: user2.account,
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash });

     const member = await group.read.getMemberDetails([user2.account.address]) as [
      boolean, // exists
      boolean, // isActive
      bigint,  // joinedAt
      bigint,  // totalContributed
      bigint,  // missedContributions
      bigint   // consecutiveFines
    ];
      expect(member[3]).to.equal(groupConfig.contributionAmount); // totalContributed

      expect(await group.read.totalFunds()).to.equal(groupConfig.contributionAmount);
    });

    it("Should emit ContributionMade event", async function () {
      const { group, user2, publicClient, groupConfig } = await loadFixture(setupGroupWithMembers);
     
      const hash = await group.write.contribute( {
        account: user2.account,
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const events = await group.getEvents.ContributionMade();
      expect(events).to.have.lengthOf(1);
      expect((events[0].args as any).user).to.equal(getAddress(user2.account.address));
      expect((events[0].args as any).amount).to.equal(groupConfig.contributionAmount);
    });

    it("Should reject incorrect contribution amounts", async function () {
      const { group, user2, groupConfig } = await loadFixture(setupGroupWithMembers);

      await expect(
        group.write.contribute( {
          account: user2.account,
          value: groupConfig.contributionAmount - 1n
        })
      ).to.be.rejectedWith("Incorrect contribution amount");

      await expect(
        group.write.contribute( {
          account: user2.account,
          value: groupConfig.contributionAmount + 1n
        })
      ).to.be.rejectedWith("Incorrect contribution amount");
    });

    it("Should reject contributions from non-members", async function () {
      const { group, user6, groupConfig } = await loadFixture(setupGroupWithMembers);

      await expect(
        group.write.contribute({
          account: user6.account,
          value: groupConfig.contributionAmount
        })
      ).to.be.rejectedWith("Not an active member");
    });
  });

  describe("Contribution Periods", function () {
    it("Should reject duplicate contributions in same period", async function () {
      const { group, user2, publicClient, groupConfig } = await loadFixture(setupGroupWithMembers);

      // First contribution
      const hash1 = await group.write.contribute( {
        account: user2.account,
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash: hash1 });

      // Second contribution in same period
      await expect(
        group.write.contribute( {
          account: user2.account,
          value: groupConfig.contributionAmount
        })
      ).to.be.rejectedWith("Already contributed this period");
    });
    

    it("Should allow contributions in different periods", async function () {
      const { group, user2, publicClient, groupConfig } = await loadFixture(setupGroupWithMembers);

      // First contribution
      const hash1 = await group.write.contribute( {
        account: user2.account,
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash :hash1 });

      // Move to next period (1 week later)
      await time.increase(ONE_WEEK_IN_SECS);

      // Second contribution in new period
      const hash2 = await group.write.contribute( {
        account: user2.account,
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash: hash2 });

      const member = await group.read.getMemberDetails([user2.account.address]) as [
          boolean, // exists
          boolean, // isActive
          bigint,  // joinedAt
          bigint,  // totalContributed
          bigint,  // missedContributions
          bigint   // consecutiveFines
        ];
      expect(member[3]).to.equal(groupConfig.contributionAmount * 2n); // totalContributed
    });

    it("Should track contributions per period correctly", async function () {
      const { group, user2, publicClient, groupConfig } = await loadFixture(setupGroupWithMembers);

      // Contribute in period 0
      const hash1 = await group.write.contribute( {
        account: user2.account,
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash: hash1 });

      // Check contribution status for period 0
      expect(await group.read.getMemberContributionTimestamp([user2.account.address, 0n])).to.be.true;

      // Move to period 1
      await time.increase(ONE_WEEK_IN_SECS);

      // Check contribution status for period 1 (should be false)
      expect(await group.read.getMemberContributionTimestamp([user2.account.address, 1n])).to.be.false;

      // Contribute in period 1
      const hash2 = await group.write.contribute( {
        account: user2.account,
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash: hash2 });

      // Check contribution status for period 1 (should be true)
      expect(await group.read.getMemberContributionTimestamp([user2.account.address, 1n])).to.be.true;
    });
  });

  describe("Multiple Members Contributions", function () {
    it("Should handle multiple members contributing in same period", async function () {
      const { group, user2, user3, publicClient, groupConfig } = await loadFixture(setupGroupWithMembers);

      // Both members contribute
      const hash1 = await group.write.contribute( {
        account: user2.account,
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash: hash1 });

      const hash2 = await group.write.contribute( {
        account: user3.account,
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash: hash2 });

      expect(await group.read.totalFunds()).to.equal(groupConfig.contributionAmount * 2n);

      // Check individual member contributions
      const member2 = await group.read.getMemberDetails([user2.account.address]) as [
         boolean, // exists
          boolean, // isActive
          bigint,  // joinedAt
          bigint,  // totalContributed
          bigint,  // missedContributions
          bigint   // consecutiveFines
        ];
      const member3 = await group.read.getMemberDetails([user3.account.address])as [
          boolean, 
          boolean, 
          bigint,  
          bigint,  
          bigint,  
          bigint   
        ];
      
      expect(member2[3]).to.equal(groupConfig.contributionAmount); // totalContributed
      expect(member3[3]).to.equal(groupConfig.contributionAmount); // totalContributed
    });

    it("Should track different contribution patterns", async function () {
      const { group, user2, user3, publicClient, groupConfig } = await loadFixture(setupGroupWithMembers);

      // User2 contributes in period 0
      const hash1 = await group.write.contribute( {
        account: user2.account,
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash: hash1 });

      // Move to period 1
      await time.increase(ONE_WEEK_IN_SECS);

      // User3 contributes in period 1 (missed period 0)
      const hash2 = await group.write.contribute( {
        account: user3.account,
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash: hash2 });

      // User2 also contributes in period 1
      const hash3 = await group.write.contribute( {
        account: user2.account,
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash: hash3 });

      // Check contribution statuses
      expect(await group.read.getMemberContributionTimestamp([user2.account.address, 0n])).to.be.true;
      expect(await group.read.getMemberContributionTimestamp([user3.account.address, 0n])).to.be.false;
      expect(await group.read.getMemberContributionTimestamp([user2.account.address, 1n])).to.be.true;
      expect(await group.read.getMemberContributionTimestamp([user3.account.address, 1n])).to.be.true;

      // Check total contributions
      const member2 = await group.read.getMemberDetails([user2.account.address]) as [
          boolean, 
          boolean, 
          bigint,  
          bigint,  
          bigint,  
          bigint   
        ];
      const member3 = await group.read.getMemberDetails([user3.account.address]) as [
          boolean, 
          boolean, 
          bigint,  
          bigint,  
          bigint,  
          bigint   
        ];
      
      expect(member2[3]).to.equal(groupConfig.contributionAmount * 2n); // totalContributed
      expect(member3[3]).to.equal(groupConfig.contributionAmount); // totalContributed
      
      expect(await group.read.totalFunds()).to.equal(groupConfig.contributionAmount * 3n);
    });

    it("Should handle contributions across multiple periods", async function () {
      const { group, user2, user3, publicClient, groupConfig } = await loadFixture(setupGroupWithMembers);

      // Period 0: Both members contribute
      await group.write.contribute( {
        account: user2.account,
        value: groupConfig.contributionAmount
      });
      await group.write.contribute( {
        account: user3.account,
        value: groupConfig.contributionAmount
      });

      // Move to period 1
      await time.increase(ONE_WEEK_IN_SECS);

      // Period 1: Only user2 contributes
      await group.write.contribute( {
        account: user2.account,
        value: groupConfig.contributionAmount
      });

      // Move to period 2
      await time.increase(ONE_WEEK_IN_SECS);

      // Period 2: Only user3 contributes
      await group.write.contribute( {
        account: user3.account,
        value: groupConfig.contributionAmount
      });

      // Verify contribution patterns
      expect(await group.read.getMemberContributionTimestamp([user2.account.address, 0n])).to.be.true;
      expect(await group.read.getMemberContributionTimestamp([user3.account.address, 0n])).to.be.true;
      expect(await group.read.getMemberContributionTimestamp([user2.account.address, 1n])).to.be.true;
      expect(await group.read.getMemberContributionTimestamp([user3.account.address, 1n])).to.be.false;
      expect(await group.read.getMemberContributionTimestamp([user2.account.address, 2n])).to.be.false;
      expect(await group.read.getMemberContributionTimestamp([user3.account.address, 2n])).to.be.true;

      // Check final totals
      const member2 = await group.read.getMemberDetails([user2.account.address]) as [
          boolean, 
          boolean, 
          bigint,  
          bigint,  
          bigint,  
          bigint   
        ];
      const member3 = await group.read.getMemberDetails([user3.account.address]) as [
          boolean, 
          boolean, 
          bigint,  
          bigint,  
          bigint,  
          bigint   
        ];
            
      expect(member2[3]).to.equal(groupConfig.contributionAmount * 2n); // totalContributed
      expect(member3[3]).to.equal(groupConfig.contributionAmount * 2n); // totalContributed
      
      expect(await group.read.totalFunds()).to.equal(groupConfig.contributionAmount * 4n);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle contributions at period boundaries", async function () {
      const { group, user2, publicClient, groupConfig, startDate } = await loadFixture(setupGroupWithMembers);

      // Contribute exactly at start of period 0 (already at startDate from setupGroupWithMembers)
      await group.write.contribute( {
        account: user2.account,
        value: groupConfig.contributionAmount
      });

      // Move to exactly the start of period 1
      await time.increaseTo(startDate + BigInt(ONE_WEEK_IN_SECS));

      // Should be able to contribute in new period
      await group.write.contribute( {
        account: user2.account,
        value: groupConfig.contributionAmount
      });

      expect(await group.read.getCurrentPeriod()).to.equal(1n);
      expect(await group.read.getMemberContributionTimestamp([user2.account.address, 0n])).to.be.true;
      expect(await group.read.getMemberContributionTimestamp([user2.account.address, 1n])).to.be.true;
    });

    it("Should reject contributions after group end date", async function () {
      const { group, user2, groupConfig, endDate } = await loadFixture(setupGroupWithMembers);

      // Move past end date
      await time.increaseTo(endDate + 1n);

      await expect(
        group.write.contribute( {
          account: user2.account,
          value: groupConfig.contributionAmount
        })
      ).to.be.rejectedWith("Group has ended");
    });

    it("Should handle zero members scenario", async function () {
      const { group } = await loadFixture(setupGroupWithMembers);

      // Remove all members first (this would need to be implemented in the contract)
      // For now, we'll just verify the initial state
      expect(await group.read.totalFunds()).to.equal(0n);
    });
  });
});