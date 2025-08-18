'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { CONTRACT_ADDRESSES, ROUTER_ABI, ERC20_ABI, FACTORY_ABI, PAIR_ABI } from '@/contracts/config';

const TOKENS = [
  { symbol: 'ETH', address: 'ETH', name: 'Ethereum' },
  { symbol: 'SUSH-A', address: CONTRACT_ADDRESSES[31337].TokenA, name: 'SushiToken A' },
  { symbol: 'SUSH-B', address: CONTRACT_ADDRESSES[31337].TokenB, name: 'SushiToken B' },
];

export default function LiquidityInterface() {
  const { address, isConnected } = useAccount();
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [tokenA, setTokenA] = useState(TOKENS[1]);
  const [tokenB, setTokenB] = useState(TOKENS[2]);
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  // Get pair address
  const { data: pairAddress } = useReadContract({
    address: CONTRACT_ADDRESSES[31337].SushiFactory as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: 'getPair',
    args: [tokenA.address, tokenB.address],
    query: {
      enabled: tokenA.address !== 'ETH' && tokenB.address !== 'ETH'
    }
  });

  // Get LP token balance
  const { data: lpBalance } = useReadContract({
    address: pairAddress as `0x${string}`,
    abi: PAIR_ABI,
    functionName: 'balanceOf',
    args: [address],
    query: {
      enabled: !!pairAddress && !!address
    }
  });

  // Get token balances
  const { data: balanceA } = useReadContract({
    address: tokenA.address === 'ETH' ? undefined : tokenA.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
    query: {
      enabled: isConnected && tokenA.address !== 'ETH'
    }
  });

  const { data: balanceB } = useReadContract({
    address: tokenB.address === 'ETH' ? undefined : tokenB.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
    query: {
      enabled: isConnected && tokenB.address !== 'ETH'
    }
  });

  const handleAddLiquidity = async () => {
    if (!amountA || !amountB || !isConnected) return;

    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
    const amountADesired = parseEther(amountA);
    const amountBDesired = parseEther(amountB);
    const amountAMin = amountADesired * 95n / 100n; // 5% slippage
    const amountBMin = amountBDesired * 95n / 100n; // 5% slippage

    try {
      if (tokenA.address === 'ETH' || tokenB.address === 'ETH') {
        const token = tokenA.address === 'ETH' ? tokenB : tokenA;
        const tokenAmount = tokenA.address === 'ETH' ? amountB : amountA;
        const ethAmount = tokenA.address === 'ETH' ? amountA : amountB;

        await writeContract({
          address: CONTRACT_ADDRESSES[31337].SushiRouter as `0x${string}`,
          abi: ROUTER_ABI,
          functionName: 'addLiquidityETH',
          args: [
            token.address,
            parseEther(tokenAmount),
            parseEther(tokenAmount) * 95n / 100n,
            parseEther(ethAmount) * 95n / 100n,
            address!,
            deadline
          ],
          value: parseEther(ethAmount)
        });
      } else {
        await writeContract({
          address: CONTRACT_ADDRESSES[31337].SushiRouter as `0x${string}`,
          abi: ROUTER_ABI,
          functionName: 'addLiquidity',
          args: [
            tokenA.address,
            tokenB.address,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            address!,
            deadline
          ]
        });
      }
    } catch (error) {
      console.error('Add liquidity failed:', error);
    }
  };

  const handleRemoveLiquidity = async () => {
    if (!lpBalance || !isConnected) return;

    const deadline = Math.floor(Date.now() / 1000) + 300;
    const liquidityToRemove = lpBalance / 2n; // Remove 50% of liquidity

    try {
      await writeContract({
        address: CONTRACT_ADDRESSES[31337].SushiRouter as `0x${string}`,
        abi: ROUTER_ABI,
        functionName: 'removeLiquidity',
        args: [
          tokenA.address,
          tokenB.address,
          liquidityToRemove,
          0n, // Accept any amount
          0n, // Accept any amount
          address!,
          deadline
        ]
      });
    } catch (error) {
      console.error('Remove liquidity failed:', error);
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
      <h2 className="text-xl font-bold text-white mb-6">Liquidity Pool</h2>
      
      {/* Mode Toggle */}
      <div className="flex bg-white/5 rounded-xl p-1">
        <button
          onClick={() => setMode('add')}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
            mode === 'add' ? 'bg-white text-gray-900' : 'text-white/70'
          }`}
        >
          Add Liquidity
        </button>
        <button
          onClick={() => setMode('remove')}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
            mode === 'remove' ? 'bg-white text-gray-900' : 'text-white/70'
          }`}
        >
          Remove Liquidity
        </button>
      </div>

      {mode === 'add' ? (
        <div className="space-y-4">
          {/* Token A */}
          <div className="space-y-2">
            <label className="text-sm text-white/70">Token A</label>
            <div className="bg-white/5 rounded-xl p-4">
              <div className="flex justify-between items-center mb-2">
                <select 
                  value={tokenA.symbol}
                  onChange={(e) => setTokenA(TOKENS.find(t => t.symbol === e.target.value)!)}
                  className="bg-transparent text-white text-lg font-medium"
                >
                  {TOKENS.map(token => (
                    <option key={token.symbol} value={token.symbol} className="bg-gray-800">
                      {token.symbol}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-white/50">
                  Balance: {balanceA ? formatEther(balanceA) : '0.0'}
                </div>
              </div>
              <input
                type="number"
                value={amountA}
                onChange={(e) => setAmountA(e.target.value)}
                placeholder="0.0"
                className="w-full bg-transparent text-2xl text-white placeholder-white/30 outline-none"
              />
            </div>
          </div>

          {/* Token B */}
          <div className="space-y-2">
            <label className="text-sm text-white/70">Token B</label>
            <div className="bg-white/5 rounded-xl p-4">
              <div className="flex justify-between items-center mb-2">
                <select 
                  value={tokenB.symbol}
                  onChange={(e) => setTokenB(TOKENS.find(t => t.symbol === e.target.value)!)}
                  className="bg-transparent text-white text-lg font-medium"
                >
                  {TOKENS.map(token => (
                    <option key={token.symbol} value={token.symbol} className="bg-gray-800">
                      {token.symbol}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-white/50">
                  Balance: {balanceB ? formatEther(balanceB) : '0.0'}
                </div>
              </div>
              <input
                type="number"
                value={amountB}
                onChange={(e) => setAmountB(e.target.value)}
                placeholder="0.0"
                className="w-full bg-transparent text-2xl text-white placeholder-white/30 outline-none"
              />
            </div>
          </div>

          <button
            onClick={handleAddLiquidity}
            disabled={!amountA || !amountB || isPending || isConfirming}
            className="w-full bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-xl transition-all"
          >
            {isPending || isConfirming ? 'Adding Liquidity...' : 'Add Liquidity'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* LP Token Info */}
          <div className="bg-white/5 rounded-xl p-4">
            <div className="flex justify-between items-center">
              <span className="text-white/70">Your LP Tokens</span>
              <span className="text-white font-medium">
                {lpBalance ? formatEther(lpBalance) : '0.0'}
              </span>
            </div>
            <div className="flex justify-between items-center mt-2">
              <span className="text-white/70">Pair</span>
              <span className="text-white font-medium">
                {tokenA.symbol}/{tokenB.symbol}
              </span>
            </div>
          </div>

          <button
            onClick={handleRemoveLiquidity}
            disabled={!lpBalance || lpBalance === 0n || isPending || isConfirming}
            className="w-full bg-gradient-to-r from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-xl transition-all"
          >
            {isPending || isConfirming ? 'Removing Liquidity...' : 'Remove 50% Liquidity'}
          </button>
        </div>
      )}

      {isConfirmed && (
        <div className="text-green-400 text-center text-sm">
          Transaction completed successfully!
        </div>
      )}
    </div>
  );
}
