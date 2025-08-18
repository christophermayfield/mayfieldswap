'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { CONTRACT_ADDRESSES, ROUTER_ABI, ERC20_ABI } from '@/contracts/config';

const TOKENS = [
  { symbol: 'ETH', address: 'ETH', name: 'Ethereum' },
  { symbol: 'SUSH-A', address: CONTRACT_ADDRESSES[31337].TokenA, name: 'SushiToken A' },
  { symbol: 'SUSH-B', address: CONTRACT_ADDRESSES[31337].TokenB, name: 'SushiToken B' },
];

export default function SwapInterface() {
  const { address, isConnected } = useAccount();
  const [fromToken, setFromToken] = useState(TOKENS[0]);
  const [toToken, setToToken] = useState(TOKENS[1]);
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [slippage, setSlippage] = useState('0.5');

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  // Get token balance
  const { data: tokenBalance } = useReadContract({
    address: fromToken.address === 'ETH' ? undefined : fromToken.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
    query: {
      enabled: isConnected && fromToken.address !== 'ETH'
    }
  });

  // Get estimated output amount
  const { data: amountsOut } = useReadContract({
    address: CONTRACT_ADDRESSES[31337].SushiRouter as `0x${string}`,
    abi: ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: [
      fromAmount ? parseEther(fromAmount) : 0n,
      fromToken.address === 'ETH' 
        ? [CONTRACT_ADDRESSES[31337].WETH, toToken.address]
        : toToken.address === 'ETH'
        ? [fromToken.address, CONTRACT_ADDRESSES[31337].WETH]
        : [fromToken.address, toToken.address]
    ],
    query: {
      enabled: !!fromAmount && parseFloat(fromAmount) > 0
    }
  });

  useEffect(() => {
    if (amountsOut && Array.isArray(amountsOut) && amountsOut.length > 1) {
      setToAmount(formatEther(amountsOut[1]));
    }
  }, [amountsOut]);

  const handleSwap = async () => {
    if (!fromAmount || !isConnected) return;

    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
    const amountIn = parseEther(fromAmount);
    const amountOutMin = parseEther(toAmount) * BigInt(Math.floor((100 - parseFloat(slippage)) * 100)) / 10000n;

    try {
      if (fromToken.address === 'ETH') {
        // ETH to Token
        await writeContract({
          address: CONTRACT_ADDRESSES[31337].SushiRouter as `0x${string}`,
          abi: ROUTER_ABI,
          functionName: 'swapExactETHForTokens',
          args: [
            amountOutMin,
            [CONTRACT_ADDRESSES[31337].WETH, toToken.address],
            address!,
            deadline
          ],
          value: amountIn
        });
      } else if (toToken.address === 'ETH') {
        // Token to ETH
        await writeContract({
          address: CONTRACT_ADDRESSES[31337].SushiRouter as `0x${string}`,
          abi: ROUTER_ABI,
          functionName: 'swapExactTokensForETH',
          args: [
            amountIn,
            amountOutMin,
            [fromToken.address, CONTRACT_ADDRESSES[31337].WETH],
            address!,
            deadline
          ]
        });
      } else {
        // Token to Token
        await writeContract({
          address: CONTRACT_ADDRESSES[31337].SushiRouter as `0x${string}`,
          abi: ROUTER_ABI,
          functionName: 'swapExactTokensForTokens',
          args: [
            amountIn,
            amountOutMin,
            [fromToken.address, toToken.address],
            address!,
            deadline
          ]
        });
      }
    } catch (error) {
      console.error('Swap failed:', error);
    }
  };

  const switchTokens = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
  };

  if (!isConnected) {
    return (
      <div className="text-center py-8">
        <p className="text-white/70 mb-4">Connect your wallet to start swapping</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white mb-6">Swap Tokens</h2>
      
      {/* From Token */}
      <div className="space-y-2">
        <label className="text-sm text-white/70">From</label>
        <div className="bg-white/5 rounded-xl p-4">
          <div className="flex justify-between items-center mb-2">
            <select 
              value={fromToken.symbol}
              onChange={(e) => setFromToken(TOKENS.find(t => t.symbol === e.target.value)!)}
              className="bg-transparent text-white text-lg font-medium"
            >
              {TOKENS.map(token => (
                <option key={token.symbol} value={token.symbol} className="bg-gray-800">
                  {token.symbol}
                </option>
              ))}
            </select>
            <div className="text-xs text-white/50">
              Balance: {tokenBalance ? formatEther(tokenBalance) : '0.0'}
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

      {/* Swap Button */}
      <div className="flex justify-center">
        <button
          onClick={switchTokens}
          className="bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors"
        >
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
      </div>

      {/* To Token */}
      <div className="space-y-2">
        <label className="text-sm text-white/70">To</label>
        <div className="bg-white/5 rounded-xl p-4">
          <div className="flex justify-between items-center mb-2">
            <select 
              value={toToken.symbol}
              onChange={(e) => setToToken(TOKENS.find(t => t.symbol === e.target.value)!)}
              className="bg-transparent text-white text-lg font-medium"
            >
              {TOKENS.map(token => (
                <option key={token.symbol} value={token.symbol} className="bg-gray-800">
                  {token.symbol}
                </option>
              ))}
            </select>
          </div>
          <input
            type="number"
            value={toAmount}
            readOnly
            placeholder="0.0"
            className="w-full bg-transparent text-2xl text-white placeholder-white/30 outline-none"
          />
        </div>
      </div>

      {/* Slippage */}
      <div className="flex justify-between items-center text-sm">
        <span className="text-white/70">Slippage Tolerance</span>
        <div className="flex space-x-2">
          {['0.1', '0.5', '1.0'].map(value => (
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

      {/* Swap Button */}
      <button
        onClick={handleSwap}
        disabled={!fromAmount || isPending || isConfirming}
        className="w-full bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-xl transition-all"
      >
        {isPending || isConfirming ? 'Swapping...' : 'Swap'}
      </button>

      {isConfirmed && (
        <div className="text-green-400 text-center text-sm">
          Swap completed successfully!
        </div>
      )}
    </div>
  );
}
