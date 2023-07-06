import { config } from "dotenv";
import { resolve } from "path";
import { GatewayIntentBits } from "discord.js";
import ExtendedClient from "./common/ExtendedClient";

const envFileName = process.env.NODE_ENV === "development" ? ".dev.env" : ".env";

config({ path: resolve(process.cwd(), envFileName) });

const client = new ExtendedClient({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.init();
client.login();
