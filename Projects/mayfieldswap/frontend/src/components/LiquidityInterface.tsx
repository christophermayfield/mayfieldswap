'use client';

import { useMemo, useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { CONTRACT_ADDRESSES, ROUTER_ABI, ERC20_ABI } from '@/contracts/config';
import { useTokenApproval } from '@/hooks/useTokenApproval';

const CHAIN_ID = 31337;
const TICK_SPACING = 60;

const TOKENS = [
  { symbol: 'MF-A', address: CONTRACT_ADDRESSES[CHAIN_ID].TokenA, name: 'Mayfield A' },
  { symbol: 'MF-B', address: CONTRACT_ADDRESSES[CHAIN_ID].TokenB, name: 'Mayfield B' },
];

type RangePreset = 'full' | 'narrow' | 'medium' | 'custom';

function alignTick(tick: number, spacing = TICK_SPACING) {
  return Math.trunc(tick / spacing) * spacing;
}

export default function LiquidityInterface() {
  const { address, isConnected } = useAccount();
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [tokenA, setTokenA] = useState(TOKENS[0]);
  const [tokenB, setTokenB] = useState(TOKENS[1]);
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [preset, setPreset] = useState<RangePreset>('full');
  const [customLower, setCustomLower] = useState('-600');
  const [customUpper, setCustomUpper] = useState('600');
  const [error, setError] = useState<string | null>(null);

  const router = CONTRACT_ADDRESSES[CHAIN_ID].MayfieldRouter as `0x${string}`;
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const { data: fullRange } = useReadContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'fullRangeTicks',
  });

  const { data: poolState } = useReadContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'getPoolState',
    args: [tokenA.address, tokenB.address],
    query: { enabled: tokenA.address !== tokenB.address },
  });

  const [tickLower, tickUpper] = useMemo(() => {
    const full = fullRange as [number, number] | undefined;
    const fullLo = full ? Number(full[0]) : alignTick(-887272);
    const fullHi = full ? Number(full[1]) : alignTick(887272);
    if (preset === 'full') return [fullLo, fullHi];
    if (preset === 'narrow') return [-120, 120];
    if (preset === 'medium') return [-600, 600];
    const lo = alignTick(Number(customLower) || 0);
    const hi = alignTick(Number(customUpper) || 0);
    return lo < hi ? [lo, hi] : [hi, lo];
  }, [preset, customLower, customUpper, fullRange]);

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
    spender: router,
    amount: amountAWei,
    enabled: isConnected && mode === 'add' && amountAWei > 0n,
  });

  const approvalB = useTokenApproval({
    token: tokenB.address as `0x${string}`,
    owner: address,
    spender: router,
    amount: amountBWei,
    enabled: isConnected && mode === 'add' && amountBWei > 0n && tokenA.address !== tokenB.address,
  });

  const { data: lpBalance, refetch: refetchLp } = useReadContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'getLiquidityAt',
    args: [tokenA.address, tokenB.address, address, tickLower, tickUpper],
    query: { enabled: !!address && tokenA.address !== tokenB.address },
  });

  const { data: pendingFees, refetch: refetchFees } = useReadContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'getPendingFeesAt',
    args: [tokenA.address, tokenB.address, address, tickLower, tickUpper],
    query: { enabled: !!address && tokenA.address !== tokenB.address },
  });

  const { data: balanceA } = useReadContract({
    address: tokenA.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
    query: { enabled: isConnected },
  });

  const { data: balanceB } = useReadContract({
    address: tokenB.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
    query: { enabled: isConnected },
  });

  const needsApproveA = mode === 'add' && amountAWei > 0n && !approvalA.hasAllowance;
  const needsApproveB =
    mode === 'add' && amountBWei > 0n && tokenA.address !== tokenB.address && !approvalB.hasAllowance;

  const handleApprove = async () => {
    setError(null);
    try {
      if (needsApproveA) {
        await approvalA.approve();
        return;
      }
      if (needsApproveB) {
        await approvalB.approve();
      }
    } catch (e) {
      console.error(e);
      setError('Approval failed. Check your wallet and try again.');
    }
  };

  const handleAddLiquidity = async () => {
    if ((!amountA && !amountB) || !isConnected) return;
    if (needsApproveA || needsApproveB) return;

    setError(null);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    try {
      await writeContract({
        address: router,
        abi: ROUTER_ABI,
        functionName: 'addLiquidityWithRange',
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
      await refetchLp();
      await refetchFees();
    } catch (e) {
      console.error(e);
      setError('Add liquidity failed. Check balances, range, and approvals.');
    }
  };

  const handleRemoveLiquidity = async () => {
    if (!lpBalance || !isConnected) return;
    setError(null);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    try {
      await writeContract({
        address: router,
        abi: ROUTER_ABI,
        functionName: 'removeLiquidityWithRange',
        args: [
          tokenA.address,
          tokenB.address,
          tickLower,
          tickUpper,
          (lpBalance as bigint) / 2n,
          0n,
          0n,
          address!,
          deadline,
        ],
      });
      await refetchLp();
      await refetchFees();
    } catch (e) {
      console.error(e);
      setError('Remove liquidity failed.');
    }
  };

  const handleCollectFees = async () => {
    if (!isConnected) return;
    setError(null);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    try {
      await writeContract({
        address: router,
        abi: ROUTER_ABI,
        functionName: 'collectFeesWithRange',
        args: [tokenA.address, tokenB.address, tickLower, tickUpper, address!, deadline],
      });
      await refetchFees();
    } catch (e) {
      console.error(e);
      setError('Collect fees failed. Fees may be zero until more swaps occur in this range.');
    }
  };

  if (!isConnected) {
    return (
      <div className="text-center py-8">
        <p className="text-white/70 mb-4">Connect your wallet to manage liquidity</p>
      </div>
    );
  }

  const busy = isPending || isConfirming || approvalA.isApproving || approvalB.isApproving;
  const approveLabel = needsApproveA
    ? `Approve ${tokenA.symbol}`
    : needsApproveB
      ? `Approve ${tokenB.symbol}`
      : 'Approve';
  const currentTick = poolState ? Number((poolState as { tick: number }).tick ?? (poolState as [bigint, number, bigint])[1]) : null;
  const inRange = currentTick !== null && currentTick >= tickLower && currentTick < tickUpper;
  const canAdd = (amountAWei > 0n || amountBWei > 0n) && tokenA.address !== tokenB.address && tickLower < tickUpper;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-white mb-2">Liquidity</h2>
      <p className="text-white/60 text-sm">
        Concentrated liquidity: choose a tick range. Fees accrue only while the pool tick is inside it.
      </p>

      <div className="bg-white/5 rounded-xl p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-white/70">Current tick</span>
          <span className="text-white">{currentTick === null ? '—' : currentTick}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/70">Your range</span>
          <span className="text-white">
            {tickLower} → {tickUpper} {inRange ? '(in range)' : '(out of range)'}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ['full', 'Full'],
          ['narrow', 'Narrow'],
          ['medium', 'Medium'],
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

      {(lpBalance as bigint | undefined) && lpBalance !== 0n ? (
        <div className="bg-white/5 rounded-xl p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-white/70">Your liquidity</span>
            <span className="text-white">{formatEther(lpBalance as bigint)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/70">Uncollected fees</span>
            <span className="text-white">
              {pendingFees
                ? `${formatEther((pendingFees as [bigint, bigint])[0])} / ${formatEther((pendingFees as [bigint, bigint])[1])}`
                : '0.0 / 0.0'}
            </span>
          </div>
          <button
            onClick={handleCollectFees}
            disabled={
              busy ||
              !pendingFees ||
              ((pendingFees as [bigint, bigint])[0] === 0n && (pendingFees as [bigint, bigint])[1] === 0n)
            }
            className="w-full bg-gradient-to-r from-amber-500 to-yellow-600 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-3 rounded-xl"
          >
            {isPending || isConfirming ? 'Collecting...' : 'Collect Fees'}
          </button>
        </div>
      ) : null}

      <div className="flex bg-white/5 rounded-xl p-1">
        <button
          onClick={() => setMode('add')}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium ${
            mode === 'add' ? 'bg-white text-gray-900' : 'text-white/70'
          }`}
        >
          Add
        </button>
        <button
          onClick={() => setMode('remove')}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium ${
            mode === 'remove' ? 'bg-white text-gray-900' : 'text-white/70'
          }`}
        >
          Remove
        </button>
      </div>

      {mode === 'add' ? (
        <div className="space-y-4">
          {[
            { token: tokenA, set: setTokenA, amount: amountA, setAmount: setAmountA, bal: balanceA },
            { token: tokenB, set: setTokenB, amount: amountB, setAmount: setAmountB, bal: balanceB },
          ].map((row, i) => (
            <div key={i} className="bg-white/5 rounded-xl p-4 space-y-2">
              <div className="flex justify-between items-center">
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
                <span className="text-xs text-white/50">
                  Balance: {row.bal ? formatEther(row.bal as bigint) : '0.0'}
                </span>
              </div>
              <input
                type="number"
                value={row.amount}
                onChange={(e) => row.setAmount(e.target.value)}
                placeholder="0.0"
                className="w-full bg-transparent text-2xl text-white placeholder-white/30 outline-none"
              />
            </div>
          ))}
          <p className="text-white/50 text-xs">
            Out-of-range positions are one-sided: below the range uses token0 only, above uses token1 only.
          </p>

          {needsApproveA || needsApproveB ? (
            <button
              onClick={handleApprove}
              disabled={!canAdd || busy}
              className="w-full bg-gradient-to-r from-amber-500 to-orange-600 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 rounded-xl"
            >
              {approvalA.isApproving || approvalB.isApproving ? 'Approving...' : approveLabel}
            </button>
          ) : (
            <button
              onClick={handleAddLiquidity}
              disabled={!canAdd || busy}
              className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 rounded-xl"
            >
              {isPending || isConfirming ? 'Adding...' : 'Add Liquidity'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={handleRemoveLiquidity}
            disabled={!lpBalance || lpBalance === 0n || busy}
            className="w-full bg-gradient-to-r from-rose-500 to-orange-600 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 rounded-xl"
          >
            {isPending || isConfirming ? 'Removing...' : 'Remove 50%'}
          </button>
        </div>
      )}

      {error && <div className="text-rose-400 text-center text-sm">{error}</div>}
      {isConfirmed && <div className="text-green-400 text-center text-sm">Transaction confirmed</div>}
    </div>
  );
}
