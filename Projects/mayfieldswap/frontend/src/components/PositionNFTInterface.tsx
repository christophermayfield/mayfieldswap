'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  usePublicClient,
} from 'wagmi';
import { parseEther, formatEther } from 'viem';
import {
  CONTRACT_ADDRESSES,
  POSITION_MANAGER_ABI,
  ROUTER_ABI,
} from '@/contracts/config';
import { useTokenApproval } from '@/hooks/useTokenApproval';

const CHAIN_ID = 31337;
const TICK_SPACING = 60;

const TOKENS = [
  { symbol: 'MF-A', address: CONTRACT_ADDRESSES[CHAIN_ID].TokenA, name: 'Mayfield A' },
  { symbol: 'MF-B', address: CONTRACT_ADDRESSES[CHAIN_ID].TokenB, name: 'Mayfield B' },
];

type RangePreset = 'narrow' | 'medium' | 'custom';

type OwnedPosition = {
  tokenId: bigint;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  pending0: bigint;
  pending1: bigint;
};

function alignTick(tick: number, spacing = TICK_SPACING) {
  return Math.trunc(tick / spacing) * spacing;
}

export default function PositionNFTInterface() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const [tokenA, setTokenA] = useState(TOKENS[0]);
  const [tokenB, setTokenB] = useState(TOKENS[1]);
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [preset, setPreset] = useState<RangePreset>('narrow');
  const [customLower, setCustomLower] = useState('-120');
  const [customUpper, setCustomUpper] = useState('120');
  const [owned, setOwned] = useState<OwnedPosition[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const positionManager = CONTRACT_ADDRESSES[CHAIN_ID].PositionManager as `0x${string}`;
  const router = CONTRACT_ADDRESSES[CHAIN_ID].MayfieldRouter as `0x${string}`;
  const pmDeployed = positionManager.length === 42 && positionManager !== '0x';

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const { data: nextTokenId } = useReadContract({
    address: pmDeployed ? positionManager : undefined,
    abi: POSITION_MANAGER_ABI,
    functionName: 'nextTokenId',
  });

  const { data: poolState } = useReadContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'getPoolState',
    args: [tokenA.address, tokenB.address],
    query: { enabled: tokenA.address !== tokenB.address },
  });

  const [tickLower, tickUpper] = useMemo(() => {
    if (preset === 'narrow') return [-120, 120];
    if (preset === 'medium') return [-600, 600];
    const lo = alignTick(Number(customLower) || 0);
    const hi = alignTick(Number(customUpper) || 0);
    return lo < hi ? [lo, hi] : [hi, lo];
  }, [preset, customLower, customUpper]);

  const amountAWei = useMemo(() => {
    try {
      return amountA && parseFloat(amountA) > 0 ? parseEther(amountA) : 0n;
    } catch {
      return 0n;
    }
  }, [amountA]);

  const amountBWei = useMemo(() => {
    try {
      return amountB && parseFloat(amountB) > 0 ? parseEther(amountB) : 0n;
    } catch {
      return 0n;
    }
  }, [amountB]);

  const approvalA = useTokenApproval({
    token: tokenA.address as `0x${string}`,
    owner: address,
    spender: positionManager,
    amount: amountAWei,
    enabled: isConnected && pmDeployed && amountAWei > 0n,
  });

  const approvalB = useTokenApproval({
    token: tokenB.address as `0x${string}`,
    owner: address,
    spender: positionManager,
    amount: amountBWei,
    enabled: isConnected && pmDeployed && amountBWei > 0n && tokenA.address !== tokenB.address,
  });

  const refreshOwned = useCallback(async () => {
    if (!publicClient || !address || !pmDeployed || !nextTokenId) {
      setOwned([]);
      return;
    }
    setLoadingPositions(true);
    try {
      const max = Number(nextTokenId as bigint);
      const found: OwnedPosition[] = [];
      for (let id = 1; id < max; id++) {
        const tokenId = BigInt(id);
        const owner = (await publicClient.readContract({
          address: positionManager,
          abi: POSITION_MANAGER_ABI,
          functionName: 'ownerOf',
          args: [tokenId],
        }).catch(() => null)) as `0x${string}` | null;
        if (!owner || owner.toLowerCase() !== address.toLowerCase()) continue;

        const info = (await publicClient.readContract({
          address: positionManager,
          abi: POSITION_MANAGER_ABI,
          functionName: 'positionInfo',
          args: [tokenId],
        })) as {
          tickLower: number;
          tickUpper: number;
          liquidity: bigint;
          pendingFees0: bigint;
          pendingFees1: bigint;
        };

        if (info.liquidity === 0n) continue;
        found.push({
          tokenId,
          tickLower: Number(info.tickLower),
          tickUpper: Number(info.tickUpper),
          liquidity: info.liquidity,
          pending0: info.pendingFees0,
          pending1: info.pendingFees1,
        });
      }
      setOwned(found);
    } finally {
      setLoadingPositions(false);
    }
  }, [publicClient, address, pmDeployed, nextTokenId, positionManager]);

  useEffect(() => {
    void refreshOwned();
  }, [refreshOwned, isConfirmed]);

  const handleMint = async () => {
    if (!isConnected || !pmDeployed || (!amountAWei && !amountBWei)) return;
    setError(null);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    try {
      await writeContract({
        address: positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: 'mint',
        args: [
          tokenA.address,
          tokenB.address,
          tickLower,
          tickUpper,
          amountAWei,
          amountBWei,
          (amountAWei * 95n) / 100n,
          (amountBWei * 95n) / 100n,
          address!,
          deadline,
        ],
      });
    } catch (e) {
      console.error(e);
      setError('Mint failed. Check approvals, range, and that PositionManager is deployed.');
    }
  };

  const handleDecrease = async (tokenId: bigint, liquidity: bigint) => {
    if (!isConnected || !pmDeployed || liquidity === 0n) return;
    setError(null);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    try {
      await writeContract({
        address: positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: 'decreaseLiquidity',
        args: [tokenId, liquidity, 0n, 0n, address!, deadline],
      });
    } catch (e) {
      console.error(e);
      setError('Remove liquidity failed.');
    }
  };

  const handleCollect = async (tokenId: bigint) => {
    if (!isConnected || !pmDeployed) return;
    setError(null);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    try {
      await writeContract({
        address: positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: 'collect',
        args: [tokenId, address!, deadline],
      });
    } catch (e) {
      console.error(e);
      setError('Collect failed — fees may already be zero.');
    }
  };

  const handleBurn = async (tokenId: bigint) => {
    if (!isConnected || !pmDeployed) return;
    setError(null);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    try {
      await writeContract({
        address: positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: 'burn',
        args: [tokenId, 0n, 0n, address!, deadline],
      });
    } catch (e) {
      console.error(e);
      setError('Burn failed.');
    }
  };

  if (!isConnected) {
    return (
      <div className="text-center py-8">
        <p className="text-white/70">Connect your wallet to manage LP NFTs</p>
      </div>
    );
  }

  if (!pmDeployed) {
    return (
      <div className="text-center py-8 space-y-2">
        <p className="text-white/70">PositionManager is not deployed yet.</p>
        <p className="text-white/50 text-sm">Run `npm run deploy:v4` to write its address to the frontend config.</p>
      </div>
    );
  }

  const busy = isPending || isConfirming || approvalA.isApproving || approvalB.isApproving;
  const needsApproveA = amountAWei > 0n && !approvalA.hasAllowance;
  const needsApproveB = amountBWei > 0n && tokenA.address !== tokenB.address && !approvalB.hasAllowance;
  const poolTick = poolState
    ? Number((poolState as { tick: number }).tick ?? (poolState as [bigint, number, bigint])[1])
    : null;
  const inRange = poolTick !== null && poolTick >= tickLower && poolTick < tickUpper;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-white mb-2">LP Positions (NFT)</h2>
      <p className="text-white/60 text-sm">
        Mint an MSLP NFT for a concentrated range. Fee rights and ownership transfer with the token.
      </p>

      <div className="bg-white/5 rounded-xl p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-white/70">Mint range</span>
          <span className="text-white">
            {tickLower} → {tickUpper} {inRange ? '(in range)' : '(out of range)'}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ['narrow', 'Narrow ±120'],
          ['medium', 'Medium ±600'],
          ['custom', 'Custom'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setPreset(id)}
            className={`px-3 py-1 rounded-lg text-sm ${
              preset === id ? 'bg-white text-gray-900' : 'bg-white/10 text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {preset === 'custom' ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-white/60 space-y-1">
            Tick lower
            <input
              type="number"
              step={TICK_SPACING}
              value={customLower}
              onChange={(e) => setCustomLower(e.target.value)}
              className="w-full bg-white/5 rounded-lg p-2 text-white text-sm outline-none"
            />
          </label>
          <label className="text-xs text-white/60 space-y-1">
            Tick upper
            <input
              type="number"
              step={TICK_SPACING}
              value={customUpper}
              onChange={(e) => setCustomUpper(e.target.value)}
              className="w-full bg-white/5 rounded-lg p-2 text-white text-sm outline-none"
            />
          </label>
        </div>
      ) : null}

      <div className="space-y-4">
        {[
          { token: tokenA, set: setTokenA, amount: amountA, setAmount: setAmountA },
          { token: tokenB, set: setTokenB, amount: amountB, setAmount: setAmountB },
        ].map((row, i) => (
          <div key={i} className="bg-white/5 rounded-xl p-4 space-y-2">
            <select
              value={row.token.symbol}
              onChange={(e) => row.set(TOKENS.find((t) => t.symbol === e.target.value)!)}
              className="bg-transparent text-white text-lg font-medium"
            >
              {TOKENS.map((t) => (
                <option key={t.symbol} value={t.symbol} className="bg-gray-800">
                  {t.symbol}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={row.amount}
              onChange={(e) => row.setAmount(e.target.value)}
              placeholder="0.0"
              className="w-full bg-transparent text-2xl text-white placeholder-white/30 outline-none"
            />
          </div>
        ))}

        {needsApproveA || needsApproveB ? (
          <button
            onClick={async () => {
              setError(null);
              try {
                if (needsApproveA) await approvalA.approve();
                else if (needsApproveB) await approvalB.approve();
              } catch {
                setError('Approval failed.');
              }
            }}
            disabled={busy}
            className="w-full bg-gradient-to-r from-amber-500 to-orange-600 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 rounded-xl"
          >
            {approvalA.isApproving || approvalB.isApproving
              ? 'Approving...'
              : needsApproveA
                ? `Approve ${tokenA.symbol}`
                : `Approve ${tokenB.symbol}`}
          </button>
        ) : (
          <button
            onClick={handleMint}
            disabled={busy || (amountAWei === 0n && amountBWei === 0n) || tokenA.address === tokenB.address}
            className="w-full bg-gradient-to-r from-violet-500 to-indigo-600 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 rounded-xl"
          >
            {isPending || isConfirming ? 'Minting...' : 'Mint LP NFT'}
          </button>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-white font-medium">Your NFTs</h3>
          <button
            onClick={() => void refreshOwned()}
            disabled={loadingPositions}
            className="text-xs text-white/60 hover:text-white"
          >
            {loadingPositions ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {owned.length === 0 ? (
          <p className="text-white/50 text-sm">No active LP NFTs yet.</p>
        ) : (
          owned.map((pos) => (
            <div key={pos.tokenId.toString()} className="bg-white/5 rounded-xl p-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-white font-medium">MSLP #{pos.tokenId.toString()}</span>
                <span className="text-white/60">
                  {pos.tickLower} → {pos.tickUpper}
                </span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>Liquidity</span>
                <span className="text-white">{formatEther(pos.liquidity)}</span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>Uncollected fees</span>
                <span className="text-white">
                  {formatEther(pos.pending0)} / {formatEther(pos.pending1)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => void handleCollect(pos.tokenId)}
                  disabled={busy || (pos.pending0 === 0n && pos.pending1 === 0n)}
                  className="py-2 rounded-lg bg-amber-500/90 disabled:bg-gray-500 text-white font-medium text-xs sm:text-sm"
                >
                  Collect
                </button>
                <button
                  onClick={() => void handleDecrease(pos.tokenId, pos.liquidity / 2n)}
                  disabled={busy || pos.liquidity === 0n}
                  className="py-2 rounded-lg bg-sky-500/90 disabled:bg-gray-500 text-white font-medium text-xs sm:text-sm"
                >
                  Remove 50%
                </button>
                <button
                  onClick={() => void handleBurn(pos.tokenId)}
                  disabled={busy}
                  className="py-2 rounded-lg bg-rose-500/90 disabled:bg-gray-500 text-white font-medium text-xs sm:text-sm"
                >
                  Burn all
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {error && <div className="text-rose-400 text-center text-sm">{error}</div>}
      {isConfirmed && <div className="text-green-400 text-center text-sm">Transaction confirmed</div>}
    </div>
  );
}
