/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Altair-Linux Repository Dashboard
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Builds a live-updating Discord dashboard that shows the current state of
 * every repository in the Altair-Linux GitHub organisation.  The dashboard is
 * maintained as a **single Discord message** (created on the first run, then
 * edited on every subsequent run) to prevent channel clutter.
 *
 * Displayed per repository:
 *   • Repo name & default branch
 *   • Latest release (tag + name)
 *   • Last 5 commits (hash + author + message)
 *   • Open pull requests (number + title + author)
 *   • Open issues (number + title + author)
 *
 * Environment variables:
 *   ORG_GITHUB_TOKEN          – GitHub token with org:read scope
 *   DISCORD_WEBHOOK_DASHBOARD – Discord webhook URL for the /repositories channel
 *
 * State persistence:
 *   The message ID of the dashboard is stored in `.dashboard-state.json` at
 *   the repository root.  GitHub Actions cache is used to persist this file
 *   across workflow runs.
 *
 * @module dashboard
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Altair-Linux branding logo. */
const LOGO =
  "https://media.discordapp.net/attachments/1481906393085906975/1482315760188657714/altair-logo-monochrome.png?ex=69b681a1&is=69b53021&hm=8532ede0d3fb2cd07e6feeb36c6e111aef0187b70569156bbc1b7da9a4ca8d5f&=&format=webp&quality=lossless&width=943&height=943";

/** GitHub organisation name. */
const ORG_NAME = "Altair-Linux";

/** Path to the local state file that stores the dashboard message ID. */
const STATE_FILE = path.join(__dirname, "..", ".dashboard-state.json");

/** Embed colours. */
const COLORS = {
  HEADER: 0x2b2d31,
  ACTIVE: 0x2ecc71,
  NORMAL: 0x3498db,
  STALE: 0x95a5a6,
};

/** GitHub API headers. */
const GITHUB_HEADERS = {
  Authorization: `token ${process.env.ORG_GITHUB_TOKEN}`,
  Accept: "application/vnd.github.v3+json",
};

// ─────────────────────────────────────────────────────────────────────────────
// State management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the persisted dashboard state (message ID) from the state file.
 *
 * @returns {{ messageId: string | null }}
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      console.log(`[STATE] Loaded message ID: ${data.messageId || "(none)"}`);
      return data;
    }
  } catch (err) {
    console.warn("[STATE] Could not read state file:", err.message);
  }
  return { messageId: null };
}

/**
 * Persists the dashboard message ID to the state file.
 *
 * @param {string} messageId – Discord message ID
 */
function saveState(messageId) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ messageId }, null, 2));
    console.log(`[STATE] Saved message ID: ${messageId}`);
  } catch (err) {
    console.error("[STATE] Could not write state file:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub API helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches all repositories for the organisation with pagination.
 *
 * @returns {Promise<Array>}
 */
async function getRepos() {
  console.log(`[GITHUB] Fetching repositories for "${ORG_NAME}"...`);
  let repos = [];
  let page = 1;

  while (true) {
    const url = `https://api.github.com/orgs/${ORG_NAME}/repos?per_page=100&page=${page}`;
    const res = await axios.get(url, { headers: GITHUB_HEADERS });
    repos = repos.concat(res.data);
    if (res.data.length < 100) break;
    page++;
  }

  console.log(`[GITHUB] Found ${repos.length} repositories.`);
  return repos;
}

/**
 * Fetches the latest release for a repository.
 *
 * @param {string} fullName – "org/repo"
 * @returns {Promise<object|null>}
 */
async function getLatestRelease(fullName) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${fullName}/releases/latest`,
      { headers: GITHUB_HEADERS }
    );
    return res.data;
  } catch {
    return null;
  }
}

/**
 * Fetches the last N commits on the default branch.
 *
 * @param {string} fullName      – "org/repo"
 * @param {string} defaultBranch – branch name
 * @param {number} count         – number of commits
 * @returns {Promise<Array>}
 */
async function getRecentCommits(fullName, defaultBranch, count = 5) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${fullName}/commits?sha=${defaultBranch}&per_page=${count}`,
      { headers: GITHUB_HEADERS }
    );
    return res.data;
  } catch {
    return [];
  }
}

/**
 * Fetches open pull requests for a repository.
 *
 * @param {string} fullName – "org/repo"
 * @returns {Promise<Array>}
 */
