import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { arcTestnet } from "./arc";

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: http("https://rpc.testnet.arc.network"),
  },
});
