import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  Copy,
  Eye,
  Flag,
  Sparkles,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

function directionText(direction) {
  if (direction === "both") return "Left or right";
  return direction === "left" ? "Pass left" : "Pass right";
}

function GameButton({ children, className = "", disabled = false, onClick, type = "button" }) {
  return (
    <button className={`game-action ${className}`} disabled={disabled} onClick={onClick} type={type}>
      {children}
    </button>
  );
}

function findPassTarget(players, fromId, direction) {
  if (!direction || direction === "both") return null;
  const fromIndex = players.findIndex((player) => player.id === fromId);
  if (fromIndex < 0) return null;
  const step = direction === "left" ? -1 : 1;

  for (let offset = 1; offset < players.length; offset += 1) {
    const index = (fromIndex + step * offset + players.length * 2) % players.length;
    const candidate = players[index];
    if (!candidate.eliminated && candidate.connected) return candidate.id;
  }
  return null;
}

function PlayerList({ players, currentTurnId, userId }) {
  return (
    <div className="room-player-list" aria-label="Players in this room">
      {players.map((player, index) => (
        <div
          className={`room-player${player.id === currentTurnId ? " room-player-turn" : ""}${
            player.eliminated ? " room-player-out" : ""
          }`}
          key={player.id}
        >
          <span className="seat-number">{index + 1}</span>
          <span className="seat-name">
            {player.username}{player.id === userId ? " (you)" : ""}
          </span>
          <span className="seat-cards">
            {player.eliminated ? "Out" : `${player.cardCount} cards`}
          </span>
          {player.id === currentTurnId && <span className="turn-indicator">Turn</span>}
          {!player.connected && !player.eliminated && <span className="seat-offline">Offline</span>}
        </div>
      ))}
    </div>
  );
}

function PlayerOrbit({ room, userId, revealCards = null, selectedDirection = "" }) {
  const players = room.players;
  const count = players.length;
  const fromId = room.pending?.fromId || (room.currentTurnId === userId ? userId : null);
  const direction = room.pending?.direction || selectedDirection;
  const targetId = room.pending?.toId || findPassTarget(players, fromId, direction);

  return (
    <div className={`player-orbit${count === 2 ? " player-orbit-two" : ""}`} aria-label="Players seated around the table">
      <div className="orbit-ring" aria-hidden="true" />
      <div className="orbit-center">
        <span className="orbit-center-mark" aria-hidden="true">✦</span>
        <strong>{room.phase === "reveal" ? "Memorize" : "The table"}</strong>
        <span>{count} players</span>
      </div>
      {players.map((player, index) => {
        const angle = (2 * Math.PI * index) / count;
        const horizontal = count === 2
          ? index === 0 ? 23 : 77
          : 50 + Math.sin(angle) * 39;
        const vertical = count === 2 ? 50 : 49 - Math.cos(angle) * 37;
        const revealedCard = revealCards?.find((card) => card.playerId === player.id);
        const isTarget = player.id === targetId;
        const isSource = player.id === fromId && Boolean(direction);
        const isTurn = player.id === room.currentTurnId;
        const DirectionIcon = revealedCard?.direction === "both"
          ? ArrowLeftRight
          : revealedCard?.direction === "left"
            ? ArrowLeft
            : revealedCard?.direction === "right"
              ? ArrowRight
              : direction === "left"
                ? ArrowLeft
                : direction === "right"
                  ? ArrowRight
                  : null;

        return (
          <div
            className={`orbit-seat${isTarget ? " orbit-seat-target" : ""}${isSource ? " orbit-seat-source" : ""}${isTurn ? " orbit-seat-turn" : ""}${player.eliminated ? " orbit-seat-out" : ""}`}
            key={player.id}
            style={{ left: `${horizontal}%`, top: `${vertical}%` }}
          >
            <div className="orbit-avatar" aria-hidden="true">
              {player.username.slice(0, 1).toUpperCase()}
              {isTurn && <span className="orbit-turn-dot" />}
            </div>
            <strong className="orbit-name">
              {player.username}{player.id === userId ? " (you)" : ""}
            </strong>
            {revealedCard ? (
              <div className="orbit-card-face">
                <span className="orbit-card-icon" aria-hidden="true">{revealedCard.icon}</span>
                <strong>{revealedCard.name}</strong>
                <span className="orbit-direction">
                  {DirectionIcon && <DirectionIcon aria-hidden="true" size={14} />}
                  {directionText(revealedCard.direction)}
                </span>
              </div>
            ) : (
              <span className="orbit-card-count">
                {player.eliminated ? "Out" : `${player.cardCount} ${player.cardCount === 1 ? "card" : "cards"}`}
              </span>
            )}
            {isTarget && (
              <span className="orbit-target-label">
                {room.pending ? "Receiving" : `Pass ${direction}`}
              </span>
            )}
          </div>
        );
      })}
      {targetId && direction && (
        <div className="orbit-pass-direction" aria-live="polite">
          {direction === "left" ? <ArrowLeft size={15} /> : <ArrowRight size={15} />}
          <span>To {players.find((player) => player.id === targetId)?.username}</span>
        </div>
      )}
    </div>
  );
}

