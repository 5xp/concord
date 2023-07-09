import {
  Collection,
  Message,
  ThreadAutoArchiveDuration,
  ThreadChannel,
  Webhook,
  ChannelType,
  BaseGuildTextChannel,
  MessageCollector,
  GuildMember,
  WebhookMessageCreateOptions,
  Colors,
  EmbedBuilder,
  DiscordAPIError,
  inlineCode,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageComponentInteraction,
} from "discord.js";
import ExtendedClient from "./ExtendedClient";

export default class RoomManager {
  readonly client: ExtendedClient;
  readonly rooms = new Collection<string, Room>();

  constructor(client: ExtendedClient) {
    this.client = client;
  }

  createRoom(roomType: "1-on-1" | "Party"): Room {
    const room = new Room(this.client, roomType);
    this.rooms.set(room.id, room);
    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  deleteRoom(id: string): void {
    this.rooms.delete(id);
  }
}

class Room {
  readonly client: ExtendedClient;
  readonly id: string;
  readonly maxInstances: number | undefined;
  readonly maxMembersPerInstance: number | undefined;
  readonly memberManager: MemberManager;
  readonly instanceManager: InstanceManager;

  constructor(client: ExtendedClient, roomType: "1-on-1" | "Party") {
    this.client = client;
    this.instanceManager = new InstanceManager(this);
    this.memberManager = new MemberManager(this);

    if (roomType === "1-on-1") {
      this.maxInstances = 2;
      this.maxMembersPerInstance = 1;
    }

    this.id = this.createRoomId();
  }

  async createThread(message: Message, initiator: GuildMember, anonymous: boolean): Promise<boolean> {
    if (message.channel.type !== ChannelType.GuildText) throw new Error("Invalid text channel");

    if (!this.instanceManager.canCreateInstance()) return false;

    const webhook = await getOrCreateWebhook(message.channel);

    const thread = await message.startThread({
      name: `Room ${this.id}`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    });

    thread.members.add(initiator);

    const instance = this.instanceManager.createInstance(thread, webhook);
    this.memberManager.createMember(instance, initiator, anonymous);

    return true;
  }

  async getOrCreateMember(message: Message): Promise<RoomMember | undefined> {
    const instance = this.instanceManager.getInstance(message.channelId);

    if (!instance) throw new Error("Instance not found");
    if (!message.member) throw new Error("Member not found");

    let member = instance.members.find(member => member.member.id === message.author.id);

    if (!member && !this.memberManager.canBeMember(instance)) {
      message
        .reply({
          content: "Your message could not be delivered because this thread is full.",
          allowedMentions: { repliedUser: false },
        })
        .then(response => {
          deleteAfterDelay(response, 5000);
        });
      return;
    }

    return this.memberManager.requestJoin(instance, message);
  }

  sendJoinMessage(roomMember: RoomMember): void {
    const roomMemberCreateEmbed = createMemberJoinEmbed(roomMember);
    const otherInstances = this.instanceManager.getAllInstancesExcept(roomMember.instance);
    this.instanceManager.sendTo(otherInstances, { embeds: [roomMemberCreateEmbed] });
  }

  sendLeaveMessage(roomMember: RoomMember): void {
    const roomMemberDeleteEmbed = createMemberLeaveEmbed(roomMember);
    const otherInstances = this.instanceManager.getAllInstancesExcept(roomMember.instance);
    this.instanceManager.sendTo(otherInstances, { embeds: [roomMemberDeleteEmbed] });
  }

  private isIdTaken(id: string): boolean {
    return !!this.client.rooms.getRoom(id);
  }

  private createRoomId(): string {
    let id: string;

    do {
      id = makeId(4);
    } while (this.isIdTaken(id));

    return id;
  }

  updateAllStartMessages(): void {
    this.instanceManager.instances.forEach(instance => {
      instance.updateStartMessage(this);
    });
  }
}

class InstanceManager {
  readonly room: Room;
  readonly client: ExtendedClient;
  readonly instances = new Array<RoomInstance>();

  constructor(room: Room) {
    this.room = room;
    this.client = room.client;
  }

