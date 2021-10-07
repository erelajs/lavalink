/* eslint-disable @typescript-eslint/no-var-requires */

import { container } from 'tsyringe';
import EventEmitter from 'events';

import { Manager, ManagerOptions, PlayerOptions, Plugin } from 'erela.js';
import Collection from '@discordjs/collection';
import { LavalinkPlayer } from './LavalinkPlayer';
import { LavalinkNode, NodeOptions } from './LavalinkNode';
import { OutgoingVoiceUpdatePayload } from '../types/OutgoingPayloads';
import { OutgoingEvents } from '../types/Events';
import { GatewayVoiceServerUpdateDispatch, GatewayVoiceStateUpdateDispatch } from 'discord-api-types/v8';

export interface LavalinkManagerOptions extends ManagerOptions {
    userId?: string;
    shards?: number;
    nodes: NodeOptions[];
    send: (id: string, payload: NodeJS.Dict<unknown>) => Promise<void>;
}

export class LavalinkManager extends EventEmitter implements Manager {
    /**
     * The Manager version.
     */
    public version: string = require("../../package.json").version;

    /**
     * The user id of the bot this Manager is managing
     */
    public userId!: string;

    /**
     * The amount of shards the bot has, by default it's 1
     */
    public shardCount = 1;

    /**
     * The Nodes associated to this Manager.
     */
    public nodes = new Collection<string, LavalinkNode>()

    /**
     * The Players associated to this Manager.
     */
    public players = new Collection<string, LavalinkPlayer>()
    
    // inherits jsdoc
    public plugins = new Collection<string, Plugin>()

    /**
     * Send voice state packets to Discord for joining/leaving voice channels.
     */
    public sendPacket: LavalinkManagerOptions['send'];
    
    /**
     * The Player voice states.
     */
    #voiceStates = new Collection<string, OutgoingVoiceUpdatePayload>()

    public constructor(options: LavalinkManagerOptions) {
        super();

        this.sendPacket = options.send;
        if (options.shards) this.shardCount = options.shards;
        if (options.userId) this.userId = options.userId;

        if (options.plugins) {
            for (let plugin of options.plugins) {
                plugin.load(this);
            }
        }

        if (options.nodes) {
            for (const nodeOptions of options.nodes) {
                const node = new LavalinkNode(nodeOptions);
                this.nodes.set(node.id, node);
            }
        }

        container
            .registerInstance(LavalinkManager, this)
            .registerInstance('LavalinkManager', this)
    }

    // /** Returns the least used Nodes. */
    // public get leastUsedNodes(): Collection<string, LavalinkNode> {
    //     return this.nodes
    //         .filter((node) => node.connected)
    //         .sort((a, b) => b.calls - a.calls);
    // }

    /** Returns the least system load Nodes. */
    public get leastLoadNodes(): Collection<string, LavalinkNode> {
        return this.nodes
            .filter((node) => node.connected)
            .sort((a, b) => {
                const aload = a.stats.cpu
                    ? (a.stats.cpu.systemLoad / a.stats.cpu.cores) * 100
                    : 0;
                const bload = b.stats.cpu
                    ? (b.stats.cpu.systemLoad / b.stats.cpu.cores) * 100
                    : 0;
                return aload - bload;
            });
    }
    
    /**
     * Initializes the Lavalink Manager and connects to the provided Lavalink nodes.
     */
    public async init(userId?: string): Promise<void> {
        if (userId) this.userId = userId;
        
        await Promise.all(this.nodes.map(node => node.connect()))
    }

    // inherits jsdoc
    public use(...plugins: Plugin[]): void {
        for (let plugin of plugins) {
            plugin.load(this);
        }
    }

    // inherits jsdoc
    public create(guild: string): LavalinkPlayer;
    public create(options: PlayerOptions): LavalinkPlayer;
    public create(guildOrOptions: string | PlayerOptions): LavalinkPlayer {
        const guild = typeof guildOrOptions === "string" ? guildOrOptions : guildOrOptions.guild;
        if (this.players.has(guild)) return this.players.get(guild);

        const options = typeof guildOrOptions === "string" ? { guild: guildOrOptions } : guildOrOptions;
        return new LavalinkPlayer(options)
    }

    // inherits jsdoc
    public get(guild: string): LavalinkPlayer | null {
        return this.players.get(guild);   
    }

    // inherits jsdoc
    public async destroy(guild: string, disconnect: boolean = true): Promise<boolean> {
        const player = this.get(guild);
        if (!player) return false;

        await player.destroy(disconnect);
        return true;
    }

    /**
     * Sends voice data to the Lavalink server.
     * @param data
     */
    public async updateVoiceState(
        data: GatewayVoiceStateUpdateDispatch | GatewayVoiceServerUpdateDispatch
    ): Promise<void> {
        if (!data || !["VOICE_SERVER_UPDATE", "VOICE_STATE_UPDATE"].includes(data.t || "")) return;
        const player = this.players.get(data.d.guild_id);

        if (!player) return;
        const state = this.#voiceStates[player.guild] ?? {} as OutgoingVoiceUpdatePayload;

        if (data.t === "VOICE_SERVER_UPDATE") {
            state.guildId = data.d.guild_id;
            state.event = data.d;
        } else {
            if (data.d.user_id !== this.userId) return;
            state.sessionId = data.d.session_id;

            if (player.voiceChannel !== data.d.channel_id) {
                this.emit("playerMove", player, player.voiceChannel, data.d.channel_id);
                player.voiceChannel = data.d.channel_id;
            }
        }

        this.#voiceStates[player.guild] = state;
        if (Object.keys(state).length == 3) {
            await player.node.send({ op: OutgoingEvents.VOICE_UPDATE, ...state });
        }
    }
}