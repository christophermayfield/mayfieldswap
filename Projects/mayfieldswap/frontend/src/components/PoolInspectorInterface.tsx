'use client';

import { useMemo, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import {
  CONTRACT_ADDRESSES,
  ROUTER_ABI,
  POOL_MANAGER_ABI,
  HOOK_ABI,
} from '@/contracts/config';
import {
  alignTick,
  formatFeePips,
  poolIdFromKey,
  shortenAddress,
  sqrtPriceX96ToPrice,
  type PoolKey,
} from '@/lib/poolUtils';

const CHAIN_ID = 31337;
const DEFAULT_FEE = 3000;
const TICK_SPACING = 60;
const ZERO_HOOK = '0x0000000000000000000000000000000000000000' as `0x${string}`;

type PoolMode = 'standard' | 'hooked';
type RangePreset = 'full' | 'narrow' | 'medium' | 'custom';

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-white/60 shrink-0">{label}</span>
      <span className="text-white text-right break-all font-mono text-xs sm:text-sm">{value}</span>
    </div>
  );
}

export default function PoolInspectorInterface() {
  const { address, isConnected } = useAccount();
  const [poolMode, setPoolMode] = useState<PoolMode>('standard');
  const [preset, setPreset] = useState<RangePreset>('narrow');
  const [customLower, setCustomLower] = useState('-120');
  const [customUpper, setCustomUpper] = useState('120');

  const tokenA = CONTRACT_ADDRESSES[CHAIN_ID].TokenA as `0x${string}`;
  const tokenB = CONTRACT_ADDRESSES[CHAIN_ID].TokenB as `0x${string}`;
  const router = CONTRACT_ADDRESSES[CHAIN_ID].MayfieldRouter as `0x${string}`;
  const poolManager = CONTRACT_ADDRESSES[CHAIN_ID].PoolManager as `0x${string}`;
  const dynamicFeeHook = CONTRACT_ADDRESSES[CHAIN_ID].DynamicFeeHook as `0x${string}`;
  const hookDeployed = dynamicFeeHook.length === 42 && dynamicFeeHook !== '0x';

  const { data: fullRange } = useReadContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'fullRangeTicks',
  });

  const { data: defaultPoolKey } = useReadContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'defaultKey',
    args: [tokenA, tokenB],
  });

  const { data: hookedPoolKey } = useReadContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'poolKey',
    args: [tokenA, tokenB, DEFAULT_FEE, TICK_SPACING, dynamicFeeHook],
    query: { enabled: hookDeployed },
  });

  const activePoolKey = (poolMode === 'hooked' ? hookedPoolKey : defaultPoolKey) as PoolKey | undefined;

  const poolId = useMemo(
    () => (activePoolKey ? poolIdFromKey(activePoolKey) : undefined),
    [activePoolKey]
  );

  const { data: slot0 } = useReadContract({
    address: poolManager,
    abi: POOL_MANAGER_ABI,
    functionName: 'getSlot0',
    args: poolId ? [poolId] : undefined,
    query: { enabled: !!poolId },
  });

  const { data: feeGrowth } = useReadContract({
    address: poolManager,
    abi: POOL_MANAGER_ABI,
    functionName: 'getFeeGrowthGlobals',
    args: poolId ? [poolId] : undefined,
    query: { enabled: !!poolId },
  });

  const { data: initialized } = useReadContract({
    address: poolManager,
    abi: POOL_MANAGER_ABI,
    functionName: 'isInitialized',
    args: poolId ? [poolId] : undefined,
    query: { enabled: !!poolId },
  });

  const { data: hookFeePips } = useReadContract({
    address: dynamicFeeHook,
    abi: HOOK_ABI,
    functionName: 'feePips',
    query: { enabled: poolMode === 'hooked' && hookDeployed },
  });

  const [tickLower, tickUpper] = useMemo(() => {
    const full = fullRange as [number, number] | undefined;
    const fullLo = full ? Number(full[0]) : alignTick(-887272, TICK_SPACING);
    const fullHi = full ? Number(full[1]) : alignTick(887272, TICK_SPACING);
    if (preset === 'full') return [fullLo, fullHi];
    if (preset === 'narrow') return [-120, 120];
    if (preset === 'medium') return [-600, 600];
    const lo = alignTick(Number(customLower) || 0, TICK_SPACING);
    const hi = alignTick(Number(customUpper) || 0, TICK_SPACING);
    return lo < hi ? [lo, hi] : [hi, lo];
  }, [preset, customLower, customUpper, fullRange]);

  const { data: userLiquidity } = useReadContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'getLiquidityAt',
    args: [tokenA, tokenB, address!, tickLower, tickUpper],
    query: { enabled: isConnected && !!address },
  });

  const { data: userPendingFees } = useReadContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'getPendingFeesAt',
    args: [tokenA, tokenB, address!, tickLower, tickUpper],
    query: { enabled: isConnected && !!address },
  });

  const sqrtPriceX96 = slot0 ? (slot0 as [bigint, number, bigint])[0] : undefined;
  const tick = slot0 ? Number((slot0 as [bigint, number, bigint])[1]) : null;
  const activeLiquidity = slot0 ? (slot0 as [bigint, number, bigint])[2] : undefined;
  const feeGrowth0 = feeGrowth ? (feeGrowth as [bigint, bigint])[0] : undefined;
  const feeGrowth1 = feeGrowth ? (feeGrowth as [bigint, bigint])[1] : undefined;

  const price =
    sqrtPriceX96 !== undefined ? sqrtPriceX96ToPrice(sqrtPriceX96).toFixed(6) : '—';
  const inRange = tick !== null && tick >= tickLower && tick < tickUpper;
  const poolFeeLabel =
    poolMode === 'standard'
      ? formatFeePips(DEFAULT_FEE)
      : hookFeePips !== undefined
        ? `${formatFeePips(Number(hookFeePips))} (hook override)`
        : '—';

  const token0IsA =
    activePoolKey?.currency0.toLowerCase() === tokenA.toLowerCase();
  const symbol0 = token0IsA ? 'MF-A' : 'MF-B';
  const symbol1 = token0IsA ? 'MF-B' : 'MF-A';

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Pool Inspector</h2>
        <p className="text-white/60 text-sm">
          Read-only view of pool state, fee growth, and your position in a tick range.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-white/70">Pool</label>
        <div className="flex gap-2">
          <button
            onClick={() => setPoolMode('standard')}
            className={`flex-1 py-2 px-3 rounded-lg text-sm ${
              poolMode === 'standard' ? 'bg-white text-gray-900' : 'bg-white/10 text-white'
            }`}
          >
            Standard
          </button>
          <button
            onClick={() => setPoolMode('hooked')}
            disabled={!hookDeployed}
            className={`flex-1 py-2 px-3 rounded-lg text-sm disabled:opacity-40 ${
              poolMode === 'hooked' ? 'bg-white text-gray-900' : 'bg-white/10 text-white'
            }`}
          >
            Hooked
          </button>
        </div>
        {!hookDeployed && poolMode === 'hooked' ? (
          <p className="text-xs text-amber-300">Run deploy to enable hooked pool reads.</p>
        ) : null}
      </div>

      <div className="bg-white/5 rounded-xl p-4 space-y-3">
        <h3 className="text-white font-medium text-sm">Pool key</h3>
        {activePoolKey ? (
          <>
            <StatRow label="Pair" value={`${symbol0} / ${symbol1}`} />
            <StatRow label="Pool id" value={poolId ? shortenAddress(poolId, 6) : '—'} />
            <StatRow label="Fee tier" value={String(activePoolKey.fee)} />
            <StatRow label="Tick spacing" value={String(activePoolKey.tickSpacing)} />
            <StatRow
              label="Hooks"
              value={
                activePoolKey.hooks === ZERO_HOOK
                  ? 'none'
                  : shortenAddress(activePoolKey.hooks)
              }
            />
            <StatRow label="Initialized" value={initialized === undefined ? '—' : initialized ? 'yes' : 'no'} />
          </>
        ) : (
          <p className="text-white/50 text-sm">Loading pool key…</p>
        )}
      </div>

      <div className="bg-white/5 rounded-xl p-4 space-y-3">
        <h3 className="text-white font-medium text-sm">Slot0</h3>
        <StatRow label="Current tick" value={tick === null ? '—' : String(tick)} />
        <StatRow
          label={`Price (${symbol1}/${symbol0})`}
          value={price}
        />
        <StatRow
          label="Active liquidity"
          value={activeLiquidity !== undefined ? formatEther(activeLiquidity) : '—'}
        />
        <StatRow
          label="sqrtPriceX96"
          value={sqrtPriceX96 !== undefined ? sqrtPriceX96.toString() : '—'}
        />
      </div>

      <div className="bg-white/5 rounded-xl p-4 space-y-3">
        <h3 className="text-white font-medium text-sm">Fees</h3>
        <StatRow label="Effective swap fee" value={poolFeeLabel} />
        <StatRow
          label="feeGrowthGlobal0"
          value={feeGrowth0 !== undefined ? feeGrowth0.toString() : '—'}
        />
        <StatRow
          label="feeGrowthGlobal1"
          value={feeGrowth1 !== undefined ? feeGrowth1.toString() : '—'}
        />
        <p className="text-white/45 text-xs">
          Fee growth accumulates on swaps while liquidity is active. Positions checkpoint on modify/collect.
        </p>
      </div>

      <div className="bg-white/5 rounded-xl p-4 space-y-4">
        <h3 className="text-white font-medium text-sm">Position preview</h3>
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
              className={`px-3 py-1 rounded-lg text-xs ${
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

        <StatRow label="Range" value={`${tickLower} → ${tickUpper}`} />
        <StatRow
          label="Range status"
          value={tick === null ? '—' : inRange ? 'In range (earning fees)' : 'Out of range'}
        />

        {isConnected ? (
          <>
            <StatRow
              label="Your liquidity"
              value={userLiquidity !== undefined ? formatEther(userLiquidity as bigint) : '—'}
            />
            <StatRow
              label="Uncollected fees"
              value={
                userPendingFees
                  ? `${formatEther((userPendingFees as [bigint, bigint])[0])} / ${formatEther((userPendingFees as [bigint, bigint])[1])}`
                  : '—'
              }
            />
          </>
        ) : (
          <p className="text-white/50 text-xs">Connect a wallet to preview your position in this range.</p>
        )}

        {tick !== null ? (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-white/50">
              <span>{tickLower}</span>
              <span>tick {tick}</span>
              <span>{tickUpper}</span>
            </div>
            <div className="relative h-2 rounded-full bg-white/10">
              {(() => {
                const span = tickUpper - tickLower;
                const pct = span > 0 ? Math.min(100, Math.max(0, ((tick - tickLower) / span) * 100)) : 50;
                return (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-400"
                    style={{ left: `calc(${pct}% - 4px)` }}
                  />
                );
              })()}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
