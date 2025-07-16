import { expect } from "chai";
import { getAddress } from "viem";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import {
  setupGroupWithContributions,
  FINE_AMOUNT,
} from "./fixtures/chamaFixtures";

describe("ChamaGroup - Punishment System", function () {
  describe("Punishment System", function () {
    it("Should allow admins to manually punish members", async function () {
      const { group, user1, user2, publicClient } = await loadFixture(setupGroupWithContributions);

      const hash = await group.write.punishMember(
        [user2.account.address, 2, "Test punishment"], // Fine
        { client: { wallet: user1 } }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const punishment = await group.read.getPunishmentDetails([user2.account.address])as [
        number,   
        string,  
        boolean, 
        bigint,   
        bigint    
        ];
      expect(punishment[0]).to.equal(2); // Fine
      expect(punishment[1]).to.equal("Test punishment");
      expect(punishment[2]).to.be.true; // isActive
      expect(punishment[4]).to.equal(FINE_AMOUNT); // fineAmount
    });

    it("Should emit MemberPunished event", async function () {
      const { group, user1, user2, publicClient } = await loadFixture(setupGroupWithContributions);

      const hash = await group.write.punishMember(
        [user2.account.address, 1, "Warning test"], // Warning
        { client: { wallet: user1 } }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const events = await group.getEvents.MemberPunished();
      expect(events).to.have.lengthOf(1);
      
      const eventArgs = events[0].args as any;
      expect(eventArgs.user).to.equal(getAddress(user2.account.address));
      expect(eventArgs.reason).to.equal("Warning test");
      expect(eventArgs.action).to.equal(1); // Warning
    });

    it("Should allow members to pay fines", async function () {
      const { group, user1, user2, publicClient } = await loadFixture(setupGroupWithContributions);

      // Punish with fine
      const punishHash = await group.write.punishMember(
        [user2.account.address, 2, "Fine test"], // Fine
        { client: { wallet: user1 } }
      );
      await publicClient.waitForTransactionReceipt({hash: punishHash });

      // Pay fine
      const payHash = await group.write.payFine([], {
        client: { wallet: user2 },
        value: FINE_AMOUNT
      });
      await publicClient.waitForTransactionReceipt({hash: payHash });

      const punishment = await group.read.getPunishmentDetails([user2.account.address]) as [
        number,   
        string,  
        boolean, 
        bigint,   
        bigint    
        ];
      expect(punishment[2]).to.be.false; // isActive should be false
    });

    it("Should ban members and deactivate them", async function () {
      const { group, user1, user2, publicClient } = await loadFixture(setupGroupWithContributions);

      const hash = await group.write.punishMember(
        [user2.account.address, 3, "Ban test"], // Ban
        { client: { wallet: user1 } }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const member = await group.read.getMemberDetails([user2.account.address]) as [
        boolean,
        boolean,
        bigint,
        bigint,
        bigint
        ];
      expect(member[1]).to.be.false; // isActive should be false
    });

    it("Should allow admins to cancel punishments", async function () {
      const { group, user1, user2, publicClient } = await loadFixture(setupGroupWithContributions);

      // Punish member
      const punishHash = await group.write.punishMember(
        [user2.account.address, 2, "Test punishment"], // Fine
        { client: { wallet: user1 } }
      );
      await publicClient.waitForTransactionReceipt({ hash:punishHash });

      // Cancel punishment
      const cancelHash = await group.write.cancelPunishment([user2.account.address], {
        client: { wallet: user1 }
      });
      await publicClient.waitForTransactionReceipt({ hash:cancelHash });

      const punishment = await group.read.getPunishmentDetails([user2.account.address])as [
        number,   
        string,  
        boolean, 
        bigint,   
        bigint    
        ];
      expect(punishment[2]).to.be.false; // isActive should be false
    });
  });
});