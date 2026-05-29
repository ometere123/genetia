// Magic SDK singleton — lazily initialized on the client.
// Requires NEXT_PUBLIC_MAGIC_API_KEY in .env.local
// Get a free key at https://magic.link

let _instance: any = null;

export function getMagic(): any | null {
  if (typeof window === "undefined") return null;

  const key = process.env.NEXT_PUBLIC_MAGIC_API_KEY;
  if (!key) return null;

  if (!_instance) {
    // Dynamic require keeps Magic out of the SSR bundle.
    const { Magic } = require("magic-sdk") as any;
    _instance = new Magic(key, {
      network: {
        rpcUrl: "https://rpc.testnet.arc.network",
        chainId: 5042002,
      },
    });
  }

  return _instance;
}

export function isMagicConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_MAGIC_API_KEY;
}

export async function getMagicAddress(): Promise<string | null> {
  const magic = getMagic();
  if (!magic) return null;
  try {
    const isLoggedIn = await magic.user.isLoggedIn();
    if (!isLoggedIn) return null;
    const metadata = await magic.user.getMetadata();
    return metadata.publicAddress ?? null;
  } catch {
    return null;
  }
}
