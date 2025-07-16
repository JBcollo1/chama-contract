import { expect } from "chai";
import { getAddress } from "viem";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import hre from "hardhat";
import {
  deployFactoryFixture,
  deployGroupFixture,
  ONE_WEEK_IN_SECS,
  ONE_MONTH_IN_SECS,
  DEFAULT_CONTRIBUTION,
} from "./fixtures/chamaFixtures";

describe("ChamaGroup - Member Management", function () {
  describe("Member Management", function () {
    it("Should allow members to join when group is active", async function () {
      const { group, user2, publicClient, startDate } = await loadFixture(deployGroupFixture);

      // Fast forward to start date
      await time.increaseTo(startDate);

      const hash = await group.write.joinGroup([], { client: { wallet: user2 } });
      await publicClient.waitForTransactionReceipt({ hash });

      expect(await group.read.memberCount()).to.equal(1n);
      const member = await group.read.getMemberDetails([user2.account.address]) as [ boolean, 
        boolean, 
        bigint,  
        bigint,
        bigint   
        ];
      expect(member[0]).to.be.true; // exists
      expect(member[1]).to.be.true; // isActive
    });

    it("Should emit MemberJoined event", async function () {
      const { group, user2, publicClient, startDate } = await loadFixture(deployGroupFixture);

      await time.increaseTo(startDate);

      const hash = await group.write.joinGroup([], { client: { wallet: user2 } });
      await publicClient.waitForTransactionReceipt({ hash });

      const events = await group.getEvents.MemberJoined();
      expect(events).to.have.lengthOf(1);
      
      const eventArgs = events[0].args as any;
      expect(eventArgs.user).to.equal(getAddress(user2.account.address));
    });

    it("Should reject duplicate member joins", async function () {
      const { group, user2, publicClient, startDate } = await loadFixture(deployGroupFixture);

      await time.increaseTo(startDate);

      // First join
      const hash = await group.write.joinGroup([], { client: { wallet: user2 } });
      await publicClient.waitForTransactionReceipt({ hash });

      // Second join attempt
      await expect(
        group.write.joinGroup([], { client: { wallet: user2 } })
      ).to.be.rejectedWith("Already a member");
    });

    it("Should reject joins when group is full", async function () {
      const { factory, user1, user2, user3, user4, publicClient } = 
        await loadFixture(deployFactoryFixture);

      const currentTime = BigInt(await time.latest());
      const startDate = currentTime + BigInt(ONE_WEEK_IN_SECS);
      const endDate = startDate + BigInt(ONE_MONTH_IN_SECS * 6);

      // Create group with max 2 members
      const groupConfig = {
        name: "Small Group",
        contributionAmount: DEFAULT_CONTRIBUTION,
        maxMembers: 2n,
        startDate,
        endDate,
        contributionFrequency: "weekly",
        punishmentMode: 0,
        approvalRequired: false,
        emergencyWithdrawAllowed: false,
      };

      const hash = await factory.write.createGroup([groupConfig], {
        client: { wallet: user1 }
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const groupEvents = await factory.getEvents.GroupCreated();
      const latestEvent = groupEvents[groupEvents.length - 1];
      const groupAddress = (latestEvent.args as any).groupAddress;
      const group = await hre.viem.getContractAt("ChamaGroup", groupAddress);

      await time.increaseTo(startDate);

      // Add 2 members
      await group.write.joinGroup([], { client: { wallet: user2 } });
      await group.write.joinGroup([], { client: { wallet: user3 } });

      // Third member should be rejected
      await expect(
        group.write.joinGroup([], { client: { wallet: user4 } })
      ).to.be.rejectedWith("Group is full");
    });

    it("Should handle approval-required groups", async function () {
      const { factory, user1, user2, user3, publicClient } = 
        await loadFixture(deployFactoryFixture);

      const currentTime = BigInt(await time.latest());
      const startDate = currentTime + BigInt(ONE_WEEK_IN_SECS);
      const endDate = startDate + BigInt(ONE_MONTH_IN_SECS * 6);

      // Create group with approval required
      const groupConfig = {
        name: "Approval Group",
        contributionAmount: DEFAULT_CONTRIBUTION,
        maxMembers: 5n,
        startDate,
        endDate,
        contributionFrequency: "weekly",
        punishmentMode: 0,
        approvalRequired: true,
        emergencyWithdrawAllowed: false,
      };

      const hash = await factory.write.createGroup([groupConfig], {
        client: { wallet: user1 }
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const groupEvents = await factory.getEvents.GroupCreated();
      const latestEvent = groupEvents[groupEvents.length - 1];
      const groupAddress = (latestEvent.args as any).groupAddress;
      const group = await hre.viem.getContractAt("ChamaGroup", groupAddress);

      await time.increaseTo(startDate);

      // Submit join request
      const joinHash = await group.write.joinGroup([], { client: { wallet: user2 } });
      await publicClient.waitForTransactionReceipt({ hash : joinHash });

      // Should not be a member yet
      expect(await group.read.memberCount()).to.equal(0n);

      // Admin approves
      const approveHash = await group.write.approveJoinRequest([user2.account.address], {
        client: { wallet: user1 }
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      // Now should be a member
      expect(await group.read.memberCount()).to.equal(1n);
    });
  });
});