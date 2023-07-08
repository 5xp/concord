import { ChatInputCommandInteraction, SlashCommandBuilder, ChannelType } from "discord.js";
import Command from "@common/Command";
import ExtendedClient from "@common/ExtendedClient";

export default <Command>{
  data: new SlashCommandBuilder()
    .setName("create")
    .setDescription("Create text or voice bridge")
    .setDMPermission(false)
    .addSubcommandGroup(subcommandGroup =>
      subcommandGroup
        .setName("text")
        .setDescription("Creates a 1-on-1 or open text bridge")
        .addSubcommand(subcommand =>
          subcommand
            .setName("room")
            .setDescription("Creates a 1-on-1 text bridge")
            .addBooleanOption(option =>
              option.setName("anonymous").setDescription("Whether to anonymize your info").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("party")
            .setDescription("Creates an open text bridge")
            .addBooleanOption(option =>
              option.setName("anonymous").setDescription("Whether to anonymize your info").setRequired(false),
            ),
        ),
    )
    .addSubcommandGroup(subcommandGroup =>
      subcommandGroup
        .setName("voice")
        .setDescription("Creates a 1-on-1 or open voice and text bridge")
        .addSubcommand(subcommand =>
          subcommand
            .setName("room")
            .setDescription("Creates a 1-on-1 voice and text bridge")
            .addBooleanOption(option =>
              option.setName("anonymous").setDescription("Whether to anonymize your info").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("party")
            .setDescription("Creates an open voice and text bridge")
            .addBooleanOption(option =>
              option.setName("anonymous").setDescription("Whether to anonymize your info").setRequired(false),
            ),
        ),
    ),
  async execute(interaction: ChatInputCommandInteraction, client: ExtendedClient): Promise<void> {
    if (!interaction.guild || interaction.channel?.type !== ChannelType.GuildText) {
      interaction.reply({ content: "This command can only be used in a server text channel!", ephemeral: true });
      return;
    }

    if (!interaction.inCachedGuild()) {
      await interaction.guild.members.fetch();
    }

    const subcommand = interaction.options.getSubcommand();
    const subcommandGroup = interaction.options.getSubcommandGroup();

    const roomType = subcommand === "room" ? "1-on-1" : "Party";
    const commandModule = await import(`./${subcommandGroup}`);
    const command: Partial<Command> = commandModule.default;

    command.execute?.(interaction, client, roomType);
  },
};
