'use client';

import { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { parseAbiItem } from 'viem';

interface Props {
  poolManagerAddress: `0x${string}`;
  token0Address: `0x${string}`;
  token1Address: `0x${string}`;
  token0Symbol: string;
  token1Symbol: string;
}

interface ChartPoint {
  block: string;
  price: number;
  volume: number;
}

const SWAP_EVENT = parseAbiItem(
  'event Swap(bytes32 indexed id, address indexed sender, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)'
);

function sqrtPriceToPrice(sqrtPriceX96: bigint): number {
  // price = (sqrtPriceX96 / 2^96)^2
  const Q96 = 2 ** 96;
  const sqrt = Number(sqrtPriceX96) / Q96;
  return sqrt * sqrt;
}

export default function PriceChart({ poolManagerAddress, token0Symbol, token1Symbol }: Props) {
  const publicClient = usePublicClient();
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSwaps() {
      if (!publicClient) return;
      setLoading(true);
      setError(null);

      try {
        const latestBlock = await publicClient.getBlockNumber();
        const fromBlock = latestBlock > 500n ? latestBlock - 500n : 0n;

        const logs = await publicClient.getLogs({
          address: poolManagerAddress,
          event: SWAP_EVENT,
          fromBlock,
          toBlock: latestBlock,
        });

        // Take last 50 swaps
        const recent = logs.slice(-50);

        const points: ChartPoint[] = recent.map((log) => {
          const { sqrtPriceX96, amount0 } = log.args as {
            sqrtPriceX96: bigint;
            amount0: bigint;
          };
          const price = sqrtPriceToPrice(sqrtPriceX96);
          const volume = Math.abs(Number(amount0)) / 1e18;
          return {
            block: log.blockNumber?.toString() ?? '?',
            price: parseFloat(price.toFixed(6)),
            volume: parseFloat(volume.toFixed(4)),
          };
        });

        if (!cancelled) setData(points);
      } catch (e) {
        if (!cancelled) setError('Could not load swap events. Make sure the local node is running.');
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchSwaps();

    // Refresh every 12 seconds (≈1 block)
    const interval = setInterval(fetchSwaps, 12_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [publicClient, poolManagerAddress]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-white">
          {token0Symbol} / {token1Symbol} Price
        </h2>
        {loading && <span className="text-xs text-white/50">Refreshing...</span>}
      </div>

      {error && (
        <div className="text-rose-400 text-sm text-center py-4">{error}</div>
      )}

      {!error && data.length === 0 && !loading && (
        <div className="text-white/50 text-sm text-center py-8">
          No swaps found in the last 500 blocks.
          <br />
          Execute a swap to see price data here.
        </div>
      )}

      {data.length > 0 && (
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis
              dataKey="block"
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              label={{ value: 'Block', position: 'insideBottom', offset: -2, fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
            />
            <YAxis
              yAxisId="price"
              orientation="left"
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => v.toFixed(4)}
            />
            <YAxis
              yAxisId="volume"
              orientation="right"
              tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => v.toFixed(2)}
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(15,15,30,0.95)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
                color: 'white',
              }}
              formatter={(value, name) => [
                typeof value === 'number' ? (name === 'price' ? value.toFixed(6) : value.toFixed(4)) : String(value),
                name === 'price' ? `${token1Symbol}/${token0Symbol}` : 'Volume',
              ]}
            />
            <Legend
              wrapperStyle={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}
            />
            <Bar yAxisId="volume" dataKey="volume" fill="rgba(99,102,241,0.4)" name="volume" />
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="price"
              stroke="#22d3ee"
              strokeWidth={2}
              dot={false}
              name="price"
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <p className="text-xs text-white/30 text-center">
        Last 50 Swap events · refreshes every 12 s
      </p>
    </div>
  );
}