function ObjectCard({ card, selected, onClick, locked = false }) {
  const content = (
    <>
      <span className="object-icon" aria-hidden="true">{card.icon}</span>
      <strong>{card.name}</strong>
      <span className="object-direction">{directionText(card.direction)}</span>
      {locked && <span className="locked-card-label">Just received</span>}
    </>
  );

  return (
    <button
      aria-label={`${card.name}, ${locked ? "just received, cannot pass this turn" : directionText(card.direction)}`}
      aria-pressed={!locked && selected}
      className={`object-card${selected ? " object-card-selected" : ""}${locked ? " object-card-locked" : ""}`}
      disabled={locked}
      onClick={onClick}
      type="button"
    >
      {content}
    </button>
  );
}

export default function MemoryGame({ onBack, user }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState(null);
  const [hand, setHand] = useState([]);
  const [blockedCardId, setBlockedCardId] = useState(null);
  const [objects, setObjects] = useState([]);
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [selectedCardId, setSelectedCardId] = useState("");
  const [passDirection, setPassDirection] = useState("");
  const [claimedName, setClaimedName] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const client = io(import.meta.env.VITE_SOCKET_URL || undefined, {
      path: import.meta.env.VITE_SOCKET_PATH
        || (import.meta.env.PROD ? "/api/socket-io/socket.io" : "/socket.io"),
      transports: ["websocket"],
      autoConnect: false,
      withCredentials: true,
    });
    setSocket(client);

    client.on("connect", () => {
      setConnected(true);
      setError("");
      client.emit("game:reconnect", {}, () => {});
    });
    client.on("disconnect", () => setConnected(false));
    client.on("connect_error", (connectError) => {
      setConnected(false);
      setError(connectError.message === "Authentication required"
        ? "Sign in again to join a room."
        : "The game server is unavailable. Please try again.");
    });
    client.on("game:state", setRoom);
    client.on("game:hand", ({ cards, blockedCardId: receivedCardId }) => {
      setHand(cards || []);
      setBlockedCardId(receivedCardId || null);
      setSelectedCardId("");
      setPassDirection("");
    });
    client.on("game:catalog", ({ objects: catalog }) => setObjects(catalog || []));
    client.on("game:error", ({ error: gameError }) => setError(gameError || "Game action failed"));
    client.connect();

    return () => client.disconnect();
  }, []);

  useEffect(() => {
    if (room?.phase !== "reveal" || !room.revealEndsAt) {
      setSecondsLeft(0);
      return undefined;
    }

    const updateCountdown = () => {
      setSecondsLeft(Math.max(0, Math.ceil((room.revealEndsAt - Date.now()) / 1000)));
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(timer);
  }, [room?.phase, room?.revealEndsAt]);

  function emitAction(eventName, payload = {}, onSuccess) {
    if (!socket || !connected) {
      setError("Connecting to the game server...");
      return;
    }
    setError("");
    setBusy(true);
    socket.emit(eventName, payload, (result) => {
      setBusy(false);
      if (!result?.ok) {
        setError(result?.error || "Game action failed");
        return;
      }
      onSuccess?.(result);
    });
  }

  function leaveRoom() {
    if (!room) return onBack();
    emitAction("game:leave", {}, () => {
      setRoom(null);
      setHand([]);
      setBlockedCardId(null);
      onBack();
    });
  }

  function selectCard(card) {
    setSelectedCardId(card.id);
    setPassDirection(card.direction === "both" ? "" : card.direction);
  }

  function passSelectedCard() {
    emitAction("game:pass", {
      cardId: selectedCardId,
      direction: passDirection,
      claimedName,
    });
  }

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy the room code. Select and copy it instead.");
    }
  }

  const currentUser = room?.players.find((player) => player.id === user.id);
  const isHost = room?.hostId === user.id;
  const isMyTurn = room?.currentTurnId === user.id;
  const isReceiver = room?.pending?.toId === user.id;
  const selectedCard = hand.find((card) => card.id === selectedCardId);
  const canLeaveRoom = !room || room.phase === "lobby" || room.phase === "finished";

  return (
    <section className="memory-game" aria-label="Memory Pass game">
      <div className="memory-heading">
        {canLeaveRoom ? (
          <button className="back-button" onClick={leaveRoom} type="button">
            <ArrowLeft aria-hidden="true" size={16} /> Games
          </button>
        ) : <span />}
        <div className={`connection-state${connected ? " is-connected" : ""}`}>
          {connected ? <Wifi aria-hidden="true" size={15} /> : <WifiOff aria-hidden="true" size={15} />}
          {connected ? "Connected" : "Connecting"}
        </div>
      </div>

      {error && <p className="game-error" role="alert">{error}</p>}

      {!room ? (
        <div className="room-entry">
          <div className="room-entry-block">
            <div className="room-entry-art" aria-hidden="true">
              <span className="floating-card card-one">🐈</span>
              <span className="floating-card card-two">📻</span>
              <span className="floating-card card-three">🪑</span>
              <Sparkles className="art-sparkle" size={22} />
            </div>
            <span className="eyebrow">A table for your group</span>
            <h2>Pass the object.<br />Catch the bluff.</h2>
            <p>Memorize each player's card, then decide whether the next claim is real.</p>
            <GameButton disabled={!connected || busy} onClick={() => emitAction("game:create")}>
              <Users size={16} /> Create a room
            </GameButton>
          </div>
          <div className="room-entry-block">
            <span className="eyebrow">Already have a table?</span>
            <h2>Join your friends</h2>
            <p>Enter the five-character room code shared by the host.</p>
            <form
              className="join-room-form"
              onSubmit={(event) => {
                event.preventDefault();
                emitAction("game:join", { code: roomCodeInput });
              }}
            >
              <label className="field">
                <span>Room code</span>
                <input
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={5}
                  onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
                  placeholder="ABCDE"
                  value={roomCodeInput}
                />
              </label>
              <GameButton disabled={!connected || busy || roomCodeInput.length !== 5} type="submit">
                Join room <ArrowRight size={16} />
              </GameButton>
            </form>
            <div className="quick-rules">
              <span><Eye size={15} /> Memorize the reveal</span>
              <span><ArrowRight size={15} /> Pass in the shown direction</span>
              <span><Flag size={15} /> Last player standing wins</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="game-room">
          <div className="room-toolbar">
            <span className="round-label">
              {room.phase === "lobby" ? "Lobby" : `Round ${room.round}`}
            </span>
            <button
              aria-label={copied ? "Room code copied" : `Copy room code ${room.code}`}
              className="copy-room-code"
              onClick={copyRoomCode}
              title={`Copy invite code ${room.code}`}
              type="button"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Invite"}
            </button>
          </div>

          {room.phase === "lobby" && (
            <div className="lobby-layout">
              <section className="lobby-panel">
                <div className="lobby-intro">
                  <span className="eyebrow">Players · {room.players.length}/8</span>
                  <h2>Waiting for your table</h2>
                  <p>Two players are enough to begin. Share the room code to invite your friend.</p>
                </div>
                <PlayerList players={room.players} userId={user.id} />
                {isHost && (
                  <GameButton
                    disabled={busy || room.players.filter((player) => player.connected).length < 2}
                    onClick={() => emitAction("game:start")}
                  >
                    Deal the cards <ArrowRight size={16} />
                  </GameButton>
                )}
                {!isHost && <p className="muted">The host can deal once both players are connected.</p>}
              </section>
              <aside className="lobby-aside">
                <div className="lobby-aside-icon"><Eye size={22} /></div>
                <span className="eyebrow">How this table plays</span>
                <h3>Remember what you see.</h3>
                <p>Cards stay hidden after the reveal. Pass one to the indicated neighbor and name it. They decide to accept or call your bluff.</p>
                <div className="lobby-aside-note"><Sparkles size={15} /> A caught lie sends the giver out.</div>
              </aside>
            </div>
          )}

          {room.phase !== "lobby" && (
            <>
              {room.phase === "reveal" && (
                <section className="memory-reveal">
                  <div className="reveal-heading">
                    <div>
                      <span className="eyebrow">Memorize the table</span>
                      <h2>Remember every card</h2>
                    </div>
                    <strong className="reveal-countdown">{secondsLeft}s</strong>
                  </div>
                  <PlayerOrbit
                    players={room.players}
                    revealCards={room.revealCards}
                    room={room}
                    userId={user.id}
                  />
                </section>
              )}

              {room.phase === "playing" && (
                <div className="playing-layout">
                  <section className="turn-panel">
                    <div className="turn-panel-heading">
                      <div>
                        <span className="eyebrow">{isMyTurn ? "Your turn" : "Table"}</span>
                        <h2>{isMyTurn ? "Choose a card to pass" : "Watch the pass"}</h2>
                      </div>
                      <span className="hand-count">
                        {hand.length} cards
                        {blockedCardId && ` · ${hand.length - 1} passable`}
                      </span>
                    </div>

                    {room.pending ? (
                      <div className="pending-claim">
                        <div className="claim-mark" aria-hidden="true">?</div>
                        <p>
                          <strong>{room.pending.fromName}</strong> says the card is <strong>{room.pending.claimedName}</strong>.
                          {isReceiver ? " Is that true?" : ` ${room.pending.toName} is deciding.`}
                        </p>
                        {isReceiver && (
                          <div className="challenge-actions">
                            <GameButton disabled={busy} onClick={() => emitAction("game:accept")}>
                              Accept card
                            </GameButton>
                            <GameButton
                              className="danger-action"
                              disabled={busy}
                              onClick={() => emitAction("game:challenge")}
                            >
                              Call bluff
                            </GameButton>
                          </div>
                        )}
                      </div>
                    ) : isMyTurn ? (
                      <>
                        <div className="hand-cards">
                          {hand.map((card) => (
                            <ObjectCard
                              card={card}
                              key={card.id}
                              locked={card.id === blockedCardId}
                              onClick={() => selectCard(card)}
                              selected={selectedCardId === card.id}
                            />
                          ))}
                        </div>
                        {selectedCard && (
                          <div className="pass-controls">
                            {selectedCard.direction === "both" && (
                              <div className="direction-options" role="group" aria-label="Pass direction">
                                <button
                                  aria-pressed={passDirection === "left"}
                                  className="direction-option"
                                  onClick={() => setPassDirection("left")}
                                  type="button"
                                >
                                  ← Left
                                </button>
                                <button
                                  aria-pressed={passDirection === "right"}
                                  className="direction-option"
                                  onClick={() => setPassDirection("right")}
                                  type="button"
                                >
                                  Right →
                                </button>
                              </div>
                            )}
                            <label className="field claim-field">
                              <span>Name the card you are passing</span>
                              <select onChange={(event) => setClaimedName(event.target.value)} value={claimedName}>
                                <option value="">Choose an object</option>
                                {objects.map((object) => (
                                  <option key={object.name} value={object.name}>{object.name}</option>
                                ))}
                              </select>
                            </label>
                            <GameButton
                              disabled={busy || !claimedName || (selectedCard.direction === "both" && !passDirection)}
                              onClick={passSelectedCard}
                            >
                              Pass {passDirection || selectedCard.direction}
                              <ArrowRight size={16} />
                            </GameButton>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="waiting-turn">
                        <span className="waiting-pulse" aria-hidden="true" />
                        <p>
                          {currentUser?.eliminated
                            ? "You are out. Watch the remaining players."
                            : room.players.find((player) => player.id === room.currentTurnId)?.username
                              ? `Waiting for ${room.players.find((player) => player.id === room.currentTurnId).username} to pass a card.`
                              : "Waiting for a player to reconnect."}
                        </p>
                      </div>
                    )}
                  </section>

                  <aside className="table-panel">
                    <span className="eyebrow">At the table</span>
                    <PlayerOrbit
                      players={room.players}
                      room={room}
                      selectedDirection={passDirection}
                      userId={user.id}
                    />
                  </aside>
                </div>
              )}

              {room.lastReveal && (
                <section className={`challenge-result challenge-${room.lastReveal.outcome}`} aria-live="polite">
                  <span className="result-icon" aria-hidden="true">{room.lastReveal.card.icon}</span>
                  <div>
                    <strong>
                      {room.lastReveal.fromName} passed {room.lastReveal.card.name}, saying “{room.lastReveal.claimedName}”.
                    </strong>
                    <p>
                      {room.lastReveal.outcome === "lie"
                        ? `${room.lastReveal.toName} caught the lie. The giver is out.`
                        : `${room.lastReveal.toName} called it wrong. The receiver is out.`}
                      {` The card points ${room.lastReveal.card.direction === "both" ? "both ways" : room.lastReveal.card.direction}.`}
                    </p>
                  </div>
                </section>
              )}

              {room.phase === "finished" && (
                <section className="winner-panel">
                  <span className="eyebrow">Game over</span>
                  <h2>{room.players.find((player) => player.id === room.winnerId)?.username || "No winner"} wins</h2>
                  {isHost && (
                    <GameButton disabled={busy} onClick={() => emitAction("game:start")}>
                      Play another round
                    </GameButton>
                  )}
                  {!isHost && <p className="muted">The host can start another round.</p>}
                </section>
              )}
            </>
          )}

          {room.notice && room.phase === "lobby" && (
            <p className="room-lobby-notice" aria-live="polite">{room.notice}</p>
          )}
        </div>
      )}
    </section>
  );
}