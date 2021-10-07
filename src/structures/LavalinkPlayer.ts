import { Player, PlayerOptions, PlayOptions, Track } from "erela.js";
import { container } from "tsyringe";
import { LavalinkManager } from "./LavalinkManager";
import { LavalinkNode } from "./LavalinkNode";
import { OutgoingEvents } from "../types/Events";
import { OutgoingPlayPayload, OutgoingVolumePayload, OutgoingDestroyPayload} from "../types/OutgoingPayloads";
import { State } from "../util/State";
import { OutgoingPausePayload, OutgoingSeekPayload } from "lavalink-erela.js-provider";
import { CONNECTING } from "ws";

export interface LavalinkPlayerOptions extends PlayerOptions {
    node?: string;
}

export class LavalinkPlayer implements Player {
    /** The Node the Player is currently using. */
    public node: LavalinkNode;

    // inherits jsdoc
    public guild: string;

    // inherits jsdoc
    public textChannel?: string;

    // inherits jsdoc
    public voiceChannel?: string;

    // inherits jsdoc
    public position?: number;

    // inherits jsdoc
    public playing?: boolean;

    // inherits jsdoc
    public paused?: boolean;

    // inherits jsdoc
    public selfMuted?: boolean;

    // inherits jsdoc
    public selfDeafened?: boolean;

    // inherits jsdoc
    public volume?: number;

    /** The Player's current state. */
    public state?: State;

    public constructor(options: Partial<LavalinkPlayerOptions>) {
        options = options as LavalinkPlayerOptions;

        this.guild = options.guild;
        this.textChannel = options.textChannel ?? null;
        this.voiceChannel = options.voiceChannel ?? null;

        const node = this.manager.nodes.get(options.node);
        this.node = node || this.manager.leastLoadNodes.first();

        this.setVolume(options.volume ?? 100);
    }

    // inherits jsdoc
	public get manager(): LavalinkManager {
		return container.resolve<LavalinkManager>('LavalinkManager');
	}

    // inherits jsdoc
    public async connect(channel?: string): Promise<void> {
        if (channel) this.voiceChannel = channel;
        if (!this.voiceChannel) throw new RangeError("No voice channel has been set");

        this.state = State.CONNECTING;
    
        await this.manager.sendPacket(this.guild, {
          op: 4,
          d: {
            guild_id: this.guild,
            channel_id: channel ?? this.voiceChannel,
            self_mute: this.selfMuted || false,
            self_deaf: this.selfDeafened || false,
          },
        });
    
        this.state = State.CONNECTED;
    }

    // inherits jsdoc
    public async disconnect(): Promise<void> {
        if (!this.voiceChannel) throw new RangeError("No voice channel has been set");
        this.state = State.DISCONNECTING;
    
        await this.manager.sendPacket(this.guild, {
          op: 4,
          d: {
            guild_id: this.guild,
            channel_id: null,
            self_mute: false,
            self_deaf: false,
          },
        });
    
        this.state = State.DISCONNECTED;
    }

    // inherits jsdoc
    public async destroy(disconnect: boolean = true): Promise<void> {
        this.state = State.DESTROYING;
        
        if (disconnect) this.disconnect();
        
        const options: OutgoingDestroyPayload = {
            op: OutgoingEvents.DESTROY,
            guildId: this.guild
        };
    
        await this.node.send(options);
        
        this.manager.emit("playerDestroy", this);
        this.manager.players.delete(this.guild);
    }

    // inherits jsdoc
    public async setVolume(volume: number): Promise<void> {
        const options: OutgoingVolumePayload = {
            op: OutgoingEvents.VOLUME,
            guildId: this.guild,
            volume
        };
    
        await this.node.send(options);
    }

    // overloads

    // inherits jsdoc
    public async play(track: Track): Promise<void>;

    // inherits jsdoc
    public async play(track: Track, options: PlayOptions): Promise<void>;

    // implementation
    public async play(
        track: Track,
        playOptions: PlayOptions = {}
    ): Promise<void> {  
      const options: OutgoingPlayPayload = {
        op: OutgoingEvents.PLAY,
        guildId: this.guild,
        track: track.encoded,
        ...playOptions,
      };
  
      await this.node.send(options);
    }

    // inherits jsdoc
    public pause(pause: boolean): this {
        if (typeof pause !== "boolean") throw new RangeError('Pause can only be "true" or "false".');

        this.playing = !pause;
        this.paused = pause;

        const options: OutgoingPausePayload = {
            op: OutgoingEvents.PAUSE,
            guildId: this.guild,
            pause
        }

        this.node.send(options);

        return this;
    }
    
    // inherits jsdoc
    public async seek(position: number): Promise<LavalinkPlayer> {
        position = Number(position);

        if (isNaN(position)) {
            throw new RangeError("Position must be a number.");
        }

        const options: OutgoingSeekPayload = {
            op: OutgoingEvents.SEEK,
            guildId: this.guild,
            position
        }

        this.position = position;
        await this.node.send(options);

        return this;
    }
}