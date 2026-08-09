const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const SoulboundToken = await hre.ethers.getContractFactory("SoulboundToken");
  const token = await SoulboundToken.deploy();
  await token.waitForDeployment();

  const address = await token.getAddress();
  console.log("SoulboundToken deployed to:", address);
  console.log("Add this to your backend .env: CONTRACT_ADDRESS=" + address);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
