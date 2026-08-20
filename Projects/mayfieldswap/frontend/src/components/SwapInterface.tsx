'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { CONTRACT_ADDRESSES, ROUTER_ABI, QUOTER_ABI, ERC20_ABI, HOOK_ABI } from '@/contracts/config';
import { useTokenApproval } from '@/hooks/useTokenApproval';

const CHAIN_ID = 31337;
const DEFAULT_FEE = 3000;
const TICK_SPACING = 60;

const ALL_TOKENS = [
  { symbol: 'ETH', address: 'ETH', name: 'Ethereum' },
  { symbol: 'MF-A', address: CONTRACT_ADDRESSES[CHAIN_ID].TokenA, name: 'Mayfield A' },
  { symbol: 'MF-B', address: CONTRACT_ADDRESSES[CHAIN_ID].TokenB, name: 'Mayfield B' },
];

type PoolMode = 'standard' | 'hooked';

type PoolKey = {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
};

function formatFeePips(pips: number) {
  return `${(pips / 10_000).toFixed(2)}%`;
}

export default function SwapInterface() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [poolMode, setPoolMode] = useState<PoolMode>('standard');
  const [fromToken, setFromToken] = useState(ALL_TOKENS[1]);
  const [toToken, setToToken] = useState(ALL_TOKENS[2]);
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [error, setError] = useState<string | null>(null);

  const router = CONTRACT_ADDRESSES[CHAIN_ID].MayfieldRouter as `0x${string}`;
  const quoter = CONTRACT_ADDRESSES[CHAIN_ID].Quoter as `0x${string}`;
  const weth = CONTRACT_ADDRESSES[CHAIN_ID].WETH as `0x${string}`;
  const dynamicFeeHook = CONTRACT_ADDRESSES[CHAIN_ID].DynamicFeeHook as `0x${string}`;
  const hookDeployed = dynamicFeeHook.length === 42 && dynamicFeeHook !== '0x';

  const tokenA = fromToken.address === 'ETH' ? weth : (fromToken.address as `0x${string}`);
  const tokenB = toToken.address === 'ETH' ? weth : (toToken.address as `0x${string}`);
  const pairReady = fromToken.address !== toToken.address && !(fromToken.address === 'ETH' && toToken.address === 'ETH');
  const hookedErc20Only = poolMode === 'hooked';

  const swapTokens = useMemo(
    () => (hookedErc20Only ? ALL_TOKENS.filter((t) => t.address !== 'ETH') : ALL_TOKENS),
    [hookedErc20Only]
  );

  useEffect(() => {
    if (hookedErc20Only && (fromToken.address === 'ETH' || toToken.address === 'ETH')) {
      setFromToken(ALL_TOKENS[1]);
      setToToken(ALL_TOKENS[2]);
      setFromAmount('');
      setToAmount('');
    }
  }, [hookedErc20Only, fromToken.address, toToken.address]);

  const amountIn = useMemo(() => {
    try {
      return fromAmount && parseFloat(fromAmount) > 0 ? parseEther(fromAmount) : 0n;
    } catch {
      return 0n;
    }
  }, [fromAmount]);

  const needsApproval = fromToken.address !== 'ETH' && amountIn > 0n;

  const {
    hasAllowance,
    approve,
    isApproving,
  } = useTokenApproval({
    token: needsApproval ? (fromToken.address as `0x${string}`) : undefined,
    owner: address,
    spender: router,
    amount: amountIn,
    enabled: isConnected && needsApproval,
  });

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const { data: tokenBalance } = useReadContract({
    address: fromToken.address === 'ETH' ? undefined : (fromToken.address as `0x${string}`),
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
    query: { enabled: isConnected && fromToken.address !== 'ETH' },
  });

  const { data: defaultPoolKey } = useReadContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'defaultKey',
    args: [tokenA, tokenB],
    query: { enabled: pairReady && poolMode === 'standard' },
  });

  const { data: hookedPoolKey } = useReadContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'poolKey',
    args: [tokenA, tokenB, DEFAULT_FEE, TICK_SPACING, dynamicFeeHook],
    query: { enabled: pairReady && poolMode === 'hooked' && hookDeployed },
  });

  const activePoolKey = (poolMode === 'hooked' ? hookedPoolKey : defaultPoolKey) as PoolKey | undefined;

  const { data: hookFeePips } = useReadContract({
    address: dynamicFeeHook,
    abi: HOOK_ABI,
    functionName: 'feePips',
    query: { enabled: poolMode === 'hooked' && hookDeployed },
  });

  useEffect(() => {
    let cancelled = false;
    async function quote() {
      if (!publicClient || !activePoolKey || !fromAmount || parseFloat(fromAmount) <= 0) {
        setToAmount('');
        return;
      }
      const tokenIn = fromToken.address === 'ETH' ? weth : (fromToken.address as `0x${string}`);
      const zeroForOne = activePoolKey.currency0.toLowerCase() === tokenIn.toLowerCase();
      try {
        const amountOut = (
          await publicClient.simulateContract({
            address: quoter,
            abi: QUOTER_ABI,
            functionName: 'quoteExactInput',
            args: [activePoolKey, zeroForOne, parseEther(fromAmount)],
          })
        ).result as bigint;
        if (!cancelled) setToAmount(formatEther(amountOut));
      } catch {
        if (!cancelled) setToAmount('');
      }
    }
    void quote();
    return () => {
      cancelled = true;
    };
  }, [publicClient, activePoolKey, fromAmount, fromToken, quoter, weth]);

  const handleApprove = async () => {
    setError(null);
    try {
      await approve();
    } catch (e) {
      console.error('Approve failed:', e);
      setError('Approval failed. Check your wallet and try again.');
    }
  };

  const handleSwap = async () => {
    if (!fromAmount || !isConnected || !activePoolKey) return;
    if (needsApproval && !hasAllowance) return;

    setError(null);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const amountOutMin =
      (parseEther(toAmount || '0') * BigInt(Math.floor((100 - parseFloat(slippage)) * 100))) / 10000n;

    try {
      if (poolMode === 'hooked') {
        const tokenIn = fromToken.address as `0x${string}`;
        await writeContract({
          address: router,
          abi: ROUTER_ABI,
          functionName: 'swapExactInputOnPool',
          args: [activePoolKey, tokenIn, amountIn, amountOutMin, address!, deadline],
        });
        return;
      }

      if (fromToken.address === 'ETH') {
        await writeContract({
          address: router,
          abi: ROUTER_ABI,
          functionName: 'swapExactETHForTokens',
          args: [toToken.address, amountOutMin, address!, deadline],
          value: amountIn,
        });
      } else if (toToken.address === 'ETH') {
        await writeContract({
          address: router,
          abi: ROUTER_ABI,
          functionName: 'swapExactTokensForETH',
          args: [fromToken.address, amountIn, amountOutMin, address!, deadline],
        });
      } else {
        await writeContract({
          address: router,
          abi: ROUTER_ABI,
          functionName: 'swapExactTokensForTokens',
          args: [fromToken.address, toToken.address, amountIn, amountOutMin, address!, deadline],
        });
      }
    } catch (e) {
      console.error('Swap failed:', e);
      setError('Swap failed. Check balance, allowance, and pool liquidity.');
    }
  };

  if (!isConnected) {
    return (
      <div className="text-center py-8">
        <p className="text-white/70 mb-4">Connect your wallet to start swapping</p>
      </div>
    );
  }

  const busy = isPending || isConfirming || isApproving;
  const showApprove = needsApproval && !hasAllowance;
  const hookedUnavailable = poolMode === 'hooked' && !hookDeployed;
  const poolFeeLabel =
    poolMode === 'standard'
      ? '0.30% (default pool)'
      : hookFeePips !== undefined
        ? `${formatFeePips(Number(hookFeePips))} (DynamicFeeHook)`
        : 'DynamicFeeHook';

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white mb-6">Swap</h2>

      <div className="space-y-2">
        <label className="text-sm text-white/70">Pool</label>
        <div className="flex gap-2">
          <button
            onClick={() => setPoolMode('standard')}
            className={`flex-1 py-2 px-3 rounded-lg text-sm ${
              poolMode === 'standard' ? 'bg-white text-gray-900' : 'bg-white/10 text-white'
            }`}
          >
            Standard 0.30%
          </button>
          <button
            onClick={() => setPoolMode('hooked')}
            disabled={!hookDeployed}
            className={`flex-1 py-2 px-3 rounded-lg text-sm disabled:opacity-40 ${
              poolMode === 'hooked' ? 'bg-white text-gray-900' : 'bg-white/10 text-white'
            }`}
          >
            Dynamic fee hook
          </button>
        </div>
        <p className="text-xs text-white/50">
          Fee: {poolFeeLabel}
          {hookedErc20Only ? ' · ERC-20 pairs only on hooked pool' : ''}
        </p>
        {hookedUnavailable ? (
          <p className="text-xs text-amber-300">Deploy with `npm run deploy:v4` to enable the hooked pool.</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="text-sm text-white/70">From</label>
        <div className="bg-white/5 rounded-xl p-4">
          <div className="flex justify-between items-center mb-2">
            <select
              value={fromToken.symbol}
              onChange={(e) => setFromToken(swapTokens.find((t) => t.symbol === e.target.value)!)}
              className="bg-transparent text-white text-lg font-medium"
            >
              {swapTokens.map((token) => (
                <option key={token.symbol} value={token.symbol} className="bg-gray-800">
                  {token.symbol}
                </option>
              ))}
            </select>
            <div className="text-xs text-white/50">
              Balance: {tokenBalance ? formatEther(tokenBalance as bigint) : '0.0'}
            </div>
          </div>
          <input
            type="number"
            value={fromAmount}
            onChange={(e) => setFromAmount(e.target.value)}
            placeholder="0.0"
            className="w-full bg-transparent text-2xl text-white placeholder-white/30 outline-none"
          />
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={() => {
            setFromToken(toToken);
            setToToken(fromToken);
            setFromAmount(toAmount);
            setToAmount(fromAmount);
          }}
          className="bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors"
        >
          ↕
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-white/70">To</label>
        <div className="bg-white/5 rounded-xl p-4">
          <select
            value={toToken.symbol}
            onChange={(e) => setToToken(swapTokens.find((t) => t.symbol === e.target.value)!)}
            className="bg-transparent text-white text-lg font-medium mb-2"
          >
            {swapTokens.map((token) => (
              <option key={token.symbol} value={token.symbol} className="bg-gray-800">
                {token.symbol}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={toAmount}
            readOnly
            placeholder="0.0"
            className="w-full bg-transparent text-2xl text-white placeholder-white/30 outline-none"
          />
        </div>
      </div>

      <div className="flex justify-between items-center text-sm">
        <span className="text-white/70">Slippage</span>
        <div className="flex space-x-2">
          {['0.1', '0.5', '1.0'].map((value) => (
            <button
              key={value}
              onClick={() => setSlippage(value)}
              className={`px-3 py-1 rounded-lg ${
                slippage === value ? 'bg-white text-gray-900' : 'bg-white/10 text-white'
              }`}
            >
              {value}%
            </button>
          ))}
        </div>
      </div>

      {showApprove ? (
        <button
          onClick={handleApprove}
          disabled={!fromAmount || busy || hookedUnavailable}
          className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-xl transition-all"
        >
          {isApproving ? 'Approving...' : `Approve ${fromToken.symbol}`}
        </button>
      ) : (
        <button
          onClick={handleSwap}
          disabled={!fromAmount || !toAmount || busy || hookedUnavailable}
          className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-xl transition-all"
        >
          {isPending || isConfirming ? 'Swapping...' : 'Swap'}
        </button>
      )}

      {error && <div className="text-rose-400 text-center text-sm">{error}</div>}
      {isConfirmed && <div className="text-green-400 text-center text-sm">Swap confirmed</div>}
    </div>
  );
}
