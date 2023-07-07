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
        .setName("room")
        .setDescription("Creates a 1-on-1 bridge")
        .addSubcommand(subcommand =>
          subcommand
            .setName("text")
            .setDescription("Creates a 1-on-1 text bridge")
            .addBooleanOption(option =>
              option.setName("anonymous").setDescription("Whether to anonymize your info").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("voice")
            .setDescription("Creates a 1-on-1 voice and text bridge")
            .addBooleanOption(option =>
              option.setName("anonymous").setDescription("Whether to anonymize your info").setRequired(false),
            ),
        ),
    )
    .addSubcommandGroup(subcommandGroup =>
      subcommandGroup
        .setName("party")
        .setDescription("Creates an open bridge")
        .addSubcommand(subcommand =>
          subcommand
            .setName("text")
            .setDescription("Creates an open text bridge")
            .addBooleanOption(option =>
              option.setName("anonymous").setDescription("Whether to anonymize your info").setRequired(false),
            ),
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName("voice")
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

    const subcommandGroup = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();

    const roomType = subcommandGroup === "room" ? "1-on-1" : "Party";
    const commandModule = await import(`./${subcommand}`);
    const command: Partial<Command> = commandModule.default;

    command.execute?.(interaction, client, roomType);
  },
};