async function getOpenPRs(fullName) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${fullName}/pulls?state=open&per_page=100`,
      { headers: GITHUB_HEADERS }
    );
    return res.data;
  } catch {
    return [];
  }
}

/**
 * Fetches open issues (excluding pull requests) for a repository.
 *
 * @param {string} fullName – "org/repo"
 * @returns {Promise<Array>}
 */
async function getOpenIssues(fullName) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${fullName}/issues?state=open&per_page=100`,
      { headers: GITHUB_HEADERS }
    );
    return res.data.filter((i) => !i.pull_request);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Embed builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Truncates a string to maxLen, appending "…" if truncated.
 *
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function trunc(str, maxLen) {
  if (!str) return "";
  return str.length > maxLen ? str.substring(0, maxLen - 1) + "…" : str;
}

/**
 * Determines the embed colour based on how recently the repository was pushed.
 *
 * @param {string} pushedAt – ISO 8601 timestamp
 * @returns {number} Colour integer
 */
function activityColor(pushedAt) {
  if (!pushedAt) return COLORS.STALE;
  const hoursSincePush = (Date.now() - new Date(pushedAt).getTime()) / 3.6e6;
  if (hoursSincePush < 24) return COLORS.ACTIVE;
  if (hoursSincePush < 168) return COLORS.NORMAL;
  return COLORS.STALE;
}

/**
 * Builds the header embed shown at the top of the dashboard message.
 *
 * @param {number} repoCount – Total number of repos
 * @returns {object} Discord embed
 */
function buildHeaderEmbed(repoCount) {
  return {
    title: "📊 Altair-Linux Repository Dashboard",
    description:
      `Monitoring **${repoCount}** repositories in the ` +
      `[Altair-Linux](https://github.com/Altair-Linux) organisation.\n` +
      `_Last updated: <t:${Math.floor(Date.now() / 1000)}:R>_`,
    color: COLORS.HEADER,
    thumbnail: { url: LOGO },
    footer: {
      text: "Altair Linux • Dashboard",
      icon_url: LOGO,
    },
  };
}

/**
 * Builds a compact embed for a single repository.
 *
 * @param {object}  repo    – GitHub repo object
 * @param {object}  data    – { release, commits, prs, issues }
 * @returns {object} Discord embed
 */
