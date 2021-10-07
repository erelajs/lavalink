import { Track } from "erela.js";

export class LavalinkTrack extends Track {
    /** If the track is seekable. */
    public isSeekable: boolean;
    /** If the track is a stream.. */
    public isStream: boolean;
    /** The thumbnail of the track or null if it's a unsupported source. */
    public thumbnail: string | null;
}