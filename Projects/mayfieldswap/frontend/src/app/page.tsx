'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import SwapInterface from '@/components/SwapInterface';
import LiquidityInterface from '@/components/LiquidityInterface';
import PositionNFTInterface from '@/components/PositionNFTInterface';
import PoolInspectorInterface from '@/components/PoolInspectorInterface';
import PriceChart from '@/components/PriceChart';
import { useState } from 'react';
import { CONTRACT_ADDRESSES } from '@/contracts/config';

const CHAIN_ID = 31337;

export default function Home() {
  const [activeTab, setActiveTab] = useState<'swap' | 'liquidity' | 'positions' | 'inspect' | 'chart'>('swap');

  const tabs = [
    ['swap', 'Swap'],
    ['liquidity', 'Liq'],
    ['positions', 'NFTs'],
    ['inspect', 'Pool'],
    ['chart', 'Chart'],
  ] as const;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900">
      {/* Header */}
      <header className="p-6 flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <h1 className="text-3xl font-bold text-white">MayfieldSwap</h1>
          <span className="text-white/60 text-sm">V4 concentrated liquidity</span>
        </div>
        <ConnectButton />
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <div className={`mx-auto ${activeTab === 'chart' ? 'max-w-2xl' : 'max-w-md'}`}>
          {/* Tab Navigation */}
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-1 mb-6">
            <div className="flex">
              {tabs.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-all ${
                    activeTab === id ? 'bg-white text-gray-900' : 'text-white/70 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Interface Content */}
          <div className={`bg-white/10 backdrop-blur-md rounded-2xl p-6 ${activeTab === 'chart' ? 'max-w-2xl' : ''}`}>
            {activeTab === 'swap' ? (
              <SwapInterface />
            ) : activeTab === 'liquidity' ? (
              <LiquidityInterface />
            ) : activeTab === 'positions' ? (
              <PositionNFTInterface />
            ) : activeTab === 'chart' ? (
              <PriceChart
                poolManagerAddress={CONTRACT_ADDRESSES[CHAIN_ID].PoolManager as `0x${string}`}
                token0Address={CONTRACT_ADDRESSES[CHAIN_ID].TokenA as `0x${string}`}
                token1Address={CONTRACT_ADDRESSES[CHAIN_ID].TokenB as `0x${string}`}
                token0Symbol="MF-A"
                token1Symbol="MF-B"
              />
            ) : (
              <PoolInspectorInterface />
            )}
          </div>
        </div>

        {/* Features Section */}
        <div className="mt-16 grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6">
            <div className="text-2xl mb-4">⚡</div>
            <h3 className="text-xl font-bold text-white mb-2">Singleton swaps</h3>
            <p className="text-white/70">
              Unlock/flash accounting against a Uniswap V4–style PoolManager on a local chain.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6">
            <div className="text-2xl mb-4">💰</div>
            <h3 className="text-xl font-bold text-white mb-2">Concentrated ranges</h3>
            <p className="text-white/70">
              Choose a tick range. Liquidity is active — and earns fees — only while the pool price is inside it.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6">
            <div className="text-2xl mb-4">🧪</div>
            <h3 className="text-xl font-bold text-white mb-2">Educational</h3>
            <p className="text-white/70">
              Local-only demo software. Not audited — do not use with real funds.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}