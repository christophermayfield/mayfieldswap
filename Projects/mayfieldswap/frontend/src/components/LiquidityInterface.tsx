'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { CONTRACT_ADDRESSES, ROUTER_ABI, ERC20_ABI } from '@/contracts/config';

const CHAIN_ID = 31337;

const TOKENS = [
  { symbol: 'MF-A', address: CONTRACT_ADDRESSES[CHAIN_ID].TokenA, name: 'Mayfield A' },
  { symbol: 'MF-B', address: CONTRACT_ADDRESSES[CHAIN_ID].TokenB, name: 'Mayfield B' },
];

export default function LiquidityInterface() {
  const { address, isConnected } = useAccount();
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [tokenA, setTokenA] = useState(TOKENS[0]);
  const [tokenB, setTokenB] = useState(TOKENS[1]);
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');

  const router = CONTRACT_ADDRESSES[CHAIN_ID].MayfieldRouter as `0x${string}`;
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const { data: lpBalance } = useReadContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'getLiquidity',
    args: [tokenA.address, tokenB.address, address],
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

  const handleAddLiquidity = async () => {
    if (!amountA || !amountB || !isConnected) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const a = parseEther(amountA);
    const b = parseEther(amountB);
    try {
      await writeContract({
        address: router,
        abi: ROUTER_ABI,
        functionName: 'addLiquidity',
        args: [tokenA.address, tokenB.address, a, b, (a * 95n) / 100n, (b * 95n) / 100n, address!, deadline],
      });
    } catch (error) {
      console.error(error);
    }
  };

  const handleRemoveLiquidity = async () => {
    if (!lpBalance || !isConnected) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    try {
      await writeContract({
        address: router,
        abi: ROUTER_ABI,
        functionName: 'removeLiquidity',
        args: [tokenA.address, tokenB.address, (lpBalance as bigint) / 2n, 0n, 0n, address!, deadline],
      });
    } catch (error) {
      console.error(error);
    }
  };

  if (!isConnected) {
    return (
      <div className="text-center py-8">
        <p className="text-white/70 mb-4">Connect your wallet to manage liquidity</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-white mb-2">Liquidity</h2>
      <p className="text-white/60 text-sm">Full-range concentrated liquidity (V4-style PoolManager)</p>

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
          <button
            onClick={handleAddLiquidity}
            disabled={!amountA || !amountB || isPending || isConfirming}
            className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 rounded-xl"
          >
            {isPending || isConfirming ? 'Adding...' : 'Add Liquidity'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white/5 rounded-xl p-4 flex justify-between">
            <span className="text-white/70">Your liquidity</span>
            <span className="text-white">{lpBalance ? formatEther(lpBalance as bigint) : '0.0'}</span>
          </div>
          <button
            onClick={handleRemoveLiquidity}
            disabled={!lpBalance || lpBalance === 0n || isPending || isConfirming}
            className="w-full bg-gradient-to-r from-rose-500 to-orange-600 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 rounded-xl"
          >
            {isPending || isConfirming ? 'Removing...' : 'Remove 50%'}
          </button>
        </div>
      )}

      {isConfirmed && <div className="text-green-400 text-center text-sm">Transaction confirmed</div>}
    </div>
  );
}
