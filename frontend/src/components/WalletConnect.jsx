import { ethers } from "ethers";

const AMOY_CHAIN_ID = "0x13882";

export default function WalletConnect({ onConnect, onError }) {
  const connect = async () => {
    if (!window.ethereum) {
      onError("MetaMask not found. Please install the MetaMask extension.");
      return;
    }

    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });

      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: AMOY_CHAIN_ID }],
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: AMOY_CHAIN_ID,
                chainName: "Polygon Amoy Testnet",
                rpcUrls: ["https://polygon-amoy-bor-rpc.publicnode.com"],
                nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
                blockExplorerUrls: ["https://amoy.polygonscan.com"],
              },
            ],
          });
        } else {
          throw switchError;
        }
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      onConnect(signer, address);
    } catch (err) {
      onError(err.message || "Failed to connect wallet");
    }
  };

  return (
    <div className="text-center">
      {/* Hero */}
      <div className="mb-10">
        <div className="w-20 h-20 rounded-2xl bg-indigo-600 flex items-center justify-center text-4xl mx-auto mb-6 shadow-lg shadow-indigo-500/20">
          🪪
        </div>
        <h2 className="text-3xl font-bold text-white mb-3">Proof of Personhood</h2>
        <p className="text-gray-400 text-sm leading-relaxed max-w-sm mx-auto">
          Verify you're a unique human using on-device face detection.
          Receive a non-transferable Soulbound Token on Polygon.
        </p>
      </div>

      {/* Connect button */}
      <button
        onClick={connect}
        className="w-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold py-4 rounded-xl transition-colors text-base mb-8 shadow-lg shadow-indigo-500/20"
      >
        Connect MetaMask
      </button>

      {/* Feature cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: "👁️", label: "On-Device AI", desc: "MediaPipe face detection" },
          { icon: "⛓️", label: "Soulbound NFT", desc: "Polygon Amoy testnet" },
          { icon: "🔒", label: "Privacy First", desc: "No video stored" },
        ].map((f) => (
          <div key={f.label} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
            <div className="text-2xl mb-2">{f.icon}</div>
            <div className="text-xs font-semibold text-gray-200 mb-0.5">{f.label}</div>
            <div className="text-xs text-gray-500">{f.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
