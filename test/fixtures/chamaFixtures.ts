import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import hre from "hardhat";
import { parseEther } from "viem";

// Constants
export const ONE_WEEK_IN_SECS = 7 * 24 * 60 * 60;
export const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;
export const MIN_CONTRIBUTION = parseEther("0.001");
export const DEFAULT_CONTRIBUTION = parseEther("0.1");
export const FINE_AMOUNT = parseEther("0.01");

// Fixtures
export async function deployFactoryFixture() {
  const [owner, user1, user2, user3, user4, user6] = await hre.viem.getWalletClients();
  const factory = await hre.viem.deployContract("ChamaFactory", [owner.account.address]);
  const publicClient = await hre.viem.getPublicClient();

  return {
    factory,
    owner,
    user1,
    user2,
    user3,
    user4,
    user6,
    publicClient,
  };
}

// Helper to build a valid group config
function buildGroupConfig({
  creator,
  startDate,
  endDate,
}: {
  creator: `0x${string}`;
  startDate: bigint;
  endDate: bigint;
}) {
  return {
    name: "Test Chama Group",
    contributionAmount: DEFAULT_CONTRIBUTION,
    maxMembers: 10n,
    startDate,
    endDate,
    contributionFrequency: "weekly",
    punishmentMode: 2, // Fine
    approvalRequired: false,
    emergencyWithdrawAllowed: true,
    creator,
    contributionToken: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    gracePeriod: 86400n, // 1 day
    contributionWindow: 3600n, // 1 hour
  };
}

export async function deployGroupFixture() {
  const { factory, owner, user1, user2, user3, user4, user6, publicClient } =
    await loadFixture(deployFactoryFixture);

  const currentTime = BigInt(await time.latest());
  const startDate = currentTime + BigInt(ONE_WEEK_IN_SECS);
  const endDate = startDate + BigInt(ONE_MONTH_IN_SECS * 6); // 6 months

  const groupConfig = buildGroupConfig({
    creator: user1.account.address as `0x${string}`,
    startDate,
    endDate,
  });

  const hash = await factory.write.createGroup([groupConfig], {
    account: user1.account,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  const groupEvents = await factory.getEvents.GroupCreated();
  const latestEvent = groupEvents[groupEvents.length - 1];
  const groupAddress = (latestEvent.args as any).groupAddress;
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
    user6,
    publicClient,
    startDate,
    endDate,
  };
}

export async function setupGroupWithMembers() {
  const fixture = await loadFixture(deployGroupFixture);
  const { group, user1, user2, user3,user4, publicClient, startDate } = fixture;

  await time.increaseTo(startDate);

  // Add members and wait for confirmations
  const tx1 = await group.write.joinGroup({ account: user1.account });
  await publicClient.waitForTransactionReceipt({ hash: tx1 });

  const tx2 = await group.write.joinGroup({ account: user2.account });
  await publicClient.waitForTransactionReceipt({ hash: tx2 });

  const tx3 = await group.write.joinGroup({ account: user3.account });
  await publicClient.waitForTransactionReceipt({ hash: tx3 });

  const tx4 = await group.write.joinGroup({ account: user4.account });
  await publicClient.waitForTransactionReceipt({ hash: tx4 });

  return { ...fixture, members: [user1, user2, user3,user4] };
}

export async function setupGroupWithContributions() {
  const fixture = await setupGroupWithMembers();
  const { group,user1, user2, user3, user4, publicClient, groupConfig } = fixture;

  // Both members contribute in first period
   await group.write.contribute( {
    account: user1.account,
    value: groupConfig.contributionAmount
  });
  await group.write.contribute( {
    account: user2.account,
    value: groupConfig.contributionAmount
  });
  await group.write.contribute( {
    account: user3.account,
    value: groupConfig.contributionAmount
  });
  await group.write.contribute( {
    account: user4.account,
    value: groupConfig.contributionAmount
  });
  return fixture;
}