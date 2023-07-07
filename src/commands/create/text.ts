import { ChatInputCommandInteraction, Embed, EmbedBuilder, inlineCode } from "discord.js";
import Command from "@common/Command";
import ExtendedClient from "@common/ExtendedClient";
import Room from "@common/Room";

export default <Partial<Command>>{
  async execute(
    interaction: ChatInputCommandInteraction,
    client: ExtendedClient,
    roomType: "1-on-1" | "Party",
  ): Promise<void> {
    const room = new Room(client, roomType);
    const anonymous = interaction.options.getBoolean("anonymous") ?? false;

    const response = await interaction.reply({ content: `Creating room ${inlineCode(room.id)}...`, fetchReply: true });

    if (!interaction.inCachedGuild()) {
      throw new Error("Interaction is not in cached guild");
    }

    const created = await room.createThread(response, interaction.member, anonymous);

    if (!created) return;

    interaction.editReply({ content: `Created room ${inlineCode(room.id)}` });
  },
};