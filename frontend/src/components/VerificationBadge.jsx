export default function VerificationBadge({ result, account }) {
  if (!result.success) {
    return (
      <div className="bg-gray-900 border border-red-800 rounded-2xl p-10 text-center">
        <div className="text-5xl mb-4">❌</div>
        <h2 className="text-xl font-bold text-white mb-2">Verification Failed</h2>
        <p className="text-red-400 text-sm mb-6">{result.message}</p>
        <button
          onClick={() => window.location.reload()}
          className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-indigo-700 rounded-2xl p-10 text-center">
      {/* Token image */}
      <div className="relative w-48 h-48 mx-auto mb-6">
        <div className="absolute inset-0 rounded-2xl bg-indigo-500/20 animate-ping" />
        <div className="relative w-48 h-48 rounded-2xl ring-4 ring-indigo-500/40 shadow-lg shadow-indigo-500/30 overflow-hidden">
          <img src="/sbt.svg" alt="Soulbound Token" className="w-full h-full object-cover" />
        </div>
      </div>

      <h2 className="text-2xl font-bold text-white mb-1">Humanity Verified!</h2>
      <p className="text-gray-400 text-sm mb-8">
        Your Soulbound Token has been minted on Polygon Amoy.
      </p>

      {/* Details */}
      <div className="space-y-3 text-left mb-8">
        <Detail label="Wallet" value={`${account.slice(0, 10)}…${account.slice(-8)}`} />
        {result.tx_hash && (
          <Detail
            label="Transaction Hash"
            value={`${result.tx_hash.slice(0, 20)}…${result.tx_hash.slice(-8)}`}
          />
        )}
        {result.ipfs_uri && (
          <Detail label="Metadata (IPFS)" value={result.ipfs_uri} />
        )}
        {result.ai_explanation && (
          <Detail label="Verification Method" value={result.ai_explanation} />
        )}
      </div>

      {/* Actions */}
      <div className="space-y-3">
        {result.tx_hash && (
          <a
            href={`https://amoy.polygonscan.com/tx/${result.tx_hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
          >
            View on Polygonscan ↗
          </a>
        )}
        <a
          href={`https://amoy.polygonscan.com/address/${account}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-3 rounded-xl transition-colors text-sm"
        >
          View Wallet on Explorer ↗
        </a>
      </div>

      <p className="text-xs text-gray-600 mt-6">
        This token is non-transferable (EIP-5192 Soulbound). One per wallet.
      </p>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="bg-gray-800 rounded-xl px-4 py-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-sm text-gray-200 font-mono break-all">{value}</div>
    </div>
  );
}
