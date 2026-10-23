import { useEffect, useRef, useState } from "react";
import * as Ably from "ably";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  Copy,
  Crown,
  Eye,
  Flag,
  Info,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

function directionText(direction) {
  if (direction === "both") return "Pass left or right";
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
            {`${player.cardCount} gift${player.cardCount === 1 ? "" : "s"} · ${player.points ?? Math.max(0, 3 - (player.penaltyCount || 0))} pt`}
          </span>
          {player.id === currentTurnId && <span className="turn-indicator">Turn</span>}
          {player.eliminated && <span className="seat-spectator">Spectating</span>}
          {!player.connected && !player.eliminated && <span className="seat-offline">Offline</span>}
        </div>
      ))}
    </div>
  );
}

function PlayerOrbit({ room, userId, revealCards = null, ownGifts = [], selectedDirection = "" }) {
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
          <span>{count} player{count === 1 ? "" : "s"}</span>
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
                {player.eliminated ? "Out" : `${player.cardCount} gift${player.cardCount === 1 ? "" : "s"} · ${player.points ?? Math.max(0, 3 - (player.penaltyCount || 0))} pt`}
              </span>
            )}
            {!revealedCard && !player.eliminated && player.id === userId && ownGifts.length > 0 && (
              <div aria-label="Your face-up gifts" className="orbit-gift-stack">
                {ownGifts.map((gift, giftIndex) => (
                  <div
                    aria-label={`${gift.name}, ${directionText(gift.direction)}`}
                    className="orbit-gift-face orbit-gift-owner"
                    key={`${gift.id || gift.name}-${giftIndex}`}
                    role="img"
                  >
                    <span aria-hidden="true">{gift.icon}</span>
                    <strong>{gift.name}</strong>
                    <small>{directionText(gift.direction)}</small>
                  </div>
                ))}
              </div>
            )}
            {!revealedCard && !player.eliminated && player.id !== userId && player.giftDirections?.length > 0 && (
              <div aria-label={`${player.username}'s face-down gifts`} className="orbit-gift-stack">
                {player.giftDirections.map((giftDirection, giftIndex) => {
                  const GiftArrow = giftDirection === "both" ? ArrowLeftRight : giftDirection === "left" ? ArrowLeft : ArrowRight;
                  return (
                    <div
                      aria-label={`Face-down gift, arrow ${giftDirection}`}
                      className="orbit-gift-back"
                      key={`${player.id}-gift-back-${giftIndex}`}
                      role="img"
                    >
                      <span className="gift-back-mark" aria-hidden="true">✦</span>
                      <GiftArrow aria-hidden="true" size={16} />
                    </div>
                  );
                })}
              </div>
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

function ObjectCard({ card, label = "", locked = false }) {
  const content = (
    <>
      <span className="object-icon" aria-hidden="true">{card.icon}</span>
      <strong>{card.name}</strong>
      <span className="object-direction">{directionText(card.direction)}</span>
      {label && <span className="locked-card-label">{label}</span>}
    </>
  );

  return (
    <div aria-label={`${card.name}, ${label || directionText(card.direction)}`} className={`object-card${locked ? " object-card-locked" : ""}`} role="group">
      {content}
    </div>
  );
}

export default function MemoryGame({ onBack, user }) {
  const ablyRef = useRef(null);
  const turnDialogRef = useRef(null);
  const giftRevealDialogRef = useRef(null);
  const claimResultDialogRef = useRef(null);
  const rulesDialogRef = useRef(null);
  const audioRefs = useRef({});
  const openingLobbyCodeRef = useRef("");
  const previousSoundCueRef = useRef("");
  const [initialized, setInitialized] = useState(false);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState(null);
  const [hand, setHand] = useState([]);
  const [drawnCard, setDrawnCard] = useState(null);
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [startingPlayerId, setStartingPlayerId] = useState(user.id);
  const [passDirection, setPassDirection] = useState("");
  const [claimedName, setClaimedName] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [soundOn, setSoundOn] = useState(() => window.localStorage.getItem("memory-sound-muted") !== "true");

  function playMemorySound(kind) {
    if (!soundOn) return;
    const audio = audioRefs.current[kind];
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  }
  function applyGameState(result) {
    setRoom(result.room || null);
    setHand(result.hand?.cards || []);
    setDrawnCard(result.hand?.drawnCard || null);
  }

  async function loadGameState() {
    const response = await fetch("/api/memory", { credentials: "include" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not load the game");
    applyGameState(result);
  }

  async function postGameAction(eventName, payload = {}) {
    const response = await fetch("/api/memory", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventName, payload }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      const actionError = new Error(result.error || "Game action failed");
      actionError.status = response.status;
      throw actionError;
    }
    return result;
  }

  useEffect(() => {
    const soundPath = (name) => `${import.meta.env.BASE_URL}sounds/memory/${encodeURIComponent(name)}`;
    audioRefs.current = {
      loss: new Audio(soundPath("Loose sound take 4 second.mp3")),
      win: new Audio(soundPath("Memory Winning sound take 6 second.mp3")),
      opening: new Audio(soundPath("Opening sound for memory.mp3")),
    };
    Object.values(audioRefs.current).forEach((audio) => {
      audio.preload = "auto";
      audio.load();
    });
    return () => {
      Object.values(audioRefs.current).forEach((audio) => {
        audio.pause();
        audio.src = "";
      });
      audioRefs.current = {};
    };
  }, []);

  useEffect(() => {
    if (!soundOn || !initialized || room?.phase !== "lobby" || !room.code || openingLobbyCodeRef.current === room.code) return;
    openingLobbyCodeRef.current = room.code;
    playMemorySound("opening");
  }, [initialized, room?.code, room?.phase, soundOn]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/memory", { credentials: "include" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Could not load the game");
        if (!cancelled) {
          applyGameState(result);
          setInitialized(true);
          setConnected(!result.room);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError.message || "Could not load the game");
          setInitialized(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!initialized || !room?.code) {
      if (initialized && !room) setConnected(true);
      return undefined;
    }

    let active = true;
    const client = new Ably.Realtime({
      authUrl: `/api/memory/ably-token?room=${encodeURIComponent(room.code)}`,
      authMethod: "GET",
      autoConnect: false,
      closeOnUnload: true,
    });
    ablyRef.current = client;
    const stateChannel = client.channels.get(`memory:${room.code}:state`);
    const privateHandChannel = client.channels.get(`memory:${room.code}:player:${user.id}`);
    const connectionListener = (change) => {
      if (!active) return;
      const isConnected = change.current === "connected";
      setConnected(isConnected);
      if (isConnected) {
        setError("");
        void postGameAction("game:reconnect").catch((connectionError) => {
          setError(connectionError.message || "Could not reconnect to the room");
        });
      }
      if (change.current === "failed") {
        setError("Realtime connection failed. Refresh and try again.");
      }
    };
    client.connection.on(connectionListener);
    client.connect();

    const subscribeToRoom = stateChannel.subscribe("game:state", (message) => {
      if (active) setRoom(message.data);
    });
    const subscribeToHand = privateHandChannel.subscribe("game:hand", (message) => {
      if (!active) return;
      setHand(message.data.cards || []);
      setDrawnCard(message.data.drawnCard || null);
    });
    const subscribeToCancellation = stateChannel.subscribe("game:cancelled", (message) => {
      if (!active || message.data.cancelledBy === user.id) return;
      setRoom(null);
      setHand([]);
      setDrawnCard(null);
      setError("The host cancelled the game.");
    });
    void Promise.all([subscribeToRoom, subscribeToHand, subscribeToCancellation]).catch((connectionError) => {
      if (active) setError(connectionError.message || "Could not connect to the game");
    });

    return () => {
      active = false;
      client.connection.off(connectionListener);
      client.close();
      if (ablyRef.current === client) ablyRef.current = null;
    };
  }, [initialized, room?.code, user.id]);

  useEffect(() => {
    if (!connected || !room?.code) return undefined;
    const heartbeat = window.setInterval(() => {
      void postGameAction("game:heartbeat").catch((heartbeatError) => {
        setError(heartbeatError.message || "Could not update the game connection");
      });
    }, 15_000);
    return () => window.clearInterval(heartbeat);
  }, [connected, room?.code]);

  useEffect(() => {
    if (!room?.code || ["lobby", "finished"].includes(room.phase)) return undefined;
    const sync = window.setInterval(() => {
      void loadGameState().catch(() => {});
    }, 2_000);
    return () => window.clearInterval(sync);
  }, [room?.code, room?.phase]);


  useEffect(() => {
    if (!room || !["reveal", "gift-reveal"].includes(room.phase) || !room.revealEndsAt) {
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

  useEffect(() => {
    if (
      !room ||
      !["reveal", "gift-reveal"].includes(room.phase) ||
      !room.revealEndsAt ||
      room.currentTurnId !== user.id
    ) return undefined;
    const timer = window.setTimeout(() => {
      void loadGameState().catch((refreshError) => {
        setError(refreshError.message || "Could not refresh the game");
      });
    }, Math.max(0, room.revealEndsAt - Date.now()) + 100);
    return () => window.clearTimeout(timer);
  }, [room?.phase, room?.revealEndsAt, room?.currentTurnId, user.id]);

  function emitAction(eventName, payload = {}, onSuccess) {
    if (!initialized || !connected) {
      setError("Connecting to the game server...");
      return;
    }
    setError("");
    setBusy(true);
    void postGameAction(eventName, payload)
      .then((result) => {
        const outcome = result.room?.lastReveal?.outcome;
        if (["accepted-lie", "truth"].includes(outcome)) playMemorySound("loss");
        if (result.room?.phase === "finished") playMemorySound("win");
        if (result.room) {
          previousSoundCueRef.current = `${result.room.phase}:${result.room.lastReveal?.outcome || ""}:${result.room.lastReveal?.penaltyCount || ""}`;
        }
        applyGameState(result);
        setBusy(false);
        onSuccess?.(result);
      })
      .catch(async (actionError) => {
        setBusy(false);
        if (actionError.status === 409) {
          try {
            await loadGameState();
          } catch {
          }
        }
        setError(actionError.message || "Game action failed");
      });
  }

  async function leaveRoom() {
    if (!room) return onBack();
    setBusy(true);
    try {
      await postGameAction("game:leave");
    } catch {
    } finally {
      setRoom(null);
      setHand([]);
      setDrawnCard(null);
      setBusy(false);
      onBack();
    }
  }

  async function cancelGame() {
    if (!window.confirm("Cancel this game for everyone?")) return;
    setBusy(true);
    setError("");
    try {
      const result = await postGameAction("game:cancel");
      applyGameState(result);
    } catch (cancelError) {
      setError(cancelError.message || "Could not cancel the game");
    } finally {
      setBusy(false);
    }
  }

  function passGift() {
    const card = drawnCard || (hand.length > 1 ? hand[0] : null);
    const direction = card?.direction === "both"
      ? passDirection || "left"
      : card?.direction;
    emitAction("game:pass", { claimedName, direction }, () => {
      setClaimedName("");
      setPassDirection("");
    });
  }

  function startGame() {
    emitAction("game:start", { startingPlayerId });
  }

  function choosePassDirection(direction) {
    setPassDirection(direction);
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
  const isSpectating = Boolean(currentUser?.eliminated);
  const isMyTurn = !isSpectating && room?.currentTurnId === user.id;
  const isReceiver = !isSpectating && room?.pending?.toId === user.id;
  const giftToPassNow = drawnCard || (hand.length > 1 ? hand[0] : null);
  const shouldShowGiftReveal = Boolean(room?.phase === "gift-reveal" && room.revealedGift);
  const selectedPassDirection = giftToPassNow?.direction === "both"
    ? passDirection
    : giftToPassNow?.direction;
  const recipientId = room && selectedPassDirection
    ? findPassTarget(room.players, user.id, selectedPassDirection)
    : null;
  const recipient = room?.players.find((player) => player.id === recipientId);
  const shouldOpenTurnDialog = Boolean(
    room?.phase === "playing" && !room.lastReveal && ((isMyTurn && !room.pending) || isReceiver)
  );
  const canLeaveRoom = !room || room.phase === "lobby" || room.phase === "finished";

  useEffect(() => {
    const dialog = turnDialogRef.current;
    if (!dialog) return;
    if (shouldOpenTurnDialog && !dialog.open) dialog.showModal();
    if (!shouldOpenTurnDialog && dialog.open) dialog.close();
  }, [shouldOpenTurnDialog, room?.currentTurnId, room?.pending?.toId, hand.length, drawnCard?.id]);

  useEffect(() => {
    const dialog = giftRevealDialogRef.current;
    if (!dialog) return;
    if (shouldShowGiftReveal && !dialog.open) dialog.showModal();
    if (!shouldShowGiftReveal && dialog.open) dialog.close();
  }, [shouldShowGiftReveal, room?.revealedGift?.id]);

  const claimResultKey = room?.lastReveal && [
    room.lastReveal.outcome,
    room.lastReveal.fromName,
    room.lastReveal.toName,
    room.lastReveal.claimedName,
    room.lastReveal.card?.name,
    room.lastReveal.penaltyCount,
  ].join(":");

  useEffect(() => {
    const cue = room ? `${room.phase}:${room.lastReveal?.outcome || ""}:${room.lastReveal?.penaltyCount || ""}` : "";
    if (!cue || previousSoundCueRef.current === cue) return;
    const previousCue = previousSoundCueRef.current;
    previousSoundCueRef.current = cue;
    if (!previousCue) return;
    if (room.phase === "finished") playMemorySound("win");
    if (["accepted-lie", "truth"].includes(room.lastReveal?.outcome)) playMemorySound("loss");
  }, [room?.lastReveal?.outcome, room?.lastReveal?.penaltyCount, room?.phase]);

  useEffect(() => {
    const dialog = claimResultDialogRef.current;
    if (!dialog) return;
    if (claimResultKey && !dialog.open) dialog.showModal();
    if (!claimResultKey && dialog.open) dialog.close();
  }, [claimResultKey]);

  function openTurnDialog() {
    if (!turnDialogRef.current?.open) turnDialogRef.current?.showModal();
  }

  function openRules() {
    if (!rulesDialogRef.current?.open) rulesDialogRef.current?.showModal();
  }

  function closeClaimResult() {
    claimResultDialogRef.current?.close();
    if (isMyTurn || isReceiver) openTurnDialog();
  }

  const claimResult = room?.lastReveal;
  const claimResultTitle = !claimResult
    ? ""
    : claimResult.outcome === "accepted-lie"
      ? "Bluff accepted"
      : claimResult.outcome === "truth"
        ? "Correct claim rejected"
        : "Bluff caught";
  const claimResultCopy = !claimResult
    ? ""
    : claimResult.outcome === "accepted-lie"
      ? `${claimResult.toName} accepted “${claimResult.claimedName}”, but the gift was ${claimResult.card?.name}.`
      : claimResult.outcome === "truth"
        ? `${claimResult.toName} called bluff, but ${claimResult.fromName}'s claim was correct.`
        : `${claimResult.toName} called bluff and caught ${claimResult.fromName}'s false claim.`;

  return (
    <section className="memory-game" aria-label="Memory Pass game">
      <div className="memory-heading">
        {canLeaveRoom ? (
          <button className="back-button" onClick={leaveRoom} type="button">
            <ArrowLeft aria-hidden="true" size={16} /> Games
          </button>
        ) : (
          <button
            aria-label="Return to games without leaving the active room"
            className="back-button"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={16} /> Games
          </button>
        )}
        <button className="rules-button" onClick={openRules} type="button">
          <Info aria-hidden="true" size={16} /> Rules
        </button>
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
              <span><Eye size={15} /> Memorize each revealed gift</span>
              <span><ArrowRight size={15} /> Pass the oldest gift by its arrow</span>
              <span><Flag size={15} /> Start with 3 points; reach 0 and lose</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="game-room">
          <div className="room-toolbar">
            <span className="round-label">
              {room.phase === "lobby" ? "Lobby" : `Round ${room.round}`}
            </span>
            {room.phase === "playing" && <span className="table-toolbar-label">The table</span>}
            {room.phase !== "lobby" && (
              <span className="gift-shop-count">Gift shop · {room.giftShopCount}</span>
            )}
            {room.phase === "lobby" && (
              <button
                aria-label={soundOn ? "Mute Memory Pass sounds" : "Enable Memory Pass sounds"}
                className="sound-toggle"
                onClick={() => {
                  setSoundOn((enabled) => {
                    const nextEnabled = !enabled;
                    window.localStorage.setItem("memory-sound-muted", String(!nextEnabled));
                    if (!nextEnabled) {
                      Object.values(audioRefs.current).forEach((audio) => {
                        audio.pause();
                        audio.currentTime = 0;
                      });
                    }
                    return nextEnabled;
                  });
                }}
                title={soundOn ? "Mute sounds" : "Enable sounds"}
                type="button"
              >
                {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
            )}
            {isHost && (
              <button className="cancel-game-button" disabled={busy} onClick={cancelGame} type="button">
                <X aria-hidden="true" size={15} /> Cancel game
              </button>
            )}
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
                  <>
                    <GameButton disabled={busy || room.players.length >= 8} onClick={() => emitAction("game:add-bot")}>
                      <Users size={16} /> Add bot
                    </GameButton>
                    <label className="field starting-player-field">
                      <span>First player</span>
                      <select
                        onChange={(event) => setStartingPlayerId(event.target.value)}
                        value={startingPlayerId}
                      >
                        {room.players.filter((player) => player.connected).map((player) => (
                          <option key={player.id} value={player.id}>{player.username}</option>
                        ))}
                      </select>
                    </label>
                    <GameButton
                      disabled={busy || room.players.filter((player) => player.connected).length < 2}
                      onClick={startGame}
                    >
                      Deal the cards <ArrowRight size={16} />
                    </GameButton>
                  </>
                )}
                {!isHost && <p className="muted">The host can deal once both players are connected.</p>}
              </section>
              <aside className="lobby-aside">
                <div className="lobby-aside-icon"><Eye size={22} /></div>
                <span className="eyebrow">How this table plays</span>
                <h3>Remember what you see.</h3>
                <p>Cards stay hidden after the reveal. Pass one to the indicated neighbor and name it. They decide to accept or call your bluff.</p>
                <div className="lobby-aside-note"><Sparkles size={15} /> Everyone starts with 3 points.</div>
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
                  <section aria-label="Players at the table" className="live-table-panel">
                    <div className="live-table-heading">
                      <div>
                        <span className="eyebrow">Round {room.round}</span>
                        <h2>The table</h2>
                      </div>
                      <span className="gift-shop-count">Gift shop · {room.giftShopCount}</span>
                    </div>
                    <div className="table-panel">
                      <span className="eyebrow">At the table</span>
                      <PlayerOrbit
                        players={room.players}
                        room={room}
                        userId={user.id}
                        ownGifts={[...hand, ...(drawnCard ? [drawnCard] : [])]}
                      />
                    </div>
                    {(isMyTurn || isReceiver) && (
                      <GameButton className="turn-reopen-button" disabled={busy} onClick={openTurnDialog}>
                        {isReceiver ? "Review gift offer" : "Open turn controls"}
                      </GameButton>
                    )}
                  </section>
                </div>
              )}

              {room.phase === "finished" && (
                <section className="winner-panel">
                  <span className="eyebrow">Game over</span>
                  <h2>
                    {(room.winnerIds || []).map((winnerId) =>
                      room.players.find((player) => player.id === winnerId)?.username
                    ).filter(Boolean).join(" and ") || "No winner"}
                    {(room.winnerIds || []).length > 1 ? " tie" : " wins"}
                  </h2>
                  <p className="muted">The last player with points remaining wins.</p>
                  <ResultsTable players={room.players} userId={user.id} winnerIds={room.winnerIds || []} />
                  {isHost && (
                    <GameButton disabled={busy} onClick={startGame}>
                      Start a new game
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

      <dialog
        aria-labelledby="turn-dialog-title"
        className="turn-dialog"
        ref={turnDialogRef}
      >
        <div className="turn-dialog-content">
          <div className="turn-dialog-heading">
            <div>
              <span className="eyebrow">{isReceiver ? "Gift offer" : "Your turn"}</span>
              <h2 id="turn-dialog-title">
                {isReceiver
                  ? "Accept or call bluff"
                  : hand.length === 1 && !drawnCard
                    ? "Draw a gift"
                    : `Send ${drawnCard ? "the new gift" : "your oldest gift"}`}
              </h2>
            </div>
            <button
              aria-label="Close turn controls"
              className="turn-dialog-close"
              onClick={() => turnDialogRef.current?.close()}
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>

          {isReceiver && room.pending ? (
            <>
              <div className="receiver-offer">
                <span className="eyebrow">From {room.pending.fromName}</span>
                <p>They say the gift is:</p>
                <strong>“{room.pending.claimedName}”</strong>
                <span className="offer-direction">
                  {room.pending.direction === "left" ? <ArrowLeft size={15} /> : <ArrowRight size={15} />}
                  Passed {room.pending.direction}
                </span>
              </div>
              <p className="turn-dialog-copy">Accept the claim, or call bluff to reveal the gift. Accepting a false claim gives you a penalty point.</p>
              <div className="receiver-actions">
                <GameButton disabled={busy} onClick={() => emitAction("game:accept")}>
                  <Check size={16} /> Accept gift
                </GameButton>
                <GameButton
                  className="danger-action"
                  disabled={busy}
                  onClick={() => emitAction("game:challenge")}
                >
                  <Flag size={16} /> Call bluff
                </GameButton>
              </div>
            </>
          ) : hand.length === 1 && !drawnCard ? (
            <>
              <ObjectCard card={hand[0]} label="Your current gift" />
              <p className="turn-dialog-copy">Draw the next gift, memorize it and its arrow, then pass it.</p>
              <GameButton disabled={busy} onClick={() => emitAction("game:draw")}>
                <Sparkles size={16} /> Draw from gift shop
              </GameButton>
            </>
          ) : giftToPassNow ? (
            <>
              <div className="turn-send-card">
                <span className="eyebrow">Card to send</span>
                <ObjectCard
                  card={giftToPassNow}
                  label={drawnCard ? "Just drawn" : "Oldest gift"}
                />
                <p>{directionText(giftToPassNow.direction)}</p>
                <p className="recipient-preview" aria-live="polite">
                  {recipient
                    ? `Passing to ${recipient.username}`
                    : giftToPassNow.direction === "both" && !passDirection
                      ? "Choose a direction to see the recipient"
                      : `No connected player ${selectedPassDirection === "left" ? "to the left" : "to the right"}`}
                </p>
              </div>
              {giftToPassNow.direction === "both" && (
                <div className="direction-options" role="group" aria-label="Choose pass direction">
                  <button
                    aria-pressed={passDirection === "left"}
                    className="direction-option"
                    onClick={() => choosePassDirection("left")}
                    type="button"
                  >
                    <ArrowLeft size={16} /> Left
                  </button>
                  <button
                    aria-pressed={passDirection === "right"}
                    className="direction-option"
                    onClick={() => choosePassDirection("right")}
                    type="button"
                  >
                    Right <ArrowRight size={16} />
                  </button>
                </div>
              )}
              <label className="field claim-field">
                <span>What are you claiming the gift is?</span>
                <input
                  autoComplete="off"
                  autoFocus
                  maxLength={40}
                  onChange={(event) => setClaimedName(event.target.value)}
                  placeholder="Type any object name"
                  value={claimedName}
                />
              </label>
              <GameButton
                disabled={busy || !recipient || !claimedName.trim() || (giftToPassNow.direction === "both" && !passDirection)}
                onClick={passGift}
              >
                Send gift {passDirection || giftToPassNow.direction}
                <ArrowRight size={16} />
              </GameButton>
            </>
          ) : null}
        </div>
      </dialog>

      <dialog
        aria-labelledby="gift-reveal-title"
        className="gift-reveal-dialog"
        ref={giftRevealDialogRef}
      >
        {room?.revealedGift && (
          <div className="gift-reveal-content" aria-live="polite">
            <span className="eyebrow">Gift shop reveal</span>
            <h2 id="gift-reveal-title">
              {room.players.find((player) => player.id === room.drawnBy)?.username} drew a gift
            </h2>
            <ObjectCard card={room.revealedGift} label={directionText(room.revealedGift.direction)} />
            <p>Remember the gift and its arrow.</p>
            <strong className="gift-reveal-countdown">Passing begins in {secondsLeft}s</strong>
          </div>
        )}
      </dialog>
      <dialog
        aria-labelledby="claim-result-title"
        className={`claim-result-dialog claim-result-${claimResult?.outcome || "unknown"}`}
        ref={claimResultDialogRef}
      >
        {claimResult && (
          <div className="claim-result-content" aria-live="assertive">
            <span className="result-icon" aria-hidden="true">
              {claimResult.outcome === "lie" ? "✦" : "!"}
            </span>
            <span className="eyebrow">Claim resolved</span>
            <h2 id="claim-result-title">{claimResultTitle}</h2>
            <p>{claimResultCopy}</p>
            <ObjectCard card={claimResult.card} label={`Claimed: ${claimResult.claimedName}`} />
            <strong className="claim-result-penalty">
              {claimResult.penaltyPlayerName} loses a point ({Math.max(0, 3 - claimResult.penaltyCount)}/3 remaining)
            </strong>
            <GameButton onClick={closeClaimResult}>Continue</GameButton>
          </div>
        )}
      </dialog>
      <dialog aria-labelledby="memory-rules-title" className="game-rules-dialog" ref={rulesDialogRef}>
        <div className="game-rules-content">
          <div className="game-rules-heading">
            <div><span className="eyebrow">Memory Pass guide</span><h2 id="memory-rules-title">How to play</h2></div>
            <button aria-label="Close rules" className="turn-dialog-close" onClick={() => rulesDialogRef.current?.close()} type="button"><X size={18} /></button>
          </div>
          <section><h3>Goal</h3><p>Everyone begins with 3 points. Wrong decisions cost a point. At 0 points you become a spectator; the last player still standing wins.</p></section>
          <section><h3>Remember the table</h3><p>At the start, memorize every gift and its arrow. After the reveal, opponents’ gifts are face down, but their arrows remain visible.</p></section>
          <section><h3>Your turn</h3><p>If you hold one gift, draw a new one. Pass the drawn gift, or when holding two gifts pass the oldest one, in its arrow’s direction. A double arrow lets you choose left or right.</p></section>
          <section><h3>Claims and bluffs</h3><p>Name the gift you are passing. The receiver can accept or call bluff. Accepting a lie costs the receiver a point. Calling bluff costs the giver a point if it was a lie, or the receiver a point if it was true.</p></section>
        </div>
      </dialog>
    </section>
  );
}

function ResultsTable({ players, userId, winnerIds = [] }) {
  const winners = new Set(winnerIds);
  const rankings = [...players]
    .sort((left, right) => (right.points ?? Math.max(0, 3 - (right.penaltyCount || 0))) - (left.points ?? Math.max(0, 3 - (left.penaltyCount || 0))) || left.username.localeCompare(right.username));
  let previousScore = null;
  let rank = 0;
  const rows = rankings.map((player, index) => {
    const points = player.points ?? Math.max(0, 3 - (player.penaltyCount || 0));
    if (points !== previousScore) rank = index + 1;
    previousScore = points;
    return { player, points, rank, won: winners.has(player.id) };
  });

  return (
    <div className="final-results" aria-label="Final scores">
      <div className="fireworks" aria-hidden="true"><span>✦</span><span>✺</span><span>✧</span><span>✹</span></div>
      <div className="final-results-heading">
        <span className="winner-throne" aria-hidden="true"><Crown size={25} /><b>♛</b></span>
        <div><span className="eyebrow">Final standings</span><h3>The throne goes to first place</h3></div>
      </div>
      <div className="results-table-wrap">
        <table className="results-table">
          <thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">Points</th><th scope="col">Result</th></tr></thead>
          <tbody>{rows.map(({ player, points, rank, won }) => (
            <tr className={won ? "is-winner" : "is-loser"} key={player.id}>
              <td>{rank === 1 ? <span className="first-place"><Crown aria-label="First place" size={16} /> 1</span> : rank}</td>
              <td>{player.username}{player.id === userId ? " (you)" : ""}</td><td>{points}</td>
              <td><span className={`result-badge ${won ? "result-winner" : "result-loser"}`}>{won ? "Winner" : "Lost"}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
