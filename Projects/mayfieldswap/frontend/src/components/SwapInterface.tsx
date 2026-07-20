'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { CONTRACT_ADDRESSES, ROUTER_ABI, QUOTER_ABI, ERC20_ABI } from '@/contracts/config';

const CHAIN_ID = 31337;

const TOKENS = [
  { symbol: 'ETH', address: 'ETH', name: 'Ethereum' },
  { symbol: 'MF-A', address: CONTRACT_ADDRESSES[CHAIN_ID].TokenA, name: 'Mayfield A' },
  { symbol: 'MF-B', address: CONTRACT_ADDRESSES[CHAIN_ID].TokenB, name: 'Mayfield B' },
];

export default function SwapInterface() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [fromToken, setFromToken] = useState(TOKENS[0]);
  const [toToken, setToToken] = useState(TOKENS[1]);
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [slippage, setSlippage] = useState('0.5');

  const router = CONTRACT_ADDRESSES[CHAIN_ID].MayfieldRouter as `0x${string}`;
  const quoter = CONTRACT_ADDRESSES[CHAIN_ID].Quoter as `0x${string}`;
  const weth = CONTRACT_ADDRESSES[CHAIN_ID].WETH;

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const { data: tokenBalance } = useReadContract({
    address: fromToken.address === 'ETH' ? undefined : (fromToken.address as `0x${string}`),
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
    query: { enabled: isConnected && fromToken.address !== 'ETH' },
  });

  const { data: poolKey } = useReadContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'defaultKey',
    args: [
      fromToken.address === 'ETH' ? weth : fromToken.address,
      toToken.address === 'ETH' ? weth : toToken.address,
    ],
    query: {
      enabled:
        !!fromAmount &&
        fromToken.address !== toToken.address &&
        !(fromToken.address === 'ETH' && toToken.address === 'ETH'),
    },
  });

  useEffect(() => {
    let cancelled = false;
    async function quote() {
      if (!publicClient || !poolKey || !fromAmount || parseFloat(fromAmount) <= 0) {
        setToAmount('');
        return;
      }
      const tokenIn = fromToken.address === 'ETH' ? weth : fromToken.address;
      const key = poolKey as {
        currency0: string;
        currency1: string;
        fee: number;
        tickSpacing: number;
        hooks: string;
      };
      const zeroForOne = key.currency0.toLowerCase() === tokenIn.toLowerCase();
      try {
        const amountOut = (await publicClient.simulateContract({
          address: quoter,
          abi: QUOTER_ABI,
          functionName: 'quoteExactInput',
          args: [key, zeroForOne, parseEther(fromAmount)],
        })).result as bigint;
        if (!cancelled) setToAmount(formatEther(amountOut));
      } catch {
        if (!cancelled) setToAmount('');
      }
    }
    quote();
    return () => {
      cancelled = true;
    };
  }, [publicClient, poolKey, fromAmount, fromToken, toToken, quoter, weth]);

  const handleSwap = async () => {
    if (!fromAmount || !isConnected) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const amountIn = parseEther(fromAmount);
    const amountOutMin =
      (parseEther(toAmount || '0') * BigInt(Math.floor((100 - parseFloat(slippage)) * 100))) / 10000n;

    try {
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
    } catch (error) {
      console.error('Swap failed:', error);
    }
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
      <h2 className="text-xl font-bold text-white mb-6">Swap</h2>

      <div className="space-y-2">
        <label className="text-sm text-white/70">From</label>
        <div className="bg-white/5 rounded-xl p-4">
          <div className="flex justify-between items-center mb-2">
            <select
              value={fromToken.symbol}
              onChange={(e) => setFromToken(TOKENS.find((t) => t.symbol === e.target.value)!)}
              className="bg-transparent text-white text-lg font-medium"
            >
              {TOKENS.map((token) => (
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
            onChange={(e) => setToToken(TOKENS.find((t) => t.symbol === e.target.value)!)}
            className="bg-transparent text-white text-lg font-medium mb-2"
          >
            {TOKENS.map((token) => (
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

      <button
        onClick={handleSwap}
        disabled={!fromAmount || !toAmount || isPending || isConfirming}
        className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-xl transition-all"
      >
        {isPending || isConfirming ? 'Swapping...' : 'Swap'}
      </button>

      {isConfirmed && <div className="text-green-400 text-center text-sm">Swap confirmed</div>}
    </div>
  );
}
