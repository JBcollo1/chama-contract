import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ChamaFactoryModule = buildModule("ChamaFactoryModule", (m) => {
  const owner = m.getParameter("owner", "0xYourWalletAddressHere");

  const chamaFactory = m.contract("ChamaFactory", [owner]);

  return { chamaFactory };
});

export default ChamaFactoryModule;
