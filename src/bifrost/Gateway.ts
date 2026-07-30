import { MatrixMembershipEvent } from "../MatrixTypes";
import { IBasicProtocolMessage } from "../MessageFormatter";
import { BifrostRemoteUser } from "../store/BifrostRemoteUser";
import { IProfileProvider } from "./Account";

export interface IGateway extends IProfileProvider {
  sendMatrixMessage(
    chatName: string,
    sender: string,
    body: IBasicProtocolMessage,
    room: IGatewayRoom,
  ): void;
  sendMatrixMembership(chatName: string, event: MatrixMembershipEvent, room: IGatewayRoom): void;
  sendStateChange(
    chatName: string,
    sender: string,
    type: "topic" | "name" | "avatar",
    room: IGatewayRoom,
  ): void;
  onRemoteJoin(
    err: string | null,
    joinId: string,
    room: IGatewayRoom | undefined,
    ownMxid: string | undefined,
  ): Promise<void>;
  initialMembershipSync(
    chatName: string,
    room: IGatewayRoom,
    remoteGhosts: BifrostRemoteUser[],
  ): void;
  getMxidForRemote(sender: string): string;
  memberInRoom(chatName: string, matrixId: string): boolean;
  /**
   * The Matrix room was renamed: refresh anything presenting the room's name to the remote
   * network (e.g. cached disco#info identities), so room lists pick the new name up live.
   */
  updateRoomName(roomId: string, name?: string): void;
  /**
   * The Matrix room's history_visibility changed: refresh whether messages arriving from the
   * remote network are worth caching for backfill, so a tightened room doesn't keep building
   * up a cache nobody will ever be allowed to read.
   */
  setRoomHistoryAllowed(chatName: string, allowed: boolean): void;
}

export interface IGatewayRoom {
  name: string;
  topic: string;
  avatar?: string;
  roomId: string;
  allowHistory: boolean;
  membership: {
    sender: string;
    stateKey: string;
    displayname?: string;
    membership: string;
    isRemote: boolean;
  }[];
  // remotes: string[];
}
