import {
  Message,
  ThreadAutoArchiveDuration,
  ThreadChannel,
  Webhook,
  ChannelType,
  BaseGuildTextChannel,
  MessageCollector,
  GuildMember,
  WebhookMessageCreateOptions,
  userMention,
  quote,
  Colors,
} from "discord.js";
import ExtendedClient from "./ExtendedClient";
import { EmbedBuilder } from "@discordjs/builders";

interface RoomMember {
  member: GuildMember;
  anonymous: boolean;
  displayName: string;
  index: number;
  avatar: string;
}

interface RoomInstance {
  readonly initiator: RoomMember;
  readonly thread: ThreadChannel;
  readonly webhook: Webhook;
  collector?: MessageCollector;
  members: Array<RoomMember>;
}

export default class Room {
  readonly client: ExtendedClient;
  readonly maxInstances: number | undefined;
  readonly maxMembersPerInstance: number | undefined;
  readonly id: string;
  memberCount = 0;
  instances = new Array<RoomInstance>();

  constructor(client: ExtendedClient, roomType: "1-on-1" | "Party") {
    this.client = client;

    if (roomType === "1-on-1") {
      this.maxInstances = 2;
      this.maxMembersPerInstance = 1;
    }

    this.id = this.getNewRoomId();
    this.client.rooms.set(this.id, this);
  }

  static fromId(client: ExtendedClient, id: string): Room | undefined {
    const room = client.rooms.get(id);
    if (room) return room;
  }

  async createThread(message: Message, initiator: GuildMember, anonymous: boolean): Promise<boolean> {
    if (message.channel.type !== ChannelType.GuildText) throw new Error("Invalid text channel");

    if (this.maxInstances && this.instances.length >= this.maxInstances) return false;

    const webhook = await this.getOrCreateWebhook(message.channel);

    const thread = await message.startThread({
      name: `Room ${this.id}`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    });

    const member = this.createRoomMember(initiator, anonymous);
    const instance = this.createRoomInstance(member, thread, webhook);

    this.startCollectingMessages(instance);
    return true;
  }

  private startCollectingMessages(instance: RoomInstance): void {
    const filter = (message: Message) => !message.webhookId && !message.system;
    instance.collector = instance.thread.createMessageCollector({ filter });

    instance.collector.on("collect", message => {
      this.synchronizeMessage(message);
    });
  }

  private async synchronizeMessage(message: Message): Promise<void> {
    if (!message.member || !message.content) return;

    const instances = this.instances.filter(instance => instance.thread.id !== message.channelId);

    const roomMember = this.getOrCreateRoomMember(message);

    if (!roomMember) return;

    const avatarURL = roomMember.avatar;
    const repliedTo = message.reference ? await message.fetchReference() : undefined;

    const messageOptions: WebhookMessageCreateOptions = {
      username: roomMember.displayName,
      avatarURL: avatarURL,
      allowedMentions: { parse: ["users"] },
    };

    for (const instance of instances) {
      messageOptions.threadId = instance.thread.id;
      messageOptions.content = message.content;

      if (repliedTo) {
        messageOptions.content = `${this.getReplyPrefix(instance, repliedTo)} ${messageOptions.content}`;
      }

      instance.webhook.send(messageOptions).catch(() => this.deleteInstance(instance));
    }
  }

  private getOrCreateRoomMember(message: Message): RoomMember | undefined {
    const instance = this.instances.find(instance => instance.thread.id === message.channelId);
    if (!instance) throw new Error("Instance not found");

    const roomMember = instance.members.find(member => member.member.id === message.author.id);
    if (roomMember) return roomMember;

    if (!message.member) throw new Error("Member not found");

    const member = this.createInstanceRoomMember(instance, message.member, false);
    return member;
  }

