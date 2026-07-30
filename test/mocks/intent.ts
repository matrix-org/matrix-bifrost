export class MockIntent {
  public ensureRegisteredCalled: boolean = false;
  public leftRoom: string = "";
  public clientJoinRoomCalledWith: { roomString: string; opts: any } | null = null;
  public userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  public async ensureRegistered() {
    this.ensureRegisteredCalled = true;
  }

  public async leave(roomString: string) {
    this.leftRoom = roomString;
  }

  public async roomState(_roomId: string) {
    return [];
  }

  public async join(roomString: string, opts: any) {
    this.clientJoinRoomCalledWith = { roomString, opts };
    roomString = roomString.startsWith("#") ? roomString.replace("#", "!") : roomString;
    return roomString;
  }
}
