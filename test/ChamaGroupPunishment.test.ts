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
        {  account: user1.account } 
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
        { account: user1.account }
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
        { account: user1.account }
      );
      await publicClient.waitForTransactionReceipt({hash: punishHash });
      const punishment2 = await group.read.getPunishmentDetails([user2.account.address]);
      console.log("Punishment:", punishment2);

      // Pay fine
      const payHash = await group.write.payFine( {
         account: user2 .account,
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
        {  account: user1.account } 
      );
      await publicClient.waitForTransactionReceipt({ hash });

      const member = await group.read.getMemberDetails([user2.account.address]) as [
         boolean, // exists
          boolean, // isActive
          bigint,  // joinedAt
          bigint,  // totalContributed
          bigint,  // missedContributions
          bigint   // consecutiveFines
        ];
      expect(member[1]).to.be.false; // isActive should be false
    });

    it("Should allow admins to cancel punishments", async function () {
      const { group, user1, user2, publicClient } = await loadFixture(setupGroupWithContributions);

      // Punish member
      const punishHash = await group.write.punishMember(
        [user2.account.address, 2, "Test punishment"], // Fine
        {  account: user1.account } 
      );
      await publicClient.waitForTransactionReceipt({ hash:punishHash });

      // Cancel punishment
      const cancelHash = await group.write.cancelPunishment([user2.account.address], {
        account: user1.account
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

  describe("Voting System for Punishment Cancellation", function () {
    it("Should allow members to propose canceling punishments", async function () {
      const { group, user1, user2, user3, publicClient } = await loadFixture(setupGroupWithContributions);

      // First, punish a member
      const punishHash = await group.write.punishMember(
        [user2.account.address, 2, "Test punishment"], // Fine
        { account: user1.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: punishHash });

      // Create proposal to cancel punishment using createProposal
      const proposeHash = await group.write.createProposal(
        [0, user2.account.address, 0n, "Cancel punishment for user2"], // ProposalType.CancelPunishment = 0
        { account: user3.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: proposeHash });

      // Verify proposal was created (proposalCounter should be 1)
      const proposalId = 1n;
      const proposal = await group.read.getProposalDetails([proposalId]);
      expect(proposal[0]).to.equal(0); // ProposalType.CancelPunishment
      expect(proposal[1]).to.equal(getAddress(user2.account.address)); // target
    });

    it("Should allow members to vote on proposals", async function () {
      const { group, user1, user2, user3, user4, publicClient } = await loadFixture(setupGroupWithContributions);

      // Punish member
      const punishHash = await group.write.punishMember(
        [user2.account.address, 3, "Ban test"], // Ban
        { account: user1.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: punishHash });

      // Create proposal
      const proposeHash = await group.write.createProposal(
        [0, user2.account.address, 0n, "Cancel ban for user2"], // ProposalType.CancelPunishment = 0
        { account: user3.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: proposeHash });

      const proposalId = 1n;

      // Vote in favor
      const voteHash1 = await group.write.voteOnProposal(
        [proposalId, true],
        { account: user3.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: voteHash1 });

      // Vote against
      const voteHash2 = await group.write.voteOnProposal(
        [proposalId, false],
        { account: user4.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: voteHash2 });

      // Check votes
      const proposal = await group.read.getProposalDetails([proposalId]);
      expect(proposal[4]).to.equal(1n); // votesFor
      expect(proposal[5]).to.equal(1n); // votesAgainst
    });

    it("Should prevent double voting on proposals", async function () {
      const { group, user1, user2, user3, publicClient } = await loadFixture(setupGroupWithContributions);

      // Punish member
      const punishHash = await group.write.punishMember(
        [user2.account.address, 2, "Test punishment"],
        { account: user1.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: punishHash });

      // Create proposal
      const proposeHash = await group.write.createProposal(
        [0, user2.account.address, 0n, "Cancel punishment for user2"],
        { account: user3.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: proposeHash });

      const proposalId = 1n;

      // First vote
      const voteHash1 = await group.write.voteOnProposal(
        [proposalId, true],
        { account: user3.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: voteHash1 });

      // Second vote should fail
      await expect(
        group.write.voteOnProposal(
          [proposalId, false],
          { account: user3.account }
        )
      ).to.be.rejectedWith("Already voted");
    });

it("Should execute successful proposals with sufficient votes", async function () {
  const { group, user1, user2, user3, user4, publicClient } = await loadFixture(setupGroupWithContributions);

  // Punish member
  const punishHash = await group.write.punishMember(
    [user2.account.address, 3, "Ban test"], // Ban
    { account: user1.account }
  );
  await publicClient.waitForTransactionReceipt({ hash: punishHash });

  // Verify member is banned
  let member = await group.read.getMemberDetails([user2.account.address]) as [
    boolean, boolean, bigint, bigint, bigint, bigint
  ];
  expect(member[1]).to.be.false; // isActive should be false

  // Create proposal
  const proposeHash = await group.write.createProposal(
    [0, user2.account.address, 0n, "Cancel ban for user2"],
    { account: user3.account }
  );
  await publicClient.waitForTransactionReceipt({ hash: proposeHash });

  const proposalId = 1n;

  // Get enough votes for proposal - include user1 (admin) vote
  const voteHash1 = await group.write.voteOnProposal(
    [proposalId, true],
    { account: user1.account } // Admin votes too
  );
  await publicClient.waitForTransactionReceipt({ hash: voteHash1 });

  const voteHash2 = await group.write.voteOnProposal(
    [proposalId, true],
    { account: user3.account }
  );
  await publicClient.waitForTransactionReceipt({ hash: voteHash2 });

  const voteHash3 = await group.write.voteOnProposal(
    [proposalId, true],
    { account: user4.account }
  );
  await publicClient.waitForTransactionReceipt({ hash: voteHash3 });

  // Wait for voting period to end (3 days)
  await (publicClient as any).request({
    method: "evm_increaseTime",
    params: [3 * 24 * 60 * 60 + 1], // 3 days and 1 second
  });

  await (publicClient as any).request({
    method: "evm_mine",
  });

  // Execute proposal
  const executeHash = await group.write.executeProposal(
    [proposalId],
    { account: user1.account }
  );
  await publicClient.waitForTransactionReceipt({ hash: executeHash });

  // Verify punishment is cancelled and member is reactivated
  const punishment = await group.read.getPunishmentDetails([user2.account.address]) as [
    number, string, boolean, bigint, bigint
  ];
  expect(punishment[2]).to.be.false; // isActive should be false

  member = await group.read.getMemberDetails([user2.account.address]) as [
    boolean, boolean, bigint, bigint, bigint, bigint
  ];
  expect(member[1]).to.be.true; // isActive should be true again
});
it("Should reject proposals with insufficient votes", async function () {
  const { group, user1, user2, user3, user4, user6, publicClient } = await loadFixture(setupGroupWithContributions);

  // Punish member
  const punishHash = await group.write.punishMember(
    [user2.account.address, 2, "Test punishment"],
    { account: user1.account }
  );
  await publicClient.waitForTransactionReceipt({ hash: punishHash });

  // Create proposal (by user1)
  const proposeHash = await group.write.createProposal(
    [0, user2.account.address, 0n, "Cancel punishment for user2"],
    { account: user1.account }
  );
  await publicClient.waitForTransactionReceipt({ hash: proposeHash });

  const proposalId = 1n;

  // Vote NO (user3, user4, user6)
  const voteHash1 = await group.write.voteOnProposal([proposalId, false], { account: user3.account });
  await publicClient.waitForTransactionReceipt({ hash: voteHash1 });

  const voteHash2 = await group.write.voteOnProposal([proposalId, false], { account: user4.account });
  await publicClient.waitForTransactionReceipt({ hash: voteHash2 });

  const voteHash3 = await group.write.voteOnProposal([proposalId, false], { account: user6.account });
  await publicClient.waitForTransactionReceipt({ hash: voteHash3 });

  // Wait for voting period to end
  await (publicClient as any).request({
    method: "evm_increaseTime",
    params: [3 * 24 * 60 * 60 + 1],
  });
  await (publicClient as any).request({ method: "evm_mine" });

  // Try to execute proposal — should be rejected
  await expect(
    group.write.executeProposal([proposalId], { account: user1.account })
  ).to.be.rejectedWith("Proposal rejected");
});


    it("Should reject proposals with insufficient participation", async function () {
      const { group, user1, user2, user3, publicClient } = await loadFixture(setupGroupWithContributions);

      // Punish member
      const punishHash = await group.write.punishMember(
        [user2.account.address, 2, "Test punishment"],
        { account: user1.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: punishHash });

      // Create proposal
      const proposeHash = await group.write.createProposal(
        [0, user2.account.address, 0n, "Cancel punishment for user2"],
        { account: user3.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: proposeHash });

      const proposalId = 1n;

      // Only one vote (insufficient participation for 50% quorum)
      const voteHash = await group.write.voteOnProposal(
        [proposalId, true],
        { account: user3.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: voteHash });

      // Wait for voting period to end
      await (publicClient as any).request({
        method: "evm_increaseTime",
        params: [3 * 24 * 60 * 60 + 1], // 3 days and 1 second
      });

      await (publicClient as any).request({
        method: "evm_mine",
      });

      // Try to execute proposal - should fail due to insufficient participation
      await expect(
        group.write.executeProposal(
          [proposalId],
          { account: user1.account }
        )
      ).to.be.rejectedWith("Insufficient participation");
    });

    it("Should prevent voting after voting period ends", async function () {
      const { group, user1, user2, user3, publicClient } = await loadFixture(setupGroupWithContributions);

      // Punish member
      const punishHash = await group.write.punishMember(
        [user2.account.address, 2, "Test punishment"],
        { account: user1.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: punishHash });

      // Create proposal
      const proposeHash = await group.write.createProposal(
        [0, user2.account.address, 0n, "Cancel punishment for user2"],
        { account: user3.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: proposeHash });

      const proposalId = 1n;

      // Wait for voting period to end
      await (publicClient as any).request({
        method: "evm_increaseTime",
        params: [3 * 24 * 60 * 60 + 1], // 3 days and 1 second
      });

      await (publicClient as any).request({
        method: "evm_mine",
      });

      // Try to vote after period ends - should fail
      await expect(
        group.write.voteOnProposal(
          [proposalId, true],
          { account: user3.account }
        )
      ).to.be.rejectedWith("Voting period over");
    });

    it("Should prevent execution during voting period", async function () {
      const { group, user1, user2, user3, publicClient } = await loadFixture(setupGroupWithContributions);

      // Punish member
      const punishHash = await group.write.punishMember(
        [user2.account.address, 2, "Test punishment"],
        { account: user1.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: punishHash });

      // Create proposal
      const proposeHash = await group.write.createProposal(
        [0, user2.account.address, 0n, "Cancel punishment for user2"],
        { account: user3.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: proposeHash });

      const proposalId = 1n;

      // Try to execute immediately - should fail
      await expect(
        group.write.executeProposal(
          [proposalId],
          { account: user1.account }
        )
      ).to.be.rejectedWith("Voting still active");
    });

   it("Should prevent double execution of proposals", async function () {
  const { group, user1, user2, user3, user4, user6, publicClient } = await loadFixture(setupGroupWithContributions);

  // Punish member
  const punishHash = await group.write.punishMember(
    [user2.account.address, 2, "Test punishment"],
    { account: user1.account }
  );
  await publicClient.waitForTransactionReceipt({ hash: punishHash });

  // Create proposal (by user1)
  const proposeHash = await group.write.createProposal(
    [0, user2.account.address, 0n, "Cancel punishment for user2"],
    { account: user1.account }
  );
  await publicClient.waitForTransactionReceipt({ hash: proposeHash });

  const proposalId = 1n;

  // Cast votes
  const voteHash1 = await group.write.voteOnProposal(
    [proposalId, true],
    { account: user1.account }
  );
  await publicClient.waitForTransactionReceipt({ hash: voteHash1 });

  const voteHash2 = await group.write.voteOnProposal(
    [proposalId, true],
    { account: user4.account }
  );
  await publicClient.waitForTransactionReceipt({ hash: voteHash2 });

  const voteHash3 = await group.write.voteOnProposal(
    [proposalId, true],
    { account: user6.account }
  );
  await publicClient.waitForTransactionReceipt({ hash: voteHash3 });

  // Wait for voting period to end
  await (publicClient as any).request({
    method: "evm_increaseTime",
    params: [3 * 24 * 60 * 60 + 1], // 3 days and 1 second
  });

  await (publicClient as any).request({ method: "evm_mine" });

  // Execute proposal
  const executeHash = await group.write.executeProposal(
    [proposalId],
    { account: user1.account }
  );
  await publicClient.waitForTransactionReceipt({ hash: executeHash });

  // Try to execute again - should fail
  await expect(
    group.write.executeProposal(
      [proposalId],
      { account: user1.account }
    )
  ).to.be.rejectedWith("Already executed");
});

  });
});