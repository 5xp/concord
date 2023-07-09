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
  Colors,
} from "discord.js";
import ExtendedClient from "./ExtendedClient";
import { EmbedBuilder } from "@discordjs/builders";

export default class Room {
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
    this.client.rooms.set(this.id, this);
  }

  static fromId(client: ExtendedClient, id: string): Room | undefined {
    const room = client.rooms.get(id);
    if (room) return room;
  }

  async createThread(message: Message, initiator: GuildMember, anonymous: boolean): Promise<boolean> {
    if (message.channel.type !== ChannelType.GuildText) throw new Error("Invalid text channel");

    if (this.maxInstances && this.instanceManager.instances.length >= this.maxInstances) return false;

    const webhook = await this.getOrCreateWebhook(message.channel);

    const thread = await message.startThread({
      name: `Room ${this.id}`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    });

    const instance = this.instanceManager.createInstance(thread, webhook);
    this.memberManager.createMember(instance, initiator, anonymous);

    return true;
  }

  getOrCreateMember(message: Message): RoomMember | undefined {
    const instance = this.instanceManager.getInstance(message.channelId);

    if (!instance) throw new Error("Instance not found");
    if (!message.member) throw new Error("Member not found");

    return (
      instance.members.find(member => member.member.id === message.author.id) ??
      this.memberManager.createMember(instance, message.member, false)
    );
  }

  sendJoinMessage(instance: RoomInstance, roomMember: RoomMember): void {
    const roomMemberCreateEmbed = createMemberJoinEmbed(roomMember);
    const instances = this.instanceManager.getAllInstancesExcept(instance);
    this.instanceManager.sendTo(instances, { embeds: [roomMemberCreateEmbed] });
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

  private isIdTaken(id: string): boolean {
    return this.client.rooms.has(id);
  }

  private createRoomId(): string {
    let id: string;

    do {
      id = makeId(4);
    } while (this.isIdTaken(id));

    return id;
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

  createInstance(thread: ThreadChannel, webhook: Webhook): RoomInstance {
    const instance = new RoomInstance(thread, webhook);

    instance.collectMessages(message => {
      this.synchronizeMessage(message);
    });

    this.instances.push(instance);

    return instance;
  }

  async synchronizeMessage(message: Message): Promise<void> {
    if (!message.member || !message.content) return;

    const instance = this.getInstance(message.channelId);
    if (!instance) return;

    const roomMember = this.room.getOrCreateMember(message);
    if (!roomMember) return;

    const otherInstances = this.getAllInstancesExcept(instance);
    if (!otherInstances) return;

    const messageOptions: WebhookMessageCreateOptions = {
      username: roomMember.displayName,
      avatarURL: roomMember.avatar,
      allowedMentions: { parse: ["users"] },
      content: message.content,
    };

    this.sendTo(otherInstances, messageOptions);
  }

  sendTo(instances: RoomInstance[], options: WebhookMessageCreateOptions): void {
    for (const instance of instances) {
      options = {
        ...options,
        threadId: instance.thread.id,
      };

      if (!options.username) {
        options.username = this.client.user?.username;
        options.avatarURL = this.client.user?.displayAvatarURL();
      }

      instance.webhook.send(options).catch(() => this.deleteInstance(instance));
    }
  }

  deleteInstance(instance: RoomInstance): void {
    instance.collector?.stop();
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
    const filter = (message: Message) => !message.webhookId && !message.system;
    this.collector = this.thread.createMessageCollector({ filter });

    this.collector.on("collect", message => {
      callback(message);
    });
  }
}

class MemberManager {
  readonly room: Room;
  readonly client: ExtendedClient;
  readonly members = new Array<RoomMember>();

  constructor(room: Room) {
    this.room = room;
    this.client = room.client;
  }

  createMember(instance: RoomInstance, guildMember: GuildMember, anonymous: boolean): RoomMember | undefined {
    if (this.room.maxMembersPerInstance && instance.members.length >= this.room.maxMembersPerInstance) return;
    const member = <RoomMember>{
      member: guildMember,
      instance: instance,
      anonymous: anonymous,
      displayName: anonymous ? `Anonymous ${this.members.length + 1}` : guildMember.displayName,
      avatar: anonymous ? getAnonymousAvatarURL() : guildMember.user.displayAvatarURL(),
      index: this.members.length,
    };

    this.onMemberCreate(instance, member);
    return member;
  }

  onMemberCreate(instance: RoomInstance, member: RoomMember): void {
    this.members.push(member);
    instance.members.push(member);
    this.room.sendJoinMessage(instance, member);
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
  const embed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setFooter({ text: `${roomMember.displayName} joined the room`, iconURL: roomMember.avatar });

  return embed;
}
