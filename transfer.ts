import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  getTokenMetadata,
  transfer,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Mint, созданный первым скриптом (index.ts)
const MINT = new PublicKey("D8k6Dgo4zRquY2mFxduhkVbs9cpQJBU3Ryko9aya8GtS");
const DECIMALS = 9;
const ONE_TOKEN = 10 ** DECIMALS;

const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

// Повторяет операцию при сетевых сбоях (WSL иногда теряет соединение)
async function retry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      console.log(`[${label}] попытка ${i}/${attempts} не удалась, повторяем...`);
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error("unreachable");
}

async function main() {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const secretKeyPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(secretKeyPath, "utf-8")));
  const payer = Keypair.fromSecretKey(secretKey);

  const ownerAta = await retry("owner ATA", () =>
    getOrCreateAssociatedTokenAccount(
      connection, payer, MINT, payer.publicKey,
      false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID
    )
  );

  const recipient = Keypair.generate();
  console.log("Получатель:", recipient.publicKey.toBase58());
  const recipientAta = await retry("recipient ATA", () =>
    getOrCreateAssociatedTokenAccount(
      connection, payer, MINT, recipient.publicKey,
      false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID
    )
  );

  console.log("\n--- Transfer 100 токенов ---");
  const sig = await retry("transfer", () =>
    transfer(
      connection, payer, ownerAta.address, recipientAta.address, payer,
      100 * ONE_TOKEN, [], undefined, TOKEN_2022_PROGRAM_ID
    )
  );
  console.log("Транзакция transfer:", explorerTx(sig));

  const ownerAcc = await retry("read owner", () =>
    getAccount(connection, ownerAta.address, "confirmed", TOKEN_2022_PROGRAM_ID)
  );
  const recipientAcc = await retry("read recipient", () =>
    getAccount(connection, recipientAta.address, "confirmed", TOKEN_2022_PROGRAM_ID)
  );
  const meta = await retry("read metadata", () => getTokenMetadata(connection, MINT));

  console.log("\n=== Итог ===");
  console.log("Метаданные из блокчейна:", meta?.name, "/", meta?.symbol, "/", meta?.uri);
  console.log("Баланс владельца:  ", Number(ownerAcc.amount) / ONE_TOKEN, "BGZ");
  console.log("Баланс получателя: ", Number(recipientAcc.amount) / ONE_TOKEN, "BGZ");
  console.log("\nExplorer (mint): https://explorer.solana.com/address/" + MINT.toBase58() + "?cluster=devnet");
}

main().catch((err) => {
  console.error("Ошибка:", err);
  process.exit(1);
});
