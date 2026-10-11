import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ExtensionType,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  getAccount,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
  getTokenMetadata,
  mintTo,
  transfer,
} from "@solana/spl-token";
import { TokenMetadata, createInitializeInstruction, pack } from "@solana/spl-token-metadata";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DECIMALS = 9;
const ONE_TOKEN = 10 ** DECIMALS;

const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const explorerAddr = (addr: string) => `https://explorer.solana.com/address/${addr}?cluster=devnet`;

async function main() {
  // 1. Подключение к Devnet и загрузка кошелька из Solana CLI
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const secretKeyPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(secretKeyPath, "utf-8")));
  const payer = Keypair.fromSecretKey(secretKey);
  console.log("Кошелёк (payer / mint authority):", payer.publicKey.toBase58());

  // 2. Метаданные токена — хранятся прямо в mint-аккаунте (Token-2022 Metadata extension)
  const mint = Keypair.generate();
  const metadata: TokenMetadata = {
    mint: mint.publicKey,
    name: "Bigazy Token",
    symbol: "BGZ",
    uri: "https://example.com/bigazy-token.json",
    additionalMetadata: [["description", "Week 7 course token"]],
  };

  // 3. Считаем размер mint-аккаунта: базовый mint + MetadataPointer + сами метаданные
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

  // 4. Создаём mint: createAccount -> MetadataPointer -> InitializeMint -> InitializeMetadata
  console.log("\n--- Создаём токен (mint) с метаданными ---");
  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMetadataPointerInstruction(
      mint.publicKey,
      payer.publicKey, // authority, который может менять pointer
      mint.publicKey, // метаданные хранятся в самом mint
      TOKEN_2022_PROGRAM_ID
    ),
    createInitializeMintInstruction(
      mint.publicKey,
      DECIMALS,
      payer.publicKey, // mint authority
      null, // freeze authority отсутствует
      TOKEN_2022_PROGRAM_ID
    ),
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      mint: mint.publicKey,
      metadata: mint.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      mintAuthority: payer.publicKey,
      updateAuthority: payer.publicKey,
    })
  );
  const createSig = await sendAndConfirmTransaction(connection, createMintTx, [payer, mint]);
  console.log("Mint адрес:", mint.publicKey.toBase58());
  console.log("Транзакция:", explorerTx(createSig));

  // 5. Token-аккаунт (ATA) владельца и выпуск 1000 токенов
  console.log("\n--- Выпускаем 1000 токенов себе ---");
  const ownerAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, mint.publicKey, payer.publicKey,
    false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID
  );
  const mintSig = await mintTo(
    connection, payer, mint.publicKey, ownerAta.address, payer,
    1000 * ONE_TOKEN, [], undefined, TOKEN_2022_PROGRAM_ID
  );
  console.log("Транзакция mint:", explorerTx(mintSig));

  // 6. Второй кошелёк и transfer 100 токенов
  console.log("\n--- Transfer 100 токенов на второй кошелёк ---");
  const recipient = Keypair.generate();
  console.log("Получатель:", recipient.publicKey.toBase58());
  const recipientAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, mint.publicKey, recipient.publicKey,
    false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID
  );
  const transferSig = await transfer(
    connection, payer, ownerAta.address, recipientAta.address, payer,
    100 * ONE_TOKEN, [], undefined, TOKEN_2022_PROGRAM_ID
  );
  console.log("Транзакция transfer:", explorerTx(transferSig));

  // 7. Читаем итоговое состояние напрямую из блокчейна
  const ownerAcc = await getAccount(connection, ownerAta.address, "confirmed", TOKEN_2022_PROGRAM_ID);
  const recipientAcc = await getAccount(connection, recipientAta.address, "confirmed", TOKEN_2022_PROGRAM_ID);
  const onChainMeta = await getTokenMetadata(connection, mint.publicKey);

  console.log("\n=== Итог ===");
  console.log("Метаданные из блокчейна:", onChainMeta?.name, "/", onChainMeta?.symbol, "/", onChainMeta?.uri);
  console.log("Баланс владельца:  ", Number(ownerAcc.amount) / ONE_TOKEN, "BGZ");
  console.log("Баланс получателя: ", Number(recipientAcc.amount) / ONE_TOKEN, "BGZ");
  console.log("\nExplorer (mint):", explorerAddr(mint.publicKey.toBase58()));
}

main().catch((err) => {
  console.error("Ошибка:", err);
  process.exit(1);
});
