import { useEffect, useRef, useState } from "react";
import MemoryGame from "./MemoryGame";

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(
      response.ok
        ? "The server returned an unexpected response."
        : "The service is temporarily unavailable. Please try again."
    );
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

const gameCategories = ["All games", "Party", "Puzzle", "Arcade", "Word", "Board"];
const games = [
  { title: "Memory Pass", category: "Party", icon: "🃏", available: true },
  { title: "Memory Match", category: "Puzzle", icon: "🧠" },
  { title: "Tile Twist", category: "Puzzle", icon: "🧩" },
  { title: "Star Dodger", category: "Arcade", icon: "🚀" },
  { title: "Bubble Pop", category: "Arcade", icon: "🫧" },
  { title: "Word Sprint", category: "Word", icon: "🔤" },
  { title: "Letter Loop", category: "Word", icon: "📚" },
  { title: "Checkers", category: "Board", icon: "⚫" },
  { title: "Four in a Row", category: "Board", icon: "🔴" },
];

function GameMenu({ onLaunch }) {
  const [category, setCategory] = useState("All games");
  const visibleGames = category === "All games"
    ? games
    : games.filter((game) => game.category === category);

  return (
    <section className="game-menu" aria-label="Game menu">
      <div className="menu-heading">
        <div>
          <div className="eyebrow">Arcade Club</div>
          <h1>Choose your game</h1>
        </div>
        <span className="game-count">{visibleGames.length} games</span>
      </div>
      <div className="category-filter" aria-label="Filter games by category">
        {gameCategories.map((item) => (
          <button
            aria-pressed={category === item}
            className="category-button"
            key={item}
            onClick={() => setCategory(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>
      <div className="game-grid" aria-live="polite">
        {visibleGames.map((game) => (
          <button
            aria-label={`${game.title}${game.available ? ", play game" : ", coming soon"}`}
            className={`game-tile${game.available ? "" : " game-tile-unavailable"}`}
            disabled={!game.available}
            key={game.title}
            onClick={() => onLaunch(game.title)}
            type="button"
          >
            <span aria-label={`${game.category} game`} className="game-icon" role="img">
              {game.icon}
            </span>
            <h2>{game.title}</h2>
            {!game.available && <span className="coming-soon">Coming soon</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

function Dashboard({ user, onClose }) {
  return (
    <>
      <button
        aria-label="Close player dashboard"
        className="dashboard-backdrop"
        onClick={onClose}
        type="button"
      />
      <aside aria-label="Player dashboard" className="dashboard-sidebar" id="dashboard-sidebar">
        <div className="sidebar-heading">
          <div>
            <div className="eyebrow">Player dashboard</div>
            <h2>{user.username}</h2>
          </div>
          <button aria-label="Close dashboard" className="sidebar-close" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <p className="sidebar-email">{user.email}</p>
        <div className="stats">
          <Stat label="Games played" value={user.stats.gamesPlayed} />
          <Stat label="Wins" value={user.stats.wins} />
          <Stat label="Losses" value={user.stats.losses} />
          <Stat label="High score" value={user.stats.highScore} />
        </div>
      </aside>
    </>
  );
}

function AuthCard({ onAuthenticated }) {
  const googleButtonRef = useRef(null);
  const [mode, setMode] = useState("login");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const signingUp = mode === "signup";

  useEffect(() => {
    let active = true;

    async function initializeGoogle() {
      const { clientId } = await request("/api/auth/google/config");
      if (!active) return;
      if (!clientId) {
        setMessage("Google authentication is not configured yet.");
        return;
      }

      const renderButton = () => {
        if (!active || !window.google?.accounts?.id || !googleButtonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async ({ credential }) => {
            setMessage("");
            setSubmitting(true);
            try {
              const data = await request("/api/auth/google", {
                method: "POST",
                body: JSON.stringify({ credential }),
              });
              onAuthenticated(data.user);
            } catch (error) {
              setMessage(error.message);
            } finally {
              setSubmitting(false);
            }
          },
        });
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          logo_alignment: "left",
          width: Math.min(googleButtonRef.current.clientWidth, 360),
          text: "signin_with",
        });
        setGoogleReady(true);
      };

      if (window.google?.accounts?.id) {
        renderButton();
        return;
      }

      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = renderButton;
      script.onerror = () => {
        if (active) setMessage("Google sign-in could not be loaded. Please try again.");
      };
      document.head.appendChild(script);
    }

    initializeGoogle().catch((error) => {
      if (active) setMessage(error.message);
    });

    return () => {
      active = false;
    };
  }, [onAuthenticated]);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const body = signingUp
      ? {
          username: formData.get("username"),
          email: formData.get("email"),
          password: formData.get("password"),
        }
      : {
          identifier: formData.get("identifier"),
          password: formData.get("password"),
        };

    try {
      const data = await request(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onAuthenticated(data.user);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  function changeMode(nextMode) {
    setMode(nextMode);
    setMessage("");
  }

  return (
    <section className="card">
      <div className="eyebrow">Welcome to the club</div>
      <h2>{signingUp ? "Create your account" : "Sign in"}</h2>
      <p className="muted">
        {signingUp
          ? "Your player profile is just a few details away."
          : "Pick up where you left off."}
      </p>
      <div className="tabs" role="tablist" aria-label="Account action">
        <button
          aria-selected={!signingUp}
          className="tab"
          onClick={() => changeMode("login")}
          role="tab"
          type="button"
        >
          Log in
        </button>
        <button
          aria-selected={signingUp}
          className="tab"
          onClick={() => changeMode("signup")}
          role="tab"
          type="button"
        >
          Create account
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        {signingUp ? (
          <>
            <label className="field">
              <span>Username</span>
              <input
                autoComplete="username"
                maxLength={24}
                minLength={3}
                name="username"
                pattern="[A-Za-z0-9_-]+"
                required
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                autoComplete="email"
                maxLength={254}
                name="email"
                required
                type="email"
              />
            </label>
          </>
        ) : (
          <label className="field">
            <span>Username or email</span>
            <input
              autoComplete="username"
              maxLength={254}
              name="identifier"
              required
            />
          </label>
        )}
        <label className="field">
          <span>Password</span>
          <input
            autoComplete={signingUp ? "new-password" : "current-password"}
            maxLength={72}
            minLength={signingUp ? 8 : 1}
            name="password"
            required
            type="password"
          />
        </label>
        <button className="primary" disabled={submitting} type="submit">
          {submitting ? "Please wait..." : signingUp ? "Create account" : "Log in"}
        </button>
        <p className="message" role="status" aria-live="polite">
          {message}
        </p>
      </form>
      <div className="auth-divider"><span>or continue with</span></div>
      <div className="google-button" ref={googleButtonRef} aria-busy={!googleReady} />
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);

  useEffect(() => {
    let active = true;

    request("/api/auth/status")
      .then((data) => {
        if (active) setUser(data.user);
      })
      .catch((error) => {
        if (active && error.message !== "Authentication required") {
          setStatusError(error.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function logout() {
    setLogoutError("");
    setLoggingOut(true);
    try {
      await request("/api/auth/logout", {
        method: "POST",
        body: "{}",
      });
      setUser(null);
      setDashboardOpen(false);
      setSelectedGame(null);
    } catch (error) {
      setLogoutError(error.message);
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className={`shell${user ? " shell-player" : ""}${selectedGame ? " shell-memory-game" : ""}`}>
      <header>
        <div className="brand">
          <span aria-hidden="true" className="brand-mark">
            ✦
          </span>
          Arcade Club
        </div>
        {user ? (
          <div className="header-account">
            <button
              aria-controls="dashboard-sidebar"
              aria-expanded={dashboardOpen}
              aria-label={`Toggle dashboard for ${user.username}`}
              className="profile-summary dashboard-trigger"
              onClick={() => setDashboardOpen((open) => !open)}
              title="Toggle player dashboard"
              type="button"
            >
              <span aria-hidden="true" className="profile-avatar">
                {user.username.slice(0, 1).toUpperCase()}
              </span>
              <span className="profile-details">
                <strong>{user.username}</strong>
                <span>{user.email}</span>
              </span>
            </button>
            <button
              className="secondary"
              disabled={loggingOut}
              onClick={logout}
              type="button"
            >
              {loggingOut ? "Logging out..." : "Log out"}
            </button>
          </div>
        ) : (
          <span className="eyebrow">Your next high score starts here</span>
        )}
      </header>
      <main className={user ? "main-game" : "main-auth"}>
        {loading ? (
          <p aria-live="polite" className="muted">
            Loading your player profile...
          </p>
        ) : user ? (
          <>
            {selectedGame === "Memory Pass" ? (
              <MemoryGame onBack={() => setSelectedGame(null)} user={user} />
            ) : (
              <GameMenu onLaunch={setSelectedGame} />
            )}
            {dashboardOpen && (
              <Dashboard onClose={() => setDashboardOpen(false)} user={user} />
            )}
          </>
        ) : (
          <section className="layout" aria-label="Account access">
            <div className="intro">
              <div className="eyebrow">A little friendly competition</div>
              <h1>
                Good games.
                <br />
                <span>Great company.</span>
              </h1>
              <p>
                Make your player profile, keep your stats together, and get
                ready to play your favorite casual games with friends.
              </p>
              <div className="pills">
                <span className="pill">🎮 One player profile</span>
                <span className="pill">✨ Your stats, saved</span>
                <span className="pill">🤝 Made for friends</span>
              </div>
            </div>
            <div>
              <AuthCard onAuthenticated={setUser} />
              {statusError && (
                <p className="message" role="alert">
                  {statusError}
                </p>
              )}
            </div>
          </section>
        )}
        {logoutError && (
          <p className="message logout-message" role="alert">
            {logoutError}
          </p>
        )}
      </main>
      <footer>Made for game nights and friendly rivalries.</footer>
    </div>
  );
}
