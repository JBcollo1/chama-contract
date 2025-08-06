import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ChamaFactoryModule = buildModule("ChamaFactoryModule", (m) => {
  const owner = m.getParameter("owner", "0x5B058198Fc832E592edA2b749bc6e4380f4ED458");

  const chamaFactory = m.contract("ChamaFactory", [owner]);

  return { chamaFactory };
});

export default ChamaFactoryModule;
