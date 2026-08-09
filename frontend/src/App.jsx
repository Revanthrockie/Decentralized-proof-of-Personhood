import { useState, useCallback } from "react";
import { ethers } from "ethers";
import WalletConnect from "./components/WalletConnect.jsx";
import ChallengeRecorder from "./components/ChallengeRecorder.jsx";
import VerificationBadge from "./components/VerificationBadge.jsx";
import SoulboundABI from "./abi/SoulboundToken.json";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

export default function App() {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [step, setStep] = useState("connect"); // connect | check | verify | processing | done | already_verified
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleWalletConnect = useCallback(async (signer, address) => {
    setAccount(address);
    setProvider(signer.provider);
    setError(null);

    // Check if already verified on-chain
    if (CONTRACT_ADDRESS && CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000") {
      try {
        const contract = new ethers.Contract(CONTRACT_ADDRESS, SoulboundABI, signer.provider);
        const verified = await contract.isVerified(address);
        if (verified) {
          const tokenId = await contract.tokenOfOwner(address);
          setResult({ already: true, tokenId: tokenId.toString() });
          setStep("already_verified");
          return;
        }
      } catch {
        // Contract not deployed or wrong network — proceed anyway
      }
    }

    setStep("verify");
  }, []);

  const handleVerificationComplete = useCallback((verifyResult) => {
    setResult(verifyResult);
    setStep("done");
  }, []);

  const handleError = useCallback((msg) => {
    setError(msg);
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 relative flex items-center justify-center">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🪪</span>
          <div className="text-center">
            <h1 className="text-lg font-bold text-white">Proof of Personhood</h1>
            <p className="text-xs text-gray-500">Decentralized Human Verification</p>
          </div>
        </div>
        {account && (
          <div className="absolute right-6 flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-full px-4 py-1.5">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-xs text-gray-300 font-mono">
              {account.slice(0, 6)}…{account.slice(-4)}
            </span>
          </div>
        )}
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Steps indicator */}
          {step !== "done" && step !== "already_verified" && (
            <div className="flex items-center justify-center mb-10">
              {[
                { key: "connect", label: "Connect" },
                { key: "verify", label: "Verify" },
                { key: "processing", label: "Minting" },
              ].map(({ key, label }, i) => {
                const stepIndex = ["connect", "verify", "processing"].indexOf(step);
                const isActive = i === stepIndex;
                const isDone = i < stepIndex;
                return (
                  <div key={key} className="flex items-center">
                    <div className="flex flex-col items-center gap-1.5">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                          isDone
                            ? "bg-indigo-600 border-indigo-600 text-white"
                            : isActive
                            ? "border-indigo-500 bg-indigo-500/10 text-indigo-400"
                            : "border-gray-700 text-gray-600"
                        }`}
                      >
                        {isDone ? "✓" : i + 1}
                      </div>
                      <span className={`text-xs ${isActive ? "text-indigo-400" : isDone ? "text-gray-400" : "text-gray-600"}`}>
                        {label}
                      </span>
                    </div>
                    {i < 2 && (
                      <div className={`w-16 h-px mx-2 mb-5 ${i < stepIndex ? "bg-indigo-600" : "bg-gray-700"}`} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="mb-6 bg-red-950 border border-red-800 rounded-xl p-4 text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Step panels */}
          {step === "connect" && (
            <WalletConnect onConnect={handleWalletConnect} onError={handleError} />
          )}

          {step === "verify" && (
            <ChallengeRecorder
              account={account}
              backendUrl={BACKEND_URL}
              onComplete={handleVerificationComplete}
              onError={handleError}
              onProcessing={() => { setError(null); setStep("processing"); }}
            />
          )}

          {step === "processing" && (
            <div className="text-center bg-gray-900 border border-gray-800 rounded-2xl p-10">
              <div className="relative w-16 h-16 mx-auto mb-6">
                <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20" />
                <div className="absolute inset-0 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">Minting your SBT…</h2>
              <p className="text-gray-400 text-sm">Writing to the Polygon Amoy blockchain.<br />This takes a few seconds.</p>
            </div>
          )}

          {step === "done" && result && (
            <VerificationBadge result={result} account={account} />
          )}

          {step === "already_verified" && result && (
            <div className="text-center bg-gray-900 border border-indigo-800 rounded-2xl p-10">
              <div className="text-6xl mb-4">🏅</div>
              <h2 className="text-2xl font-bold text-white mb-2">Already Verified</h2>
              <p className="text-gray-400 mb-4">This wallet holds Soulbound Token #{result.tokenId}</p>
              <div className="bg-gray-800 rounded-xl p-3 font-mono text-xs text-gray-400 break-all">{account}</div>
            </div>
          )}
        </div>
      </main>

      <footer className="text-center py-4 text-xs text-gray-700">
        Polygon Amoy Testnet · MediaPipe On-Device Detection · IPFS via Pinata
      </footer>
    </div>
  );
}
