import { expect } from "chai";
import { getAddress } from "viem";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import {
  setupGroupWithMembers,
  ONE_WEEK_IN_SECS,
} from "./fixtures/chamaFixtures";

describe("ChamaGroup - Contributions", function () {
  describe("Contributions", function () {
    it("Should allow members to contribute correct amount", async function () {
      const { group, user2, publicClient, groupConfig } = await loadFixture(setupGroupWithMembers);

      const hash = await group.write.contribute([], {
        client: { wallet: user2 },
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const member = await group.read.getMemberDetails([user2.account.address]);
      expect(member[3]).to.equal(groupConfig.contributionAmount); // totalContributed

      expect(await group.read.totalFunds()).to.equal(groupConfig.contributionAmount);
    });

    it("Should emit ContributionMade event", async function () {
      const { group, user2, publicClient, groupConfig } = await loadFixture(setupGroupWithMembers);

      const hash = await group.write.contribute([], {
        client: { wallet: user2 },
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const events = await group.getEvents.ContributionMade();
      expect(events).to.have.lengthOf(1);
      
      const eventArgs = events[0].args as any;
      expect(eventArgs.user).to.equal(getAddress(user2.account.address));
      expect(eventArgs.amount).to.equal(groupConfig.contributionAmount);
    });

    it("Should reject incorrect contribution amounts", async function () {
      const { group, user2, groupConfig } = await loadFixture(setupGroupWithMembers);

      await expect(
        group.write.contribute([], {
          client: { wallet: user2 },
          value: groupConfig.contributionAmount - 1n
        })
      ).to.be.rejectedWith("Incorrect contribution amount");

      await expect(
        group.write.contribute([], {
          client: { wallet: user2 },
          value: groupConfig.contributionAmount + 1n
        })
      ).to.be.rejectedWith("Incorrect contribution amount");
    });

    it("Should reject duplicate contributions in same period", async function () {
      const { group, user2, publicClient, groupConfig } = await loadFixture(setupGroupWithMembers);

      // First contribution
      const hash1 = await group.write.contribute([], {
        client: { wallet: user2 },
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash1 });

      // Second contribution in same period
      await expect(
        group.write.contribute([], {
          client: { wallet: user2 },
          value: groupConfig.contributionAmount
        })
      ).to.be.rejectedWith("Already contributed this period");
    });

    it("Should allow contributions in different periods", async function () {
      const { group, user2, publicClient, groupConfig } = await loadFixture(setupGroupWithMembers);

      // First contribution
      const hash1 = await group.write.contribute([], {
        client: { wallet: user2 },
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash1 });

      // Move to next period (1 week later)
      await time.increase(ONE_WEEK_IN_SECS);

      // Second contribution in new period
      const hash2 = await group.write.contribute([], {
        client: { wallet: user2 },
        value: groupConfig.contributionAmount
      });
      await publicClient.waitForTransactionReceipt({ hash2 });

      const member = await group.read.getMemberDetails([user2.account.address]);
      expect(member[3]).to.equal(groupConfig.contributionAmount * 2n); // totalContributed
    });
  });
});