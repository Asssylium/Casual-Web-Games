import { useEffect, useRef, useState } from "react";
import * as Ably from "ably";
import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  Flag,
  Info,
  Shield,
  Skull,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;

async function postAction(eventName, payload = {}) {
  const response = await fetch("/api/secret-hitler", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventName, payload }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    const error = new Error(result.error || "The game action failed");
    error.status = response.status;
    throw error;
  }
  return result;
}

async function getState() {
  const response = await fetch("/api/secret-hitler", { credentials: "same-origin" });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Could not load the game");
  return result;
}

function ActionButton({ children, disabled = false, onClick, type = "button", tone = "primary" }) {
  return (
    <button className={`sh-action sh-action-${tone}`} disabled={disabled} onClick={onClick} type={type}>
      {children}
    </button>
  );
}

function PanelTitle({ icon: Icon, eyebrow, title, children }) {
  return (
    <div className="sh-panel-title">
      <div className="sh-title-icon"><Icon aria-hidden="true" size={19} /></div>
      <div>
        <span className="sh-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}

function PlayerSeats({ room, userId, onSelect, selectedId, selectableIds = [] }) {
  return (
    <div className="sh-player-list" aria-label="Players">
      {room.players.map((player, index) => {
        const selectable = selectableIds.includes(player.id);
        const content = (
          <>
            <span className="sh-seat-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="sh-seat-name">
              {player.username}{player.id === userId ? " (you)" : ""}
              {player.id === room.presidentId && <small>President</small>}
              {player.id === room.chancellorId && <small>Chancellor</small>}
            </span>
            <span className={`sh-seat-status${player.alive ? "" : " is-out"}`}>
              {!player.alive ? "Out" : player.connected ? "In game" : "Offline"}
            </span>
            {player.id === selectedId && <Check aria-label="Selected" size={17} />}
          </>
        );
        return selectable ? (
          <button
            aria-pressed={selectedId === player.id}
            className={`sh-player${selectedId === player.id ? " is-selected" : ""}`}
            key={player.id}
            onClick={() => onSelect(player.id)}
            type="button"
          >{content}</button>
        ) : (
          <div className={`sh-player${player.alive ? "" : " is-out"}`} key={player.id}>{content}</div>
        );
      })}
    </div>
  );
}

function PolicyTrack({ room }) {
  return (
    <div className="sh-tracks">
      <div className="sh-track sh-track-liberal">
        <div className="sh-track-heading"><span>Liberal</span><strong>{room.liberalPolicies}/5</strong></div>
        <div className="sh-policy-slots">
          {Array.from({ length: 5 }, (_, index) => (
            <span className={index < room.liberalPolicies ? "is-filled" : ""} key={index} />
          ))}
        </div>
      </div>
      <div className="sh-track sh-track-fascist">
        <div className="sh-track-heading"><span>Fascist</span><strong>{room.fascistPolicies}/6</strong></div>
        <div className="sh-policy-slots">
          {Array.from({ length: 6 }, (_, index) => (
            <span className={index < room.fascistPolicies ? "is-filled" : ""} key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}

function VoteResults({ results, players }) {
  if (!results) return null;
  const nameFor = (id) => players.find((player) => player.id === id)?.username || "A player";
  return (
    <div className={`sh-vote-results${results.passed ? " is-passed" : " is-rejected"}`}>
      <strong>{results.passed ? "Government elected" : "Government rejected"}</strong>
      <span>Ja: {results.yesIds.map(nameFor).join(", ") || "None"}</span>
      <span>Nein: {results.noIds.map(nameFor).join(", ") || "None"}</span>
    </div>
  );
}

export default function SecretHitlerGame({ onBack, user }) {
  const clientRef = useRef(null);
  const rulesDialogRef = useRef(null);
  const [room, setRoom] = useState(null);
  const [secret, setSecret] = useState(null);
  const [connected, setConnected] = useState(false);
  const [realtimeAvailable, setRealtimeAvailable] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [targetId, setTargetId] = useState("");
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  function applyState(result) {
    setRoom(result.room || null);
    setSecret(result.private || null);
    setTargetId("");
  }

  async function refresh() {
    applyState(await getState());
  }

  useEffect(() => {
    let active = true;
    getState()
      .then((result) => {
        if (!active) return;
        applyState(result);
        setInitialized(true);
        setConnected(!result.room);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError.message || "Could not load the game");
        setInitialized(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!initialized || !room?.code) return undefined;
    if (room.realtimeAvailable === false) {
      setRealtimeAvailable(false);
      void postAction("game:reconnect").then(applyState).catch((connectionError) => {
        setError(connectionError.message || "Could not reconnect to the room");
      });
      return undefined;
    }
    let active = true;
    const client = new Ably.Realtime({
      authUrl: `/api/secret-hitler/ably-token?room=${encodeURIComponent(room.code)}`,
      authMethod: "GET",
      autoConnect: false,
      closeOnUnload: true,
    });
    clientRef.current = client;
    const publicChannel = client.channels.get(`secret-hitler:${room.code}:state`);
    const privateChannel = client.channels.get(`secret-hitler:${room.code}:player:${user.id}`);
    const onConnection = (change) => {
      if (!active) return;
      const isConnected = change.current === "connected";
      setConnected(isConnected);
      if (isConnected) {
        setRealtimeAvailable(true);
        setError("");
        void postAction("game:reconnect").then(applyState).catch((connectionError) => {
          setError(connectionError.message || "Could not reconnect");
        });
      } else if (change.current === "failed") {
        setRealtimeAvailable(false);
        void postAction("game:reconnect").then(applyState).catch((connectionError) => {
          setError(connectionError.message || "Could not reconnect to the room");
        });
      }
    };
    client.connection.on(onConnection);
    client.connect();
    const subscriptions = [
      publicChannel.subscribe("game:state", (message) => {
        if (active) setRoom(message.data);
      }),
      privateChannel.subscribe("game:private", (message) => {
        if (active) setSecret(message.data);
      }),
      publicChannel.subscribe("game:cancelled", () => {
        if (active) {
          setRoom(null);
          setSecret(null);
          setError("The host cancelled the game.");
        }
      }),
    ];
    void Promise.all(subscriptions).catch((subscriptionError) => {
      if (active) setError(subscriptionError.message || "Could not connect to the room");
    });
    return () => {
      active = false;
      client.connection.off(onConnection);
      client.close();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [initialized, room?.code, room?.realtimeAvailable, user.id]);

  useEffect(() => {
    if (!room?.code) return undefined;
    const heartbeat = window.setInterval(() => {
      void postAction("game:heartbeat").catch(() => {});
    }, 15_000);
    return () => window.clearInterval(heartbeat);
  }, [room?.code]);

  useEffect(() => {
    if (!room?.code || realtimeAvailable) return undefined;
    const poll = () => {
      void getState().then(applyState).catch((pollError) => {
        setError(pollError.message || "Could not sync the room");
      });
    };
    const interval = window.setInterval(poll, 1800);
    return () => window.clearInterval(interval);
  }, [room?.code, realtimeAvailable]);

  useEffect(() => {
    if (!room?.phaseEndsAt || room.phase !== "role-reveal") {
      setSecondsLeft(0);
      return undefined;
    }
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((room.phaseEndsAt - Date.now()) / 1000)));
    update();
    const interval = window.setInterval(update, 250);
    const timeout = window.setTimeout(() => {
      void refresh().catch((refreshError) => setError(refreshError.message));
    }, Math.max(0, room.phaseEndsAt - Date.now()) + 100);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [room?.phase, room?.phaseEndsAt]);

  async function act(eventName, payload = {}) {
    if ((!connected && !room?.code) || busy) {
      setError("Connecting to the game server...");
      return;
    }
    setBusy(true);
    setError("");
    try {
      applyState(await postAction(eventName, payload));
    } catch (actionError) {
      if (actionError.status === 409) {
        try { await refresh(); } catch {}
      }
      setError(actionError.message || "The action could not be completed");
    } finally {
      setBusy(false);
    }
  }

  async function leaveRoom() {
    if (!room) return onBack();
    setBusy(true);
    try { await postAction("game:leave"); } catch {}
    setBusy(false);
    setRoom(null);
    setSecret(null);
    onBack();
  }

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy the room code. Select it and copy instead.");
    }
  }

  function openRules() {
    if (!rulesDialogRef.current?.open) rulesDialogRef.current?.showModal();
  }

  const isHost = room?.hostId === user.id;
  const isPresident = room?.presidentId === user.id;
  const isChancellor = room?.chancellorId === user.id;
  const alive = room?.players.filter((player) => player.alive) || [];
  const playerCount = room?.players.length || 0;
  const selectablePlayers = room?.phase === "election"
    ? room.eligibleChancellorIds
    : room?.phase === "executive"
      ? alive.filter((player) => player.id !== user.id &&
        (room.power !== "investigate" || !room.investigatedPlayerIds.includes(player.id)))
        .map((player) => player.id)
      : [];
  const canLeave = !room || room.phase === "lobby" || room.phase === "finished";

  return (
    <section className="secret-hitler-game" aria-label="Secret Hitler game">
      <div className="sh-topbar">
        <button className="sh-back" onClick={canLeave ? leaveRoom : onBack} type="button">
          <ArrowLeft aria-hidden="true" size={16} /> Games
        </button>
        <button className="sh-rules-button" onClick={openRules} type="button"><Info aria-hidden="true" size={16} /> Rules</button>
        <div className={`sh-connection${connected ? " is-connected" : ""}`}>
          {connected ? <Wifi size={15} /> : realtimeAvailable ? <WifiOff size={15} /> : room ? <WifiOff size={15} /> : <Wifi size={15} />}
          {connected ? "Live table" : room ? "Polling sync" : "Ready"}
        </div>
      </div>
      {error && <p className="sh-error" role="alert">{error}</p>}

      {!room ? (
        <div className="sh-entry">
          <div className="sh-entry-copy">
            <span className="sh-eyebrow">A game of hidden loyalties</span>
            <h1>Trust is a<br />limited resource.</h1>
            <p>Build a government, debate each vote, and work out who is steering the country.</p>
            <div className="sh-entry-note"><Users size={17} /> 5–10 players · private rooms</div>
          </div>
          <div className="sh-entry-actions">
            <div className="sh-entry-action">
              <span className="sh-eyebrow">Start a table</span>
              <h2>Bring your group together</h2>
              <p>Create a room and share its invite code.</p>
              <ActionButton disabled={!connected || busy} onClick={() => act("game:create")}>
                <Users size={16} /> Create room
              </ActionButton>
            </div>
            <form className="sh-entry-action" onSubmit={(event) => {
              event.preventDefault();
              void act("game:join", { code: codeInput });
            }}>
              <span className="sh-eyebrow">Join a table</span>
              <h2>Enter an invite code</h2>
              <label className="sh-field">
                <span>Room code</span>
                <input
                  autoComplete="off"
                  maxLength={5}
                  onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
                  placeholder="ABCDE"
                  value={codeInput}
                />
              </label>
              <ActionButton disabled={!connected || busy || codeInput.length !== 5} type="submit" tone="outline">
                Join room <ArrowLeft aria-hidden="true" className="sh-join-arrow" size={15} />
              </ActionButton>
            </form>
          </div>
        </div>
      ) : (
        <div className="sh-room">
          <div className="sh-room-bar">
            <span className="sh-phase-label">{room.phase === "lobby" ? "Lobby" : `Round ${room.round}`}</span>
            <span className="sh-room-code">ROOM <strong>{room.code}</strong></span>
            <button aria-label={copied ? "Room code copied" : `Copy room code ${room.code}`} className="sh-icon-button" onClick={copyRoomCode} title="Copy invite code" type="button">
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
            {isHost && (
              <button
                aria-label="Cancel game"
                className="sh-icon-button sh-cancel"
                onClick={() => {
                  if (window.confirm("Cancel this game for everyone?")) void act("game:cancel");
                }}
                title="Cancel game"
                type="button"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <PolicyTrack room={room} />
          <div className="sh-table-layout">
            <section className="sh-main-panel">
              {room.phase === "lobby" && (
                <>
                  <PanelTitle eyebrow={`Players · ${playerCount}/${MAX_PLAYERS}`} icon={Users} title="Gather your table">
                    A game needs {MIN_PLAYERS} to {MAX_PLAYERS} players. Invite the group with the room code.
                  </PanelTitle>
                  <PlayerSeats room={room} userId={user.id} />
                  {isHost && <ActionButton disabled={busy || room.players.length >= MAX_PLAYERS} onClick={() => act("game:add-bot")} tone="outline">
                    <Users size={16} /> Add bot
                  </ActionButton>}
                  {isHost && <ActionButton disabled={busy || !connected || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS || room.players.some((player) => !player.connected)} onClick={() => act("game:start")}>
                    Deal roles <ArrowLeft aria-hidden="true" className="sh-join-arrow" size={16} />
                  </ActionButton>}
                </>
              )}

              {room.phase === "role-reveal" && (
                <>
                  <PanelTitle eyebrow="Private information" icon={EyeOff} title="Your role is secret">
                    Remember your team, then keep the screen to yourself. The election begins in {secondsLeft} seconds.
                  </PanelTitle>
                  <div className={`sh-role-card sh-role-${secret?.party || "unknown"}`}>
                    <span>Your secret role</span>
                    <strong>{secret?.role || "Dealing..."}</strong>
                    <small>{secret?.party === "liberal" ? "Liberal team" : secret?.party === "fascist" ? "Fascist team" : ""}</small>
                  </div>
                  {secret?.knownPlayers?.length > 0 && <div className="sh-intel">
                    <strong>Your fellow Fascists</strong>
                    <span>{secret.knownPlayers.map((player) => `${player.username}${player.role === "hitler" ? " · Hitler" : ""}`).join(" · ")}</span>
                  </div>}
                </>
              )}

              {room.phase === "election" && (
                <>
                  <PanelTitle eyebrow="Election" icon={Users} title={isPresident ? "Nominate a Chancellor" : `${room.players.find((player) => player.id === room.presidentId)?.username} is President`}>
                    {isPresident ? "Choose an eligible player to form the government." : "Discuss the nomination before everyone votes."}
                  </PanelTitle>
                  <PlayerSeats room={room} userId={user.id} onSelect={setTargetId} selectedId={targetId} selectableIds={selectablePlayers} />
                  {isPresident && <ActionButton disabled={busy || !targetId} onClick={() => act("game:nominate", { candidateId: targetId })}>
                    Nominate Chancellor <ArrowLeft aria-hidden="true" className="sh-join-arrow" size={16} />
                  </ActionButton>}
                </>
              )}

              {room.phase === "voting" && (
                <>
                  <PanelTitle eyebrow="Government vote" icon={Flag} title="Ja or Nein?">
                    The proposed government is {room.players.find((player) => player.id === room.presidentId)?.username} and {room.players.find((player) => player.id === room.chancellorId)?.username}.
                  </PanelTitle>
                  <div className="sh-vote-count">{room.votesSubmitted}/{alive.length} votes submitted</div>
                  {secret?.hasVoted ? (
                    <div className="sh-waiting-vote"><Check size={18} /> Vote recorded: {secret.ownVote ? "Ja" : "Nein"}. Waiting for the table.</div>
                  ) : (
                    <div className="sh-vote-buttons">
                      <ActionButton disabled={busy} onClick={() => act("game:vote", { ja: true })}>Ja</ActionButton>
                      <ActionButton disabled={busy} onClick={() => act("game:vote", { ja: false })} tone="outline">Nein</ActionButton>
                    </div>
                  )}
                </>
              )}

              {room.phase === "legislative-president" && (
                <>
                  <PanelTitle eyebrow="Legislative session" icon={Eye} title={isPresident ? "Choose one policy to discard" : "President reviewing policies"}>
                    {isPresident ? "Your hand is private. Select one tile to pass the other two." : "The President is choosing in private."}
                  </PanelTitle>
                  {isPresident && <div className="sh-policy-choice">{secret?.policyHand?.map((policy, index) => (
                    <button className={`sh-policy-card sh-policy-${policy}`} key={`${policy}-${index}`} onClick={() => act("game:president-discard", { index })} type="button">
                      <span>Policy</span><strong>{policy}</strong><small>Discard</small>
                    </button>
                  ))}</div>}
                </>
              )}

              {room.phase === "legislative-chancellor" && (
                <>
                  <PanelTitle eyebrow="Legislative session" icon={Eye} title={isChancellor ? "Choose a policy to enact" : "Chancellor reviewing policies"}>
                    {isChancellor ? "Enact one policy. The other will be discarded." : "The Chancellor is choosing in private."}
                  </PanelTitle>
                  {isChancellor && <div className="sh-policy-choice">{secret?.policyHand?.map((policy, index) => (
                    <button className={`sh-policy-card sh-policy-${policy}`} key={`${policy}-${index}`} onClick={() => act("game:chancellor-enact", { index })} type="button">
                      <span>Policy</span><strong>{policy}</strong><small>Enact</small>
                    </button>
                  ))}</div>}
                  {isChancellor && room.fascistPolicies >= 5 && <ActionButton disabled={busy} onClick={() => act("game:veto-request")} tone="outline">Request veto</ActionButton>}
                </>
              )}

              {room.phase === "veto-response" && (
                <>
                  <PanelTitle eyebrow="Veto power" icon={X} title={isPresident ? "Approve this veto?" : "President deciding"}>
                    {isPresident ? "Approving discards both policies and advances the election tracker." : "The Chancellor asked to discard both policies."}
                  </PanelTitle>
                  {isPresident && <div className="sh-vote-buttons">
                    <ActionButton disabled={busy} onClick={() => act("game:veto-response", { agree: true })}>Approve veto</ActionButton>
                    <ActionButton disabled={busy} onClick={() => act("game:veto-response", { agree: false })} tone="outline">Deny veto</ActionButton>
                  </div>}
                </>
              )}

              {room.phase === "executive" && (
                <>
                  <PanelTitle eyebrow="Executive action" icon={room.power === "execute" ? Skull : Shield} title={isPresident ? `Use ${room.power?.replace("-", " ")}` : "President has a power"}>
                    {isPresident ? "Choose a player. This action is required before the next election." : "The President must use the power granted by this policy."}
                  </PanelTitle>
                  {room.power === "policy-peek" && isPresident ? <ActionButton disabled={busy} onClick={() => act("game:policy-peek")}>Peek at policies</ActionButton> : null}
                  {selectablePlayers.length > 0 && <PlayerSeats room={room} userId={user.id} onSelect={setTargetId} selectedId={targetId} selectableIds={selectablePlayers} />}
                  {isPresident && room.power !== "policy-peek" && <ActionButton disabled={busy || !targetId} onClick={() => act(`game:${room.power}`, { targetId })}>
                    {room.power === "execute" ? "Execute player" : room.power === "special-election" ? "Call special election" : "Investigate party"}
                  </ActionButton>}
                </>
              )}

              {room.phase === "finished" && (
                <>
                  <PanelTitle eyebrow="Game over" icon={room.winnerTeam === "liberal" ? Shield : Flag} title={`${room.winnerTeam === "liberal" ? "Liberals" : "Fascists"} win`}>
                    {room.winnerReason?.replaceAll("-", " ")}
                  </PanelTitle>
                  <PlayerSeats room={room} userId={user.id} />
                  <div className="sh-role-reveal-list">
                    {room.players.map((player) => <span key={player.id}><strong>{player.username}</strong>{player.role} · {player.party}</span>)}
                  </div>
                  {isHost && <ActionButton disabled={busy} onClick={() => act("game:start")}>Play again</ActionButton>}
                </>
              )}

              <VoteResults results={room.ballotResults} players={room.players} />
              <p aria-live="polite" className="sh-notice">{room.notice}</p>
            </section>

            <aside className="sh-side-panel">
              <div className="sh-side-heading"><span className="sh-eyebrow">The table</span><strong>{alive.length} active</strong></div>
              <PlayerSeats room={room} userId={user.id} />
              <div className="sh-tracker"><span>Failed governments</span><div>{[0, 1, 2].map((step) => <i className={step < room.electionTracker ? "is-filled" : ""} key={step} />)}</div></div>
              <div className="sh-deck-counts"><span>Draw pile <strong>{room.drawPileCount}</strong></span><span>Discard pile <strong>{room.discardPileCount}</strong></span></div>
              {secret?.privateIntel?.length > 0 && <div className="sh-private-intel">
                <span className="sh-eyebrow">Your private information</span>
                {secret.privateIntel.map((intel, index) => <p key={`${intel.type}-${index}`}>
                  {intel.type === "investigation"
                    ? `${intel.username} is ${intel.party}.`
                    : `Policy peek: ${intel.policies.join(", ")}.`}
                </p>)}
              </div>}
              <div className="sh-win-note"><EyeOff size={15} /> Hidden roles stay private until the game ends.</div>
            </aside>
          </div>
        </div>
      )}
      <footer className="sh-attribution">
        Digital fan adaptation of <a href="https://www.secrethitler.com/" rel="noreferrer" target="_blank">Secret Hitler</a>
        by Mike Boxleiter, Tommy Maranges, and Mac Schubert. Original art and interface; noncommercial.
        Licensed under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" rel="noreferrer" target="_blank">CC BY-NC-SA 4.0</a>.
      </footer>
      <dialog aria-labelledby="secret-hitler-rules-title" className="game-rules-dialog sh-rules-dialog" ref={rulesDialogRef}>
        <div className="game-rules-content">
          <div className="game-rules-heading">
            <div><span className="eyebrow">Secret Hitler guide</span><h2 id="secret-hitler-rules-title">How to play</h2></div>
            <button aria-label="Close rules" className="turn-dialog-close" onClick={() => rulesDialogRef.current?.close()} type="button"><X size={18} /></button>
          </div>
          <section><h3>Teams and victory</h3><p>Liberals win by enacting 5 Liberal policies or executing Hitler. Fascists win by enacting 6 Fascist policies, or electing Hitler Chancellor after 3 Fascist policies.</p></section>
          <section><h3>Election</h3><p>The President nominates an eligible Chancellor, then every living player votes Ja or Nein. A majority is required. The last elected Chancellor and, above five players, the last elected President are term-limited.</p></section>
          <section><h3>Legislative session</h3><p>The President privately discards 1 of 3 policies, then the Chancellor enacts 1 of the remaining 2. Policy hands and role information are private; players may lie about them.</p></section>
          <section><h3>Failed governments</h3><p>After 3 rejected governments, the top policy is enacted automatically. It grants no executive power and clears term limits.</p></section>
          <section><h3>Executive powers and veto</h3><p>Fascist policies may grant investigation, special election, policy peek, or execution. After 5 Fascist policies, the Chancellor may request a veto; both Chancellor and President must agree.</p></section>
        </div>
      </dialog>
    </section>
  );
}