  canCreateInstance(): boolean {
    if (!this.room.maxInstances) return true;
    return this.instances.length < this.room.maxInstances;
  }

  createInstance(thread: ThreadChannel, webhook: Webhook): RoomInstance {
    const instance = new RoomInstance(thread, webhook);

    instance.collectMessages(message => {
      this.synchronizeMessage(message);
    });

    this.instances.push(instance);

    return instance;
  }

  async synchronizeMessage(message: Message): Promise<void> {
    if (!message.member) return;

    const isMessageEmpty = !message.content && !message.attachments;
    if (isMessageEmpty) return;

    const instance = this.getInstance(message.channelId);
    if (!instance) return;

    const roomMember = await this.room.getOrCreateMember(message);
    if (!roomMember) return;

    const otherInstances = this.getAllInstancesExcept(instance);
    if (!otherInstances) return;

    message.attachments.forEach(attachment => {
      message.content += `\n${attachment.url}`;
    });

    message.content = message.content.slice(0, 2000);

    const referencedMessage = message.reference ? await message.fetchReference() : undefined;

    const messageOptions: WebhookMessageCreateOptions = {
      content: message.content,
      username: roomMember.displayName,
      avatarURL: roomMember.avatar,
      allowedMentions: { parse: ["users"] },
      embeds: referencedMessage?.content ? [createReplyEmbed(referencedMessage)] : undefined,
    };

    this.sendTo(otherInstances, messageOptions);
  }

  sendTo(instances: RoomInstance[], options: WebhookMessageCreateOptions): void {
    instances.forEach(instance => {
      options = {
        ...options,
        threadId: instance.thread.id,
      };

      if (!options.username) {
        options.username = this.client.user?.username;
        options.avatarURL = this.client.user?.displayAvatarURL();
      }

      instance.webhook.send(options).catch((error: DiscordAPIError) => {
        // Error: Unknown Channel. Thread was likely deleted, so we can delete the instance
        if (error.code === 10003) {
          this.deleteInstance(instance);
          return;
        }

        console.error(error);
      });
    });
  }

  deleteInstance(instance: RoomInstance): void {
    instance.collector?.stop();
    instance.members.forEach(member => {
      this.room.memberManager.deleteMember(member);
    });
    this.instances.splice(this.instances.indexOf(instance), 1);
  }

  getAllInstancesExcept(instance: RoomInstance): RoomInstance[] {
    return this.instances.filter(i => i !== instance);
  }

  getInstance(threadId: string): RoomInstance | undefined {
    return this.instances.find(i => i.thread.id === threadId);
  }
}

class RoomInstance {
  readonly thread: ThreadChannel;
  readonly webhook: Webhook;
  readonly members = new Array<RoomMember>();
  collector?: MessageCollector;

  constructor(thread: ThreadChannel, webhook: Webhook) {
    this.thread = thread;
    this.webhook = webhook;
  }

  collectMessages(callback: (message: Message) => void): void {
    const filter = (message: Message) =>
      !message.webhookId && !message.system && message.author !== message.client.user;
    this.collector = this.thread.createMessageCollector({ filter });

    this.collector.on("collect", message => {
      callback(message);
    });
  }

  async updateStartMessage(room: Room): Promise<void> {
    const starterMessage = await this.thread.fetchStarterMessage();

    if (!starterMessage) return;

    const embed = createStarterMessageEmbed(room);
    starterMessage.edit({ content: "", embeds: [embed] });
  }
}

class MemberManager {
  readonly room: Room;
  readonly client: ExtendedClient;
  readonly members = new Array<RoomMember>();
  anonymousCount = 0;

  constructor(room: Room) {
    this.room = room;
    this.client = room.client;
  }

  canBeMember(instance: RoomInstance): boolean {
    if (!this.room.maxMembersPerInstance) return true;
    return instance.members.length < this.room.maxMembersPerInstance;
  }

