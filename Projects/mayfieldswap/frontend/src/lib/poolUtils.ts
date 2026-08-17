import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem';

export type PoolKey = {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
};

const POOL_KEY_PARAMS = parseAbiParameters(
  '(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)'
);

export function poolIdFromKey(key: PoolKey): `0x${string}` {
  return keccak256(
    encodeAbiParameters(POOL_KEY_PARAMS, [
      {
        currency0: key.currency0,
        currency1: key.currency1,
        fee: key.fee,
        tickSpacing: key.tickSpacing,
        hooks: key.hooks,
      },
    ])
  );
}

export function formatFeePips(pips: number) {
  return `${(pips / 10_000).toFixed(2)}%`;
}

export function sqrtPriceX96ToPrice(sqrtPriceX96: bigint): number {
  const ratio = Number(sqrtPriceX96) / Number(2n ** 96n);
  return ratio * ratio;
}

export function shortenAddress(address: string, chars = 4) {
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function alignTick(tick: number, spacing: number) {
  return Math.trunc(tick / spacing) * spacing;
}
