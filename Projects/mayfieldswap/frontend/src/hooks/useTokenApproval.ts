'use client';

import { useEffect, useState } from 'react';
import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { maxUint256 } from 'viem';
import { ERC20_ABI } from '@/contracts/config';

type UseTokenApprovalArgs = {
  token?: `0x${string}`;
  owner?: `0x${string}`;
  spender: `0x${string}`;
  amount: bigint;
  enabled?: boolean;
};

const ZERO = BigInt(0);

export function useTokenApproval({
  token,
  owner,
  spender,
  amount,
  enabled = true,
}: UseTokenApprovalArgs) {
  const needsToken = enabled && !!token && !!owner && amount > ZERO;

  const {
    data: allowance,
    refetch: refetchAllowance,
  } = useReadContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: owner && token ? [owner, spender] : undefined,
    query: { enabled: needsToken },
  });

  const { writeContractAsync, data: hash, isPending, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const [justApproved, setJustApproved] = useState(false);

  useEffect(() => {
    if (!isConfirmed) return;
    setJustApproved(true);
    void refetchAllowance();
  }, [isConfirmed, refetchAllowance]);

  useEffect(() => {
    setJustApproved(false);
    reset();
  }, [token, amount, owner, spender, reset]);

  const currentAllowance = (allowance as bigint | undefined) ?? ZERO;
  const hasAllowance = !needsToken || justApproved || currentAllowance >= amount;

  const approve = async () => {
    if (!token) return;
    setJustApproved(false);
    await writeContractAsync({
      address: token,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, maxUint256],
    });
  };

  return {
    hasAllowance,
    allowance: currentAllowance,
    approve,
    isApproving: isPending || isConfirming,
    refetchAllowance,
  };
}