  createMember(instance: RoomInstance, guildMember: GuildMember, anonymous: boolean): RoomMember | undefined {
    if (!this.canBeMember(instance)) return;
    const member = <RoomMember>{
      member: guildMember,
      instance: instance,
      anonymous: anonymous,
      displayName: anonymous ? `Anonymous ${++this.anonymousCount}` : guildMember.displayName,
      avatar: anonymous ? getAnonymousAvatarURL() : guildMember.user.displayAvatarURL(),
      index: this.members.length,
    };

    this.onMemberCreate(member);
    return member;
  }

  onMemberCreate(member: RoomMember): void {
    this.members.push(member);
    member.instance.members.push(member);
    this.room.sendJoinMessage(member);
    this.room.updateAllStartMessages();
  }

  deleteMember(member: RoomMember): void {
    this.members.splice(this.members.indexOf(member), 1);
    member.instance.members.splice(member.instance.members.indexOf(member), 1);
    this.room.sendLeaveMessage(member);
    this.room.updateAllStartMessages();
  }

  async requestJoin(instance: RoomInstance, message: Message): Promise<RoomMember | undefined> {
    const response = await message.reply({
      content: "Your message could not be delivered because you are not a member of this room. Would you like to join?",
      components: [createJoinActionRow()],
      allowedMentions: { repliedUser: false },
    });

    const filter = (interaction: MessageComponentInteraction) => interaction.user.id === message.author.id;

    const componentInteraction = await response.awaitMessageComponent({ filter, time: 30000 }).catch(() => null);

    deleteAfterDelay(response, 5000);

    if (!componentInteraction) {
      return;
    }

    const anonymous = componentInteraction.customId === "join-anonymous";
    const member = this.createMember(instance, message.member!, anonymous);

    if (!member) {
      componentInteraction.reply({ content: "Something went wrong!", ephemeral: true });
      return;
    }

    componentInteraction.reply({ content: "You have joined the room!", ephemeral: true });
    return member;
  }
}

interface RoomMember {
  member: GuildMember;
  instance: RoomInstance;
  anonymous: boolean;
  displayName: string;
  index: number;
  avatar: string;
}

function getAnonymousAvatarURL(): string {
  return `https://cdn.discordapp.com/embed/avatars/${Math.floor(Math.random() * 6)}.png`;
}

function makeId(length: number): string {
  const characters = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";

  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return result;
}

function createMemberJoinEmbed(roomMember: RoomMember): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.NotQuiteBlack)
    .setFooter({ text: `${roomMember.displayName} joined the room`, iconURL: roomMember.avatar });
}

function createMemberLeaveEmbed(roomMember: RoomMember): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.DarkRed)
    .setFooter({ text: `${roomMember.displayName} left the room`, iconURL: roomMember.avatar });
}

function createStarterMessageEmbed(room: Room): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.DarkGreen)
    .setTitle(`Room ${inlineCode(room.id)}`)
    .setDescription(room.memberManager.members.map(m => `${m.index + 1}. ${m.displayName}`).join("\n"))
    .setFooter({ text: `${room.memberManager.members.length} chatters` });
}

function createReplyEmbed(message: Message): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Gold)
    .setDescription(message.content)
    .setFooter({ text: message.author.username, iconURL: message.author.displayAvatarURL() });
}

function createJoinActionRow(): ActionRowBuilder<ButtonBuilder> {
  const joinButton = new ButtonBuilder().setCustomId("join").setLabel("Join and send").setStyle(ButtonStyle.Primary);

  const joinAnonymousButton = new ButtonBuilder()
    .setCustomId("join-anonymous")
    .setLabel("Join anonymously and send")
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(joinButton, joinAnonymousButton);
}

async function getOrCreateWebhook(channel: BaseGuildTextChannel): Promise<Webhook> {
  const webhooks = await channel.fetchWebhooks();

  if (webhooks.size > 0) return webhooks.first()!;

  if (!channel.client.user) throw new Error("Client user not found");

  return channel.createWebhook({
    name: channel.client.user.username,
    avatar: channel.client.user.displayAvatarURL(),
  });
}

function deleteAfterDelay(message: Message, delay: number): void {
  setTimeout(() => {
    message.delete();
  }, delay);
}
