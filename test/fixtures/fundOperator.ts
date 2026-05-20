/**
 * Test bootstrap: gives the operator wallet (and optionally the test provider)
 * xDAI + xBZZ on the anvil fork. The contracts live on Gnosis mainnet at the
 * addresses configured via env (managed by the t4t repo), so we don't deploy
 * anything — we just fund the test wallets against the existing tokens.
 *
 * Two cheatcodes:
 *   - `anvil_setBalance(addr, wei)`         seeds native xDAI
 *   - `anvil_impersonateAccount(whale)`     lets us send `xBZZ.transfer` as the whale
 *
 * The whale address is configurable via `XBZZ_WHALE` env (default below is a
 * known high-balance holder on Gnosis Chain). Refresh from Gnosisscan if the
 * default ever runs dry.
 */
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { gnosis } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export interface FundConfig {
  rpcUrl: string;
  xbzzAddress: Address;
  whale: Address;
  recipients: Array<{ address: Address; xdai: bigint; xbzz: bigint }>;
}

export async function fundOperator(cfg: FundConfig): Promise<void> {
  const transport = http(cfg.rpcUrl);
  const pub = createPublicClient({ chain: gnosis, transport });
  const test = createTestClient({ chain: gnosis, transport, mode: 'anvil' });

  // xDAI via setBalance — instant, no impersonation needed.
  for (const r of cfg.recipients) {
    await test.setBalance({ address: r.address, value: r.xdai });
  }

  // xBZZ via impersonation + transfer. The whale must have ≥ Σ xbzz on chain.
  await test.impersonateAccount({ address: cfg.whale });
  // Make sure the whale itself has xDAI to pay gas on the transfer.
  await test.setBalance({ address: cfg.whale, value: parseEther('1') });

  const whaleClient = createWalletClient({
    chain: gnosis,
    transport,
    account: cfg.whale,
  });
  for (const r of cfg.recipients) {
    const hash = await whaleClient.writeContract({
      address: cfg.xbzzAddress,
      abi: ERC20_TRANSFER_ABI,
      functionName: 'transfer',
      args: [r.address, r.xbzz],
    });
    await pub.waitForTransactionReceipt({ hash });
  }
  await test.stopImpersonatingAccount({ address: cfg.whale });

  // Sanity-check the funding landed.
  for (const r of cfg.recipients) {
    const bal = (await pub.readContract({
      address: cfg.xbzzAddress,
      abi: ERC20_TRANSFER_ABI,
      functionName: 'balanceOf',
      args: [r.address],
    })) as bigint;
    if (bal < r.xbzz) {
      throw new Error(`funding failed: ${r.address} expected ${r.xbzz}, got ${bal}`);
    }
  }
}

/**
 * Convenience: derive the operator address from `OPERATOR_PRIVATE_KEY` and
 * apply a standard funding amount (1k xBZZ + 1 xDAI).
 */
export async function fundOperatorFromEnv(extra: Address[] = []): Promise<void> {
  const operator = privateKeyToAccount(process.env.OPERATOR_PRIVATE_KEY as Hex).address;
  const recipients = [
    { address: operator, xdai: parseEther('1'), xbzz: 1000n * 10n ** 18n },
    ...extra.map((address) => ({
      address,
      xdai: parseEther('1'),
      xbzz: 1000n * 10n ** 18n,
    })),
  ];
  await fundOperator({
    rpcUrl: process.env.GNOSIS_RPC_URL ?? 'http://localhost:8545',
    xbzzAddress: (process.env.XBZZ_ADDRESS ?? '0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da') as Address,
    // The "t4t wallet" on Gnosis — a known funded address that's used as the
    // impersonation source on the fork. Holds xBZZ + xDAI on mainnet, so on
    // the fork we anvil_impersonateAccount it and transfer to the operator.
    whale: (process.env.XBZZ_WHALE ?? '0xaCfE00BeA3f8acC8e500c7Ea6421902014778a85') as Address,
    recipients,
  });
}
