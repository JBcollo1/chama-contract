import { expect } from "chai";
import { getAddress, parseEther } from "viem";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import {
  deployFactoryFixture,
  ONE_WEEK_IN_SECS,
  ONE_MONTH_IN_SECS,
  DEFAULT_CONTRIBUTION,
} from "./fixtures/chamaFixtures";

describe("ChamaFactory", function () {
  describe("Deployment", function () {
    it("Should deploy with correct initial state", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);

      expect(await factory.read.owner()).to.equal(
        getAddress(owner.account.address)
      );
      expect(await factory.read.groupCounter()).to.equal(0n);
    });

    it("Should have correct constants", async function () {
      const { factory } = await loadFixture(deployFactoryFixture);

      expect(await factory.read.MAX_GROUPS_PER_CREATOR()).to.equal(10n);
      expect(await factory.read.MIN_CONTRIBUTION_AMOUNT()).to.equal(parseEther("0.001"));
      expect(await factory.read.MAX_CONTRIBUTION_AMOUNT()).to.equal(parseEther("100"));
      expect(await factory.read.MIN_MEMBERS()).to.equal(3n);
      expect(await factory.read.MAX_MEMBERS()).to.equal(100n);
    });
  });

  describe("Group Creation", function () {
    it("Should create a group with valid parameters", async function () {
      const { factory, user1, publicClient } = await loadFixture(deployFactoryFixture);

      const currentTime = BigInt(await time.latest());
        const groupConfig = {
        name: "Test Group",
        contributionAmount: DEFAULT_CONTRIBUTION,
        maxMembers: 5n,
        startDate: currentTime + BigInt(ONE_WEEK_IN_SECS),
        endDate: currentTime + BigInt(ONE_MONTH_IN_SECS * 3),
        contributionFrequency: "weekly",
        punishmentMode: 1,       
        approvalRequired: false,
        emergencyWithdrawAllowed: true,
        };


      const hash = await factory.write.createGroup([groupConfig], {
        account: user1.account,
        });

      await publicClient.waitForTransactionReceipt({ hash });

      expect(await factory.read.groupCounter()).to.equal(1n);
      
      const creatorGroups = await factory.read.getCreatorGroups([user1.account.address]);
      expect(creatorGroups).to.have.lengthOf(1);
    });

    it("Should emit GroupCreated event", async function () {
      const { factory, user1, publicClient } = await loadFixture(deployFactoryFixture);

      const currentTime = BigInt(await time.latest());
      const groupConfig = {
        name: "Test Group",
        contributionAmount: DEFAULT_CONTRIBUTION,
        maxMembers: 5n,
        startDate: currentTime + BigInt(ONE_WEEK_IN_SECS),
        endDate: currentTime + BigInt(ONE_MONTH_IN_SECS * 3),
        contributionFrequency: "weekly",
        punishmentMode: 0, // None
        approvalRequired: false,
        emergencyWithdrawAllowed: false,
      };

      const hash = await factory.write.createGroup([groupConfig], {
        account: user1.account,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const events = await factory.getEvents.GroupCreated();
      expect(events).to.have.lengthOf(1);
      
      const eventArgs = events[0].args as any;
      expect(eventArgs.creator).to.equal(getAddress(user1.account.address));
      expect(eventArgs.name).to.equal("Test Group");
    });

    it("Should reject invalid parameters", async function () {
      const { factory, user1 } = await loadFixture(deployFactoryFixture);

      const currentTime = BigInt(await time.latest());
      
      // Invalid name (empty)
      const invalidConfig1 = {
        name: "",
        contributionAmount: DEFAULT_CONTRIBUTION,
        maxMembers: 5n,
        startDate: currentTime + BigInt(ONE_WEEK_IN_SECS),
        endDate: currentTime + BigInt(ONE_MONTH_IN_SECS * 3),
        contributionFrequency: "weekly",
        punishmentMode: 0,
        approvalRequired: false,
        emergencyWithdrawAllowed: false,
      };

      await expect(
        factory.write.createGroup([invalidConfig1], {
          account: user1.account
        })
      ).to.be.rejectedWith("Invalid name length");

      // Invalid contribution amount (too low)
      const invalidConfig2 = {
        ...invalidConfig1,
        name: "Test Group",
        contributionAmount: parseEther("0.0001"),
      };

      await expect(
        factory.write.createGroup([invalidConfig2], {
          account: user1.account
        })
      ).to.be.rejectedWith("Invalid contribution amount");

      // Invalid max members (too few)
      const invalidConfig3 = {
        ...invalidConfig2,
        contributionAmount: DEFAULT_CONTRIBUTION,
        maxMembers: 1n,
      };

      await expect(
        factory.write.createGroup([invalidConfig3], {
          account: user1.account
        })
      ).to.be.rejectedWith("Invalid max members");
    });

    it("Should reject groups with start date in the past", async function () {
      const { factory, user1 } = await loadFixture(deployFactoryFixture);

      const currentTime = BigInt(await time.latest());
      const invalidConfig = {
        name: "Test Group",
        contributionAmount: DEFAULT_CONTRIBUTION,
        maxMembers: 5n,
        startDate: currentTime - BigInt(ONE_WEEK_IN_SECS), // Past date
        endDate: currentTime + BigInt(ONE_MONTH_IN_SECS * 3),
        contributionFrequency: "weekly",
        punishmentMode: 0,
        approvalRequired: false,
        emergencyWithdrawAllowed: false,
      };

      await expect(
        factory.write.createGroup([invalidConfig], {
          account: user1.account
        })
      ).to.be.rejectedWith("Start date must be in future");
    });
  });

  describe("Access Control", function () {
    it("Should allow owner to pause and unpause", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);

      await factory.write.pause({
        account: owner.account,
        });

      expect(await factory.read.paused()).to.be.true;

      await factory.write.unpause({
        account: owner.account,
      });
      expect(await factory.read.paused()).to.be.false;
    });

    it("Should reject non-owner pause attempts", async function () {
      const { factory, user1 } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.write.pause({
          account: user1.account,
        })
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");

    });
  });
});