  private createRoomInstance(initiator: RoomMember, thread: ThreadChannel, webhook: Webhook): RoomInstance {
    const instance: RoomInstance = { initiator, thread, webhook, members: [] };
    this.onRoomMemberCreate(instance, initiator);
    this.instances.push(instance);
    return instance;
  }

  private createRoomMember(guildMember: GuildMember, anonymous: boolean): RoomMember {
    return <RoomMember>{
      member: guildMember,
      anonymous: anonymous,
      index: this.memberCount,
      displayName: anonymous ? `Anonymous ${this.memberCount + 1}` : guildMember.displayName,
      avatar: anonymous ? this.getAnonymousAvatarURL() : guildMember.user.displayAvatarURL(),
    };
  }

  private onRoomMemberCreate(instance: RoomInstance, roomMember: RoomMember): void {
    this.memberCount++;
    const roomMemberCreateEmbed = this.createMemberJoinEmbed(roomMember);
    this.sendToAllExcept(instance, { embeds: [roomMemberCreateEmbed] });
    instance.members.push(roomMember);
  }

  private createInstanceRoomMember(
    instance: RoomInstance,
    guildMember: GuildMember,
    anonymous: boolean,
  ): RoomMember | undefined {
    if (this.maxMembersPerInstance && instance.members.length >= this.maxMembersPerInstance) return;
    const member = this.createRoomMember(guildMember, anonymous);
    this.onRoomMemberCreate(instance, member);
    return member;
  }

  private createMemberJoinEmbed(roomMember: RoomMember): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setFooter({ text: `${roomMember.displayName} joined the room`, iconURL: roomMember.avatar });

    return embed;
  }

  private async getOrCreateWebhook(channel: BaseGuildTextChannel): Promise<Webhook> {
    const webhooks = await channel.fetchWebhooks();

    if (webhooks.size > 0) return webhooks.first()!;

    if (!this.client.user) throw new Error("Client user not found");

    return channel.createWebhook({
      name: this.client.user.username,
      avatar: this.client.user.displayAvatarURL(),
    });
  }

  private getAnonymousAvatarURL(): string {
    return `https://cdn.discordapp.com/embed/avatars/${Math.floor(Math.random() * 6)}.png`;
  }

  private makeId(length: number): string {
    const characters = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";

    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    return result;
  }

  private isIdTaken(id: string): boolean {
    return this.client.rooms.has(id);
  }

  private getNewRoomId(): string {
    let id: string;

    do {
      id = this.makeId(4);
    } while (this.isIdTaken(id));

    return id;
  }

  private getReplyPrefix(instance: RoomInstance, repliedTo: Message): string {
    const roomMember = this.findMember(repliedTo.author.username);
    const quotePrefix = repliedTo.content.length > 0 ? quote(repliedTo.content) : "";
    let mention: string;

    if (!roomMember) {
      mention = userMention(repliedTo.author.id);
    } else if (!roomMember.anonymous || instance.members.includes(roomMember)) {
      mention = userMention(roomMember.member.id);
    } else {
      mention = `@${roomMember.displayName}`;
    }

    return `${quotePrefix}\n${mention}`;
  }

  private getAllMembers(): Array<RoomMember> {
    return this.instances.flatMap(instance => instance.members);
  }

  private findMember(name: string): RoomMember | undefined {
    const members = this.getAllMembers();
    return members.find(member => member.displayName.includes(name));
  }

  private sendToAllExcept(instance: RoomInstance, options: WebhookMessageCreateOptions) {
    const instances = this.instances.filter(i => i.thread.id !== instance.thread.id);

    for (const instance of instances) {
      options = {
        ...options,
        threadId: instance.thread.id,
        username: this.client.user?.username,
        avatarURL: this.client.user?.displayAvatarURL(),
      };

      instance.webhook.send(options).catch(() => this.deleteInstance(instance));
    }
  }

  private deleteInstance(instance: RoomInstance): void {
    instance.collector?.stop();
    this.instances.splice(this.instances.indexOf(instance), 1);
  }
}
