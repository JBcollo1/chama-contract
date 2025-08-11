import hre from "hardhat";
import { parseEther, zeroAddress, decodeEventLog, parseAbi } from "viem";

async function main() {
  console.log("Getting client and accounts...");
  
  const publicClient = await hre.viem.getPublicClient();
  const [walletClient] = await hre.viem.getWalletClients();
  
  console.log("Wallet address:", walletClient.account.address);

  const now = Math.floor(Date.now() / 1000);

  const config = {
    name: "My First Chama Group",
    contributionAmount: parseEther("0.01"),
    maxMembers: 10n,
    startDate: BigInt(now + 3600),
    endDate: BigInt(now + 30 * 24 * 60 * 60),
    contributionFrequency: "weekly",
    punishmentMode: 0,
    approvalRequired: true,
    emergencyWithdrawAllowed: false,
    creator: walletClient.account.address,
    contributionToken: zeroAddress,
    gracePeriod: 86400n,
    contributionWindow: 172800n
  };

  console.log("Getting contract instance...");
  const factory = await hre.viem.getContractAt(
    "ChamaFactory",
    "0xca0009AF8E28ccfeAA5bB314fD32856B3d278BF7"
  );

  console.log("Creating group...");
  const txHash = await factory.write.createGroup([config]);
  console.log("Transaction sent:", txHash);

  const receipt = await publicClient.waitForTransactionReceipt({ 
    hash: txHash 
  });
  console.log("Transaction confirmed in block:", receipt.blockNumber);

  // Define the GroupCreated event ABI for manual decoding
  const groupCreatedAbi = parseAbi([
    'event GroupCreated(address indexed creator, address indexed groupAddress, string name, uint256 contributionAmount, uint256 maxMembers)'
  ]);

  // The correct GroupCreated event signature from your contract
  const groupCreatedSignature = '0xdabfbddd3c17390733a672db1121758da191fc5b5ce4a81a1bbe0d8ab456ff63';

  console.log("Looking for GroupCreated events...");
  
  for (const log of receipt.logs) {
    // Check if this log is from our factory contract and matches the GroupCreated signature
    if (log.address.toLowerCase() === "0xca0009AF8E28ccfeAA5bB314fD32856B3d278BF7".toLowerCase() &&
        log.topics[0] === groupCreatedSignature) {
      
      console.log("Found GroupCreated event!");
      
      try {
        // Decode the event log
        const decoded = decodeEventLog({
          abi: groupCreatedAbi,
          data: log.data,
          topics: log.topics,
        });

        console.log("Event details:");
        console.log("  Creator:", decoded.args.creator);
        console.log("  Group Address:", decoded.args.groupAddress);
        console.log("  Group Name:", decoded.args.name);
        console.log("  Contribution Amount:", decoded.args.contributionAmount.toString(), "wei");
        console.log("  Max Members:", decoded.args.maxMembers.toString());

        // Also extract directly from topics for verification
        const creatorFromTopic = `0x${log.topics[1]?.slice(26) || ''}`;
        const groupAddressFromTopic = `0x${log.topics[2]?.slice(26) || ''}`;
        
        console.log("\nVerification from topics:");
        console.log("  Creator (from topic):", creatorFromTopic);
        console.log("  Group Address (from topic):", groupAddressFromTopic);

      } catch (error) {
        console.error("Error decoding event:", error);
        
        // Fallback: extract addresses directly from topics
        const creatorAddress = `0x${log.topics[1]?.slice(26) || ''}`;
        const groupAddress = `0x${log.topics[2]?.slice(26) || ''}`;
        
        console.log("Fallback extraction:");
        console.log("  Creator:", creatorAddress);
        console.log("  Group Address:", groupAddress);
      }
      break;
    }
  }

  // Additional verification: check the group count
  console.log("\nVerifying group creation...");
  try {
    const totalGroups = await factory.read.groupCounter();
    console.log("Total groups created:", totalGroups.toString());
    
    const allGroups = await factory.read.getAllGroups();
    console.log("Latest group address:", allGroups[allGroups.length - 1]);
    
    const creatorGroups = await factory.read.getCreatorGroups([walletClient.account.address]);
    console.log("Your groups:", creatorGroups);
    
  } catch (error) {
    console.error("Error verifying group creation:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });