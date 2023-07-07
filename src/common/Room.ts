import {
  Message,
  ThreadAutoArchiveDuration,
  ThreadChannel,
  Webhook,
  ChannelType,
  BaseGuildTextChannel,
  MessageCollector,
  GuildMember,
} from "discord.js";
import ExtendedClient from "./ExtendedClient";

interface RoomMember {
  member: GuildMember;
  anonymous: boolean;
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
    const filter = (message: Message) => !message.webhookId;
    instance.collector = instance.thread.createMessageCollector({ filter });

    instance.collector.on("collect", message => {
      this.synchronizeMessage(message);
    });
  }

  private async synchronizeMessage(message: Message): Promise<void> {
    if (!message.member) return;

    const instances = this.instances.filter(instance => instance.thread.id !== message.channelId);

    if (instances.length === 0) return;

    const roomMember = this.getOrCreateRoomMember(message);

    if (!roomMember) return;

    const displayName = roomMember.anonymous ? `Anonymous ${roomMember.index + 1}` : message.member.displayName;
    const avatarURL = roomMember.avatar;

    for (const instance of instances) {
      await instance.webhook.send({
        content: message.content,
        username: displayName,
        avatarURL: avatarURL,
        threadId: instance.thread.id,
      });
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
      avatar: anonymous ? this.getAnonymousAvatarURL() : guildMember.user.displayAvatarURL(),
    };
  }

  private onRoomMemberCreate(instance: RoomInstance, roomMember: RoomMember): void {
    this.memberCount++;
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

  private async getOrCreateWebhook(channel: BaseGuildTextChannel): Promise<Webhook> {
    const webhooks = await channel.fetchWebhooks();

    if (webhooks.size > 0) return webhooks.first()!;

    return channel.createWebhook({
      name: this.client.user!.username,
      avatar: this.client.user!.displayAvatarURL(),
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
}
