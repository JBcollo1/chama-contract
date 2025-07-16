import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther } from "viem";

describe("Chama Contracts", function () {
  // Constants
  const ONE_WEEK_IN_SECS = 7 * 24 * 60 * 60;
  const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;
  const MIN_CONTRIBUTION = parseEther("0.001");
  const DEFAULT_CONTRIBUTION = parseEther("0.1");
  const FINE_AMOUNT = parseEther("0.01");

  // Fixtures
  async function deployFactoryFixture() {
    const [owner, user1, user2, user3, user4] = await hre.viem.getWalletClients();

    const factory = await hre.viem.deployContract("ChamaFactory", []);
    const publicClient = await hre.viem.getPublicClient();

    return {
      factory,
      owner,
      user1,
      user2,
      user3,
      user4,
      publicClient,
    };
  }

  async function deployGroupFixture() {
    const { factory, owner, user1, user2, user3, user4, publicClient } = 
      await loadFixture(deployFactoryFixture);

    const currentTime = BigInt(await time.latest());
    const startDate = currentTime + BigInt(ONE_WEEK_IN_SECS);
    const endDate = startDate + BigInt(ONE_MONTH_IN_SECS * 6); // 6 months

    const groupConfig = {
      name: "Test Chama Group",
      contributionAmount: DEFAULT_CONTRIBUTION,
      maxMembers: 10n,
      startDate,
      endDate,
      contributionFrequency: "weekly",
      punishmentMode: 2, // Fine
      approvalRequired: false,
      emergencyWithdrawAllowed: true,
    };

    // Create group
    const hash = await factory.write.createGroup([groupConfig], {
      client: { wallet: user1 }
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Get the created group address
    const groupEvents = await factory.getEvents.GroupCreated();
    const groupAddress = groupEvents[groupEvents.length - 1].args.groupAddress;

    const group = await hre.viem.getContractAt("ChamaGroup", groupAddress);

    return {
      factory,
      group,
      groupAddress,
      groupConfig,
      owner,
      user1,
      user2,
      user3,
      user4,
      publicClient,
      startDate,
      endDate,
    };
  }

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
          punishmentMode: 1, // Warning
          approvalRequired: false,
          emergencyWithdrawAllowed: true,
        };

        const hash = await factory.write.createGroup([groupConfig], {
          client: { wallet: user1 }
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
          client: { wallet: user1 }
        });
        await publicClient.waitForTransactionReceipt({ hash });

        const events = await factory.getEvents.GroupCreated();
        expect(events).to.have.lengthOf(1);
        expect(events[0].args.creator).to.equal(getAddress(user1.account.address));
        expect(events[0].args.name).to.equal("Test Group");
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
            client: { wallet: user1 }
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
            client: { wallet: user1 }
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
            client: { wallet: user1 }
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
            client: { wallet: user1 }
          })
        ).to.be.rejectedWith("Start date must be in future");
      });
    });

    describe("Access Control", function () {
      it("Should allow owner to pause and unpause", async function () {
        const { factory, owner } = await loadFixture(deployFactoryFixture);

        await factory.write.pause({ client: { wallet: owner } });
        expect(await factory.read.paused()).to.be.true;

        await factory.write.unpause({ client: { wallet: owner } });
        expect(await factory.read.paused()).to.be.false;
      });

      it("Should reject non-owner pause attempts", async function () {
        const { factory, user1 } = await loadFixture(deployFactoryFixture);

        await expect(
          factory.write.pause({ client: { wallet: user1 } })
        ).to.be.rejectedWith("Ownable: caller is not the owner");
      });
    });
  });

  describe("ChamaGroup", function () {
    describe("Deployment", function () {
      it("Should deploy with correct initial state", async function () {
        const { group, user1, groupConfig } = await loadFixture(deployGroupFixture);

        expect(await group.read.creator()).to.equal(
          getAddress(user1.account.address)
        );
        expect(await group.read.memberCount()).to.equal(0n);
        expect(await group.read.isActive()).to.be.true;
        expect(await group.read.totalFunds()).to.equal(0n);

        const rules = await group.read.rules();
        expect(rules.name).to.equal(groupConfig.name);
        expect(rules.contributionAmount).to.equal(groupConfig.contributionAmount);
        expect(rules.maxMembers).to.equal(groupConfig.maxMembers);
      });

      it("Should set creator as admin", async function () {
        const { group, user1 } = await loadFixture(deployGroupFixture);

        expect(await group.read.admins([user1.account.address])).to.be.true;
      });
    });

    describe("Member Management", function () {
      it("Should allow members to join when group is active", async function () {
        const { group, user2, publicClient, startDate } = await loadFixture(deployGroupFixture);

        // Fast forward to start date
        await time.increaseTo(startDate);

        const hash = await group.write.joinGroup({ client: { wallet: user2 } });
        await publicClient.waitForTransactionReceipt({ hash });

        expect(await group.read.memberCount()).to.equal(1n);
        const member = await group.read.getMemberDetails([user2.account.address]);
        expect(member[0]).to.be.true; // exists
        expect(member[1]).to.be.true; // isActive
      });

      it("Should emit MemberJoined event", async function () {
        const { group, user2, publicClient, startDate } = await loadFixture(deployGroupFixture);

        await time.increaseTo(startDate);

        const hash = await group.write.joinGroup({ client: { wallet: user2 } });
        await publicClient.waitForTransactionReceipt({ hash });

        const events = await group.getEvents.MemberJoined();
        expect(events).to.have.lengthOf(1);
        expect(events[0].args.user).to.equal(getAddress(user2.account.address));
      });

      it("Should reject duplicate member joins", async function () {
        const { group, user2, publicClient, startDate } = await loadFixture(deployGroupFixture);

        await time.increaseTo(startDate);

        // First join
        const hash = await group.write.joinGroup({ client: { wallet: user2 } });
        await publicClient.waitForTransactionReceipt({ hash });

        // Second join attempt
        await expect(
          group.write.joinGroup({ client: { wallet: user2 } })
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
        const groupAddress = groupEvents[groupEvents.length - 1].args.groupAddress;
        const group = await hre.viem.getContractAt("ChamaGroup", groupAddress);

        await time.increaseTo(startDate);

        // Add 2 members
        await group.write.joinGroup({ client: { wallet: user2 } });
        await group.write.joinGroup({ client: { wallet: user3 } });

        // Third member should be rejected
        await expect(
          group.write.joinGroup({ client: { wallet: user4 } })
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
        const groupAddress = groupEvents[groupEvents.length - 1].args.groupAddress;
        const group = await hre.viem.getContractAt("ChamaGroup", groupAddress);

        await time.increaseTo(startDate);

        // Submit join request
        const joinHash = await group.write.joinGroup({ client: { wallet: user2 } });
        await publicClient.waitForTransactionReceipt({ joinHash });

        // Should not be a member yet
        expect(await group.read.memberCount()).to.equal(0n);

        // Admin approves
        const approveHash = await group.write.approveJoinRequest([user2.account.address], {
          client: { wallet: user1 }
        });
        await publicClient.waitForTransactionReceipt({ approveHash });

        // Now should be a member
        expect(await group.read.memberCount()).to.equal(1n);
      });
    });

    describe("Contributions", function () {
      async function setupGroupWithMembers() {
        const fixture = await loadFixture(deployGroupFixture);
        const { group, user2, user3, publicClient, startDate } = fixture;

        await time.increaseTo(startDate);

        // Add members
        await group.write.joinGroup({ client: { wallet: user2 } });
        await group.write.joinGroup({ client: { wallet: user3 } });

        return { ...fixture, members: [user2, user3] };
      }

      it("Should allow members to contribute correct amount", async function () {
        const { group, user2, publicClient, groupConfig } = await setupGroupWithMembers();

        const hash = await group.write.contribute({
          client: { wallet: user2 },
          value: groupConfig.contributionAmount
        });
        await publicClient.waitForTransactionReceipt({ hash });

        const member = await group.read.getMemberDetails([user2.account.address]);
        expect(member[3]).to.equal(groupConfig.contributionAmount); // totalContributed

        expect(await group.read.totalFunds()).to.equal(groupConfig.contributionAmount);
      });

      it("Should emit ContributionMade event", async function () {
        const { group, user2, publicClient, groupConfig } = await setupGroupWithMembers();

        const hash = await group.write.contribute({
          client: { wallet: user2 },
          value: groupConfig.contributionAmount
        });
        await publicClient.waitForTransactionReceipt({ hash });

        const events = await group.getEvents.ContributionMade();
        expect(events).to.have.lengthOf(1);
        expect(events[0].args.user).to.equal(getAddress(user2.account.address));
        expect(events[0].args.amount).to.equal(groupConfig.contributionAmount);
      });

      it("Should reject incorrect contribution amounts", async function () {
        const { group, user2, groupConfig } = await setupGroupWithMembers();

        await expect(
          group.write.contribute({
            client: { wallet: user2 },
            value: groupConfig.contributionAmount - 1n
          })
        ).to.be.rejectedWith("Incorrect contribution amount");

        await expect(
          group.write.contribute({
            client: { wallet: user2 },
            value: groupConfig.contributionAmount + 1n
          })
        ).to.be.rejectedWith("Incorrect contribution amount");
      });

      it("Should reject duplicate contributions in same period", async function () {
        const { group, user2, publicClient, groupConfig } = await setupGroupWithMembers();

        // First contribution
        const hash1 = await group.write.contribute({
          client: { wallet: user2 },
          value: groupConfig.contributionAmount
        });
        await publicClient.waitForTransactionReceipt({ hash1 });

        // Second contribution in same period
        await expect(
          group.write.contribute({
            client: { wallet: user2 },
            value: groupConfig.contributionAmount
          })
        ).to.be.rejectedWith("Already contributed this period");
      });

      it("Should allow contributions in different periods", async function () {
        const { group, user2, publicClient, groupConfig } = await setupGroupWithMembers();

        // First contribution
        const hash1 = await group.write.contribute({
          client: { wallet: user2 },
          value: groupConfig.contributionAmount
        });
        await publicClient.waitForTransactionReceipt({ hash1 });

        // Move to next period (1 week later)
        await time.increase(ONE_WEEK_IN_SECS);

        // Second contribution in new period
        const hash2 = await group.write.contribute({
          client: { wallet: user2 },
          value: groupConfig.contributionAmount
        });
        await publicClient.waitForTransactionReceipt({ hash2 });

        const member = await group.read.getMemberDetails([user2.account.address]);
        expect(member[3]).to.equal(groupConfig.contributionAmount * 2n); // totalContributed
      });
    });

    describe("Punishment System", function () {
      async function setupGroupWithContributions() {
        const fixture = await setupGroupWithMembers();
        const { group, user2, user3, publicClient, groupConfig } = fixture;

        // Both members contribute in first period
        await group.write.contribute({
          client: { wallet: user2 },
          value: groupConfig.contributionAmount
        });
        await group.write.contribute({
          client: { wallet: user3 },
          value: groupConfig.contributionAmount
        });

        return fixture;
      }

      it("Should allow admins to manually punish members", async function () {
        const { group, user1, user2, publicClient } = await setupGroupWithContributions();

        const hash = await group.write.punishMember(
          [user2.account.address, 2, "Test punishment"], // Fine
          { client: { wallet: user1 } }
        );
        await publicClient.waitForTransactionReceipt({ hash });

        const punishment = await group.read.getPunishmentDetails([user2.account.address]);
        expect(punishment[0]).to.equal(2); // Fine
        expect(punishment[1]).to.equal("Test punishment");
        expect(punishment[2]).to.be.true; // isActive
        expect(punishment[4]).to.equal(FINE_AMOUNT); // fineAmount
      });

      it("Should emit MemberPunished event", async function () {
        const { group, user1, user2, publicClient } = await setupGroupWithContributions();

        const hash = await group.write.punishMember(
          [user2.account.address, 1, "Warning test"], // Warning
          { client: { wallet: user1 } }
        );
        await publicClient.waitForTransactionReceipt({ hash });

        const events = await group.getEvents.MemberPunished();
        expect(events).to.have.lengthOf(1);
        expect(events[0].args.user).to.equal(getAddress(user2.account.address));
        expect(events[0].args.reason).to.equal("Warning test");
        expect(events[0].args.action).to.equal(1); // Warning
      });

      it("Should allow members to pay fines", async function () {
        const { group, user1, user2, publicClient } = await setupGroupWithContributions();

        // Punish with fine
        const punishHash = await group.write.punishMember(
          [user2.account.address, 2, "Fine test"], // Fine
          { client: { wallet: user1 } }
        );
        await publicClient.waitForTransactionReceipt({ punishHash });

        // Pay fine
        const payHash = await group.write.payFine({
          client: { wallet: user2 },
          value: FINE_AMOUNT
        });
        await publicClient.waitForTransactionReceipt({ payHash });

        const punishment = await group.read.getPunishmentDetails([user2.account.address]);
        expect(punishment[2]).to.be.false; // isActive should be false
      });

      it("Should ban members and deactivate them", async function () {
        const { group, user1, user2, publicClient } = await setupGroupWithContributions();

        const hash = await group.write.punishMember(
          [user2.account.address, 3, "Ban test"], // Ban
          { client: { wallet: user1 } }
        );
        await publicClient.waitForTransactionReceipt({ hash });

        const member = await group.read.getMemberDetails([user2.account.address]);
        expect(member[1]).to.be.false; // isActive should be false
      });

      it("Should allow admins to cancel punishments", async function () {
        const { group, user1, user2, publicClient } = await setupGroupWithContributions();

        // Punish member
        const punishHash = await group.write.punishMember(
          [user2.account.address, 2, "Test punishment"], // Fine
          { client: { wallet: user1 } }
        );
        await publicClient.waitForTransactionReceipt({ punishHash });

        // Cancel punishment
        const cancelHash = await group.write.cancelPunishment([user2.account.address], {
          client: { wallet: user1 }
        });
        await publicClient.waitForTransactionReceipt({ cancelHash });

        const punishment = await group.read.getPunishmentDetails([user2.account.address]);
        expect(punishment[2]).to.be.false; // isActive should be false
      });
    });

    describe("Admin Functions", function () {
      it("Should allow creator to add admins", async function () {
        const { group, user1, user2, publicClient } = await loadFixture(deployGroupFixture);

        const hash = await group.write.addAdmin([user2.account.address], {
          client: { wallet: user1 }
        });
        await publicClient.waitForTransactionReceipt({ hash });

        expect(await group.read.admins([user2.account.address])).to.be.true;
      });

      it("Should allow creator to remove admins", async function () {
        const { group, user1, user2, publicClient } = await loadFixture(deployGroupFixture);

        // Add admin first
        await group.write.addAdmin([user2.account.address], {
          client: { wallet: user1 }
        });

        // Remove admin
        const hash = await group.write.removeAdmin([user2.account.address], {
          client: { wallet: user1 }
        });
        await publicClient.waitForTransactionReceipt({ hash });

        expect(await group.read.admins([user2.account.address])).to.be.false;
      });

      it("Should not allow creator to remove themselves", async function () {
        const { group, user1 } = await loadFixture(deployGroupFixture);

        await expect(
          group.write.removeAdmin([user1.account.address], {
            client: { wallet: user1 }
          })
        ).to.be.rejectedWith("Cannot remove creator");
      });

      it("Should allow emergency withdraw when enabled", async function () {
        const { group, user1, user2, publicClient, groupConfig, startDate } = 
          await loadFixture(deployGroupFixture);

        await time.increaseTo(startDate);

        // Add member and make contribution
        await group.write.joinGroup({ client: { wallet: user2 } });
        await group.write.contribute({
          client: { wallet: user2 },
          value: groupConfig.contributionAmount
        });

        const initialBalance = await group.read.getBalance();
        expect(initialBalance).to.equal(groupConfig.contributionAmount);

        // Emergency withdraw
        const hash = await group.write.triggerEmergencyWithdraw({
          client: { wallet: user1 }
        });
        await publicClient.waitForTransactionReceipt({ hash });

        expect(await group.read.getBalance()).to.equal(0n);
        expect(await group.read.totalFunds()).to.equal(0n);
      });
    });

    describe("Utility Functions", function () {
      it("Should correctly calculate current period", async function () {
        const { group, startDate } = await loadFixture(deployGroupFixture);

        // Before start
        expect(await group.read.getCurrentPeriod()).to.equal(0n);

        // At start
        await time.increaseTo(startDate);
        expect(await group.read.getCurrentPeriod()).to.equal(0n);

        // One week later
        await time.increase(ONE_WEEK_IN_SECS);
        expect(await group.read.getCurrentPeriod()).to.equal(1n);

        // Two weeks later
        await time.increase(ONE_WEEK_IN_SECS);
        expect(await group.read.getCurrentPeriod()).to.equal(2n);
      });

      it("Should track member contribution status", async function () {
        const { group, user2, publicClient, groupConfig, startDate } = 
          await loadFixture(deployGroupFixture);

        await time.increaseTo(startDate);
        await group.write.joinGroup({ client: { wallet: user2 } });

        // Check initial status
        expect(await group.read.getMemberContributionStatus([user2.account.address, 0n])).to.be.false;

        // Make contribution
        await group.write.contribute({
          client: { wallet: user2 },
          value: groupConfig.contributionAmount
        });

        // Check updated status
        expect(await group.read.getMemberContributionStatus([user2.account.address, 0n])).to.be.true;
      });
    });

    describe("Access Control", function () {
      it("Should restrict admin functions to admins only", async function () {
        const { group, user2, user3 } = await loadFixture(deployGroupFixture);

        await expect(
          group.write.punishMember([user3.account.address, 1, "Test"], {
            client: { wallet: user2 }
          })
        ).to.be.rejectedWith("Not admin");

        await expect(
          group.write.addAdmin([user3.account.address], {
            client: { wallet: user2 }
          })
        ).to.be.rejectedWith("Only creator can add admins");

        await expect(
          group.write.triggerEmergencyWithdraw({
            client: { wallet: user2 }
          })
        ).to.be.rejectedWith("Not admin");
      });

      it("Should restrict member functions to active members", async function () {
        const { group, user2, groupConfig } = await loadFixture(deployGroupFixture);

        await expect(
          group.write.contribute({
            client: { wallet: user2 },
            value: groupConfig.contributionAmount
          })
        ).to.be.rejectedWith("Not an active member");
      });

      it("Should allow admins to pause and unpause", async function () {
        const { group, user1 } = await loadFixture(deployGroupFixture);

        await group.write.pause({ client: { wallet: user1 } });
        expect(await group.read.paused()).to.be.true;

        await group.write.unpause({ client: { wallet: user1 } });
        expect(await group.read.paused()).to.be.false;
      });
    });
  });
});