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
        punishmentMode: 1, // e.g. PunishmentAction.Fine
        approvalRequired: false,
        emergencyWithdrawAllowed: true,
        creator: user1.account.address as `0x${string}`,
        contributionToken: "0x0000000000000000000000000000000000000000" as `0x${string}`, // use zero address for native
        gracePeriod: 86400n, // 1 day
        contributionWindow: 3600n, // 1 hour
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
        punishmentMode: 0,
        approvalRequired: false,
        emergencyWithdrawAllowed: false,
        creator: user1.account.address as `0x${string}`,
        contributionToken: "0x0000000000000000000000000000000000000000" as `0x${string}`, // use zero address for native
        gracePeriod: 86400n, // 1 day
        contributionWindow: 3600n, // 1 hour
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

      const invalidName = {
        name: "",
        contributionAmount: DEFAULT_CONTRIBUTION,
        maxMembers: 5n,
        startDate: currentTime + BigInt(ONE_WEEK_IN_SECS),
        endDate: currentTime + BigInt(ONE_MONTH_IN_SECS * 3),
        contributionFrequency: "weekly",
        punishmentMode: 0,
        approvalRequired: false,
        emergencyWithdrawAllowed: false,
        creator: user1.account.address as `0x${string}`,
        contributionToken: "0x0000000000000000000000000000000000000000" as `0x${string}`, // use zero address for native
        gracePeriod: 86400n, // 1 day
        contributionWindow: 3600n, // 1 hour
      };

      await expect(
        factory.write.createGroup([invalidName], { account: user1.account })
      ).to.be.rejectedWith("Invalid name length");

      const invalidAmount = { ...invalidName, name: "Group A", contributionAmount: parseEther("0.0001") };

      await expect(
        factory.write.createGroup([invalidAmount], { account: user1.account })
      ).to.be.rejectedWith("Invalid contribution amount");

      const invalidMembers = { ...invalidAmount, contributionAmount: DEFAULT_CONTRIBUTION, maxMembers: 2n };

      await expect(
        factory.write.createGroup([invalidMembers], { account: user1.account })
      ).to.be.rejectedWith("Invalid max members");
    });

    it("Should reject start date in the past", async function () {
      const { factory, user1 } = await loadFixture(deployFactoryFixture);

      const currentTime = BigInt(await time.latest());

      const invalidStart = {
        name: "Group Late",
        contributionAmount: DEFAULT_CONTRIBUTION,
        maxMembers: 5n,
        startDate: currentTime - BigInt(ONE_WEEK_IN_SECS),
        endDate: currentTime + BigInt(ONE_MONTH_IN_SECS * 3),
        contributionFrequency: "weekly",
        punishmentMode: 0,
        approvalRequired: false,
        emergencyWithdrawAllowed: false,
        creator: user1.account.address as `0x${string}`,
        contributionToken: "0x0000000000000000000000000000000000000000" as `0x${string}`, // use zero address for native
        gracePeriod: 86400n, // 1 day
        contributionWindow: 3600n, // 1 hour
      };

      await expect(
        factory.write.createGroup([invalidStart], { account: user1.account })
      ).to.be.rejectedWith("Start date must be in future");
    });

    it("Should not allow creation when paused", async function () {
      const { factory, user1, owner } = await loadFixture(deployFactoryFixture);

      await factory.write.pause({ account: owner.account });

      const currentTime = BigInt(await time.latest());

      const config = {
        name: "Paused Group",
        contributionAmount: DEFAULT_CONTRIBUTION,
        maxMembers: 5n,
        startDate: currentTime + BigInt(ONE_WEEK_IN_SECS),
        endDate: currentTime + BigInt(ONE_MONTH_IN_SECS * 3),
        contributionFrequency: "weekly",
        punishmentMode: 0,
        approvalRequired: false,
        emergencyWithdrawAllowed: false,
        creator: user1.account.address as `0x${string}`,
        contributionToken: "0x0000000000000000000000000000000000000000" as `0x${string}`, // use zero address for native
        gracePeriod: 86400n, // 1 day
        contributionWindow: 3600n, // 1 hour
      };

      await expect(
        factory.write.createGroup([config], { account: user1.account })
      ).to.be.rejectedWith("Pausable: paused");
    });

    it("Should reject creator exceeding group limit", async function () {
      const { factory, user1, publicClient } = await loadFixture(deployFactoryFixture);

      const currentTime = BigInt(await time.latest());

      for (let i = 0; i < 10; i++) {
        const config = {
          name: `Group ${i}`,
          contributionAmount: DEFAULT_CONTRIBUTION,
          maxMembers: 5n,
          startDate: currentTime + BigInt(ONE_WEEK_IN_SECS),
          endDate: currentTime + BigInt(ONE_MONTH_IN_SECS * 3),
          contributionFrequency: "weekly",
          punishmentMode: 1,
          approvalRequired: false,
          emergencyWithdrawAllowed: true,          creator: user1.account.address as `0x${string}`,
          contributionToken: "0x0000000000000000000000000000000000000000" as `0x${string}`, // use zero address for native
          gracePeriod: 86400n, // 1 day
          contributionWindow: 3600n, // 1 hour
          
        };

        const hash = await factory.write.createGroup([config], {
          account: user1.account,
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }

      const overflow = {
        ...{
          name: "Overflow Group",
          contributionAmount: DEFAULT_CONTRIBUTION,
          maxMembers: 5n,
          startDate: currentTime + BigInt(ONE_WEEK_IN_SECS),
          endDate: currentTime + BigInt(ONE_MONTH_IN_SECS * 3),
          contributionFrequency: "weekly",
          punishmentMode: 1,
          approvalRequired: false,
          emergencyWithdrawAllowed: true,
          creator: user1.account.address as `0x${string}`,
          contributionToken: "0x0000000000000000000000000000000000000000" as `0x${string}`, // use zero address for native
          gracePeriod: 86400n, // 1 day
          contributionWindow: 3600n, // 1 hour
        },
      };

      await expect(
        factory.write.createGroup([overflow], {
          account: user1.account,
        })
      ).to.be.rejectedWith("Max groups per creator reached");
    });
  });

  describe("Access Control", function () {
    it("Should allow owner to pause and unpause", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);

      await factory.write.pause({ account: owner.account });
      expect(await factory.read.paused()).to.be.true;

      await factory.write.unpause({ account: owner.account });
      expect(await factory.read.paused()).to.be.false;
    });

    it("Should reject pause attempts by non-owner", async function () {
      const { factory, user1 } = await loadFixture(deployFactoryFixture);

      await expect(
        factory.write.pause({ account: user1.account })
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });
  });
});
