import { CommandInteraction } from "discord.js";
import Command from "@common/Command";
import ExtendedClient from "@common/ExtendedClient";

export default <Partial<Command>>{
  async execute(interaction: CommandInteraction, client: ExtendedClient, roomType: "1-on-1" | "Party"): Promise<void> {
    interaction.reply({ content: "Sorry, this command is not implemented yet!", ephemeral: true });
  },
};
