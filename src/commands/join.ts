import { ChatInputCommandInteraction, SlashCommandBuilder, inlineCode } from "discord.js";
import Command from "@common/Command";
import ExtendedClient from "@common/ExtendedClient";
import Room from "@common/Room";

export default <Command>{
  data: new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join a room by id")
    .setDMPermission(false)
    .addStringOption(option => option.setName("id").setDescription("The id of the room to join.").setRequired(true))
    .addBooleanOption(option =>
      option.setName("anonymous").setDescription("Whether to anonymize your info").setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction, client: ExtendedClient): Promise<void> {
    const roomId = interaction.options.getString("id", true).toLowerCase();
    const room = Room.fromId(client, roomId);
    const anonymous = interaction.options.getBoolean("anonymous") ?? false;

    if (!interaction.inCachedGuild()) {
      throw new Error("Interaction is not in cached guild");
    }

    if (!room) {
      interaction.reply({ content: `Room id is invalid: ${inlineCode(roomId)}`, ephemeral: true });
      return;
    }

    const response = await interaction.reply({ content: `Joining room ${inlineCode(room.id)}...`, fetchReply: true });
    const joined = await room.createThread(response, interaction.member, anonymous);

    if (!joined) {
      interaction.editReply({ content: `Room ${inlineCode(room.id)} is full!` });
      return;
    }

    interaction.editReply({ content: `Joined room ${inlineCode(room.id)}` });
  },
};
