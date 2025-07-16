import { expect } from "chai";
import { getAddress } from "viem";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { deployGroupFixture } from "./fixtures/chamaFixtures";

describe("ChamaGroup - Deployment", function () {
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
});