function buildRepoEmbed(repo, data) {
  const { release, commits, prs, issues } = data;
  const lines = [];

  // Branch & release
  let meta = `**Branch:** \`${repo.default_branch}\``;
  if (release) {
    meta += ` • **Release:** [\`${release.tag_name}\`](${release.html_url})`;
    if (release.name && release.name !== release.tag_name) {
      meta += ` ${trunc(release.name, 30)}`;
    }
  }
  lines.push(meta);

  // Commits
  if (commits.length > 0) {
    lines.push("");
    lines.push("📝 **Recent Commits**");
    for (const c of commits) {
      const sha = c.sha.substring(0, 7);
      const author = trunc(c.commit.author?.name || "Unknown", 15);
      const msg = trunc(c.commit.message.split("\n")[0], 50);
      lines.push(`[\`${sha}\`](${c.html_url}) ${author} — ${msg}`);
    }
  }

  // PRs
  if (prs.length > 0) {
    lines.push("");
    lines.push(`🔃 **Open PRs** (${prs.length})`);
    for (const pr of prs.slice(0, 5)) {
      lines.push(
        `[#${pr.number}](${pr.html_url}) ${trunc(pr.title, 40)} — @${pr.user?.login || "?"}`
      );
    }
    if (prs.length > 5) lines.push(`_…and ${prs.length - 5} more_`);
  }

  // Issues
  if (issues.length > 0) {
    lines.push("");
    lines.push(`🐛 **Open Issues** (${issues.length})`);
    for (const issue of issues.slice(0, 5)) {
      lines.push(
        `[#${issue.number}](${issue.html_url}) ${trunc(issue.title, 40)} — @${issue.user?.login || "?"}`
      );
    }
    if (issues.length > 5) lines.push(`_…and ${issues.length - 5} more_`);
  }

  return {
    title: `📦 ${repo.name}`,
    url: repo.html_url,
    description: lines.join("\n"),
    color: activityColor(repo.pushed_at),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Discord message management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Posts a new dashboard message to the Discord webhook.
 *
 * @param {string}  webhookUrl – Discord webhook URL
 * @param {Array}   embeds     – Array of embed objects
 * @returns {Promise<string>}  The message ID of the created message
 */
async function createDashboardMessage(webhookUrl, embeds) {
  console.log("[DISCORD] Creating new dashboard message...");
  const res = await axios.post(
    `${webhookUrl}?wait=true`,
    {
      username: "Altair Dashboard",
      avatar_url: LOGO,
      embeds,
    }
  );
  const messageId = res.data.id;
  console.log(`[DISCORD] Created message ID: ${messageId}`);
  return messageId;
}

/**
 * Edits an existing dashboard message via the Discord webhook.
 *
 * @param {string}  webhookUrl – Discord webhook URL
 * @param {string}  messageId  – ID of the message to edit
 * @param {Array}   embeds     – Array of embed objects
 * @returns {Promise<boolean>} true if edit succeeded
 */
async function editDashboardMessage(webhookUrl, messageId, embeds) {
  console.log(`[DISCORD] Editing dashboard message ${messageId}...`);
  try {
    await axios.patch(
      `${webhookUrl}/messages/${messageId}`,
      {
        embeds,
      }
    );
    console.log(`[DISCORD] Successfully edited message ${messageId}.`);
    return true;
  } catch (err) {
    console.warn(
      `[DISCORD] Failed to edit message ${messageId}:`,
      err.response?.status,
      err.response?.data || err.message
    );
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Altair-Linux Repository Dashboard");
  console.log("═══════════════════════════════════════════════════════════════");

  const webhookUrl = process.env.DISCORD_WEBHOOK_DASHBOARD;
  if (!webhookUrl) {
    console.warn("[SKIP] DISCORD_WEBHOOK_DASHBOARD not set. Dashboard update skipped.");
    return;
  }

  // ── Fetch organisation data ───────────────────────────────────────────
  const repos = await getRepos();

  // Sort repos alphabetically for consistent ordering
  repos.sort((a, b) => a.name.localeCompare(b.name));

  // ── Fetch per-repo data in parallel ───────────────────────────────────
  console.log("[INFO] Fetching per-repository data...");

  const repoData = await Promise.all(
    repos.map(async (repo) => {
      const fullName = repo.full_name;
      console.log(`[INFO]   ↳ ${fullName}`);

      const [release, commits, prs, issues] = await Promise.all([
        getLatestRelease(fullName),
        getRecentCommits(fullName, repo.default_branch, 5),
        getOpenPRs(fullName),
        getOpenIssues(fullName),
      ]);

      return { repo, release, commits, prs, issues };
    })
  );

  // ── Build embeds ──────────────────────────────────────────────────────
  console.log("[INFO] Building dashboard embeds...");

  const embeds = [buildHeaderEmbed(repos.length)];

  // Discord allows a maximum of 10 embeds per message.
  // The first embed is the header, so we can include up to 9 repo embeds.
  for (const { repo, ...data } of repoData.slice(0, 9)) {
    embeds.push(buildRepoEmbed(repo, data));
  }

  if (repoData.length > 9) {
    const remaining = repoData.slice(9).map((d) => d.repo.name);
    embeds.push({
      description:
        `_…and **${remaining.length}** more repositories: ${remaining.join(", ")}_`,
      color: COLORS.STALE,
    });
    // This replaces the last repo embed if we're at 10 embeds
    if (embeds.length > 10) {
      embeds.length = 10;
    }
  }

  // ── Send or edit Discord message ──────────────────────────────────────
  const state = loadState();

  if (state.messageId) {
    const success = await editDashboardMessage(webhookUrl, state.messageId, embeds);
    if (!success) {
      // Message was deleted or inaccessible – create a new one
      console.log("[INFO] Previous message unavailable. Creating a new one.");
      const newId = await createDashboardMessage(webhookUrl, embeds);
      saveState(newId);
    }
  } else {
    const newId = await createDashboardMessage(webhookUrl, embeds);
    saveState(newId);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Dashboard update complete.");
  console.log("═══════════════════════════════════════════════════════════════");
}

module.exports = { main };

// Run when executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error("[FATAL] Unhandled error in dashboard:", err);
    process.exit(1);
  });
